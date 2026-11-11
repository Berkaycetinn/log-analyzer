import json
from concurrent.futures import ThreadPoolExecutor
from time import sleep
import pytest
from ai_service.config import Settings
from ai_service.language import require_turkish, ReportLanguageError, non_turkish_fields
from ai_service.pipeline import Pipeline
from test_service import Analyzer, Embedder, line


def test_constrained_decoder_permits_turkish_and_original_unicode_quotes():
    from ai_service.decoding import json_parser
    text = "Çığ, ıslak ölçüm, ŞÜPHE; kaynak: café ✓"
    value = json.dumps({"text": text}, ensure_ascii=False, separators=(",", ":"))
    parser = json_parser({"type": "object", "properties": {"text": {"type": "string"}}, "required": ["text"]}, text)
    for character in value:
        assert character in parser.get_allowed_characters(), character
        parser = parser.add_character(character)
    assert parser.can_end()


def test_brief_generation_schema_limits_prose_without_changing_source_contract():
    from ai_service.schemas import brief_report_schema, Report
    schema = brief_report_schema()
    assert schema["$defs"]["EventAnalysis"]["properties"]["unknowns"]["maxItems"] == 2
    assert schema["$defs"]["EventAnalysis"]["properties"]["summary"]["maxLength"] == 180
    assert "maxLength" not in Report.model_json_schema()["$defs"]["EventAnalysis"]["properties"]["summary"]


def test_decoder_restricts_event_ids_per_request_and_keeps_unicode():
    from lmformatenforcer import TokenEnforcerTokenizerData
    from ai_service.decoding import prefix_function
    from ai_service.schemas import brief_report_schema
    alphabet = ''.join(chr(i) for i in range(32, 127)) + 'çğıöşüÇĞİÖŞÜ'
    data = TokenEnforcerTokenizerData([(i, c, False) for i, c in enumerate(alphabet)],
        lambda ids: ''.join(alphabet[i] for i in ids), len(alphabet), False, len(alphabet)+1)
    def parser(event_id):
        return prefix_function(data, brief_report_schema(), json.dumps({'events': [{'event_id': event_id}]})).token_enforcer.root_parser
    first, second = parser(0), parser(2)
    for character in '{"events":[{"event_id":':
        first = first.add_character(character)
        second = second.add_character(character)
    assert '0' in first.get_allowed_characters()
    assert '2' not in first.get_allowed_characters()
    assert '2' in second.get_allowed_characters()
    assert '0' not in second.get_allowed_characters()
    assert first.config.force_json_field_order
    assert 'ı' in first.config.alphabet


def report():
    return Analyzer().analyze_package(json.dumps({"events": [{"event_id": 0}]}))


def test_turkish_prose_with_english_evidence_and_enums_is_preserved():
    value = report()
    value["events"][0]["evidence"] = [{"time": "00:00:00", "quote": "Connection failed: no route to host"}]
    original = json.dumps(value)
    require_turkish(value)
    assert json.dumps(value) == original


@pytest.mark.parametrize("field", ["summary", "likely_root_cause", "confidence_reason", "recommended_fix", "resolution_check"])
def test_every_explanatory_string_is_checked(field):
    value = report()
    value["events"][0][field] = "A connection failed and the network cannot be reached."
    assert any(field in name for name in non_turkish_fields(value))
    with pytest.raises(ReportLanguageError):
        require_turkish(value)


@pytest.mark.parametrize("field", ["assumptions", "alternative_explanations", "unknowns", "recommended_checks"])
def test_list_explanations_are_checked(field):
    value = report()
    value["events"][0][field] = ["Check the network connection and firewall settings."]
    with pytest.raises(ReportLanguageError):
        require_turkish(value)


def test_cross_event_notes_are_checked():
    value = report()
    value["cross_event_notes"] = "The events may be related to the network connection."
    with pytest.raises(ReportLanguageError):
        require_turkish(value)


def test_mixed_language_prose_is_rejected_but_source_quotes_are_not_translated():
    value = report()
    value['events'][0]['confidence_reason'] = 'Bağlantı kurulamadı: No路由到主'
    value['events'][0]['evidence'] = [{'time': '00:00:00', 'quote': 'No路由到主'}]
    assert 'events[0].confidence_reason' in non_turkish_fields(value)
    value['events'][0]['confidence_reason'] = 'Bağlantı kurulamadı.'
    require_turkish(value)


def test_one_bounded_language_retry_keeps_real_source_and_turkish_report(tmp_path):
    class RepairingAnalyzer(Analyzer):
        def __init__(self): self.calls = []
        def analyze_package(self, payload, **kwargs):
            self.calls.append(kwargs)
            value = super().analyze_package(payload, **kwargs)
            if not kwargs.get("language_retry"):
                value["events"][0]["summary"] = "A connection failed during the sample period."
            return value
    analyzer = RepairingAnalyzer()
    result = Pipeline(Settings(output_dir=tmp_path), Embedder(), analyzer).run(line().encode())
    assert len(analyzer.calls) == 2
    assert analyzer.calls[1]["language_retry"]
    assert analyzer.calls[0]["max_new_tokens"] == 1800
    assert result["performance"]["language_attempts"] == 2
    assert result["validation"]["language"] == "tr"
    assert result["stats"]["matched_lines"] == 1
    require_turkish(result["report"])


def test_english_never_becomes_a_successful_stored_report(tmp_path):
    class EnglishAnalyzer(Analyzer):
        def analyze_package(self, payload, **kwargs):
            value = super().analyze_package(payload, **kwargs)
            value["events"][0]["summary"] = "A connection failed during the sample period."
            return value
    with pytest.raises(ReportLanguageError):
        Pipeline(Settings(output_dir=tmp_path), Embedder(), EnglishAnalyzer()).run(line().encode())
    assert not list(tmp_path.glob("*/final_root_cause_report.json"))
    assert len(list(tmp_path.glob("*/error.json"))) == 1


def test_language_failure_has_a_specific_http_error(tmp_path):
    from fastapi.testclient import TestClient
    from ai_service.api import create_app
    class EnglishAnalyzer(Analyzer):
        def analyze_package(self, payload, **kwargs):
            value = super().analyze_package(payload, **kwargs)
            value["events"][0]["summary"] = "A connection failed during the sample period."
            return value
    settings = Settings(output_dir=tmp_path)
    response = TestClient(create_app(settings, Pipeline(settings, Embedder(), EnglishAnalyzer()))).post(
        "/analyze", files={"file": ("synthetic.txt", line())})
    assert response.status_code == 422
    assert response.json()["detail"]["code"] == "REPORT_LANGUAGE_INVALID"


def test_model_warmup_and_first_job_share_one_initialization():
    pipeline = Pipeline(Settings())
    calls = []
    def load():
        calls.append(True)
        sleep(0.02)
        pipeline.embedder, pipeline.analyzer = object(), object()
    pipeline._load_models = load
    with ThreadPoolExecutor(max_workers=2) as executor:
        list(executor.map(lambda _: pipeline.load_models(), range(2)))
    assert len(calls) == 1
    assert pipeline.model_state == "ready"
