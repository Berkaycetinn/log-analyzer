import json
import pytest
from fastapi.testclient import TestClient
from ai_service.api import create_app
from ai_service.config import Settings
from ai_service.pipeline import Pipeline
from test_service import Analyzer, Embedder, line

class BrokenAnalyzer:
    def analyze_package(self, *args, **kwargs):
        raise ValueError("Model returned malformed JSON")

def test_inference_error_is_not_reported_as_success(tmp_path):
    settings = Settings(output_dir=tmp_path)
    client = TestClient(create_app(settings, Pipeline(settings, Embedder(), BrokenAnalyzer())))
    response = client.post("/analyze", files={"file": ("x.log", line())})
    assert response.status_code == 422
    assert list(tmp_path.glob("*/events.json"))
    errors = list(tmp_path.glob("*/error.json"))
    assert len(errors) == 1
    assert json.loads(errors[0].read_text())["type"] == "ValueError"
    assert not list(tmp_path.glob("*/final_root_cause_report.json"))

def test_reports_are_isolated_between_requests(tmp_path):
    settings = Settings(output_dir=tmp_path)
    client = TestClient(create_app(settings, Pipeline(settings, Embedder(), Analyzer())))
    ids = [client.post("/analyze", files={"file": ("x.log", line())}).json()["run_id"]
           for _ in range(2)]
    assert len(set(ids)) == 2
    assert all((tmp_path / run / "manifest.json").exists() for run in ids)

def test_structured_cross_event_notes_rejected_and_preserved(tmp_path):
    class WrongSchemaAnalyzer(Analyzer):
        def analyze_package(self, payload, **kwargs):
            result = super().analyze_package(payload, **kwargs)
            result["cross_event_notes"] = {"note": "Unexpected object"}
            return result
    settings = Settings(output_dir=tmp_path)
    client = TestClient(create_app(settings, Pipeline(settings, Embedder(), WrongSchemaAnalyzer())))
    response = client.post("/analyze", files={"file": ("x.log", line())})
    assert response.status_code == 422
    raw = list(tmp_path.glob("*/model_response.json"))
    assert len(raw) == 1
    assert json.loads(raw[0].read_text())["cross_event_notes"] == {"note": "Unexpected object"}
    assert not list(tmp_path.glob("*/final_root_cause_report.json"))

def test_json_constraints_cannot_conflict_with_thinking():
    import pytest
    with pytest.raises(ValueError, match="THINKING=false"):
        Settings(enforce_json=True, thinking=True)
    assert Settings(enforce_json=True, thinking=False).enforce_json

def test_json_constraint_parser_requires_string_notes():
    from lmformatenforcer import JsonSchemaParser
    from ai_service.schemas import Report
    parser = JsonSchemaParser(Report.model_json_schema())
    for character in '{"events": [], "cross_event_notes": ':
        assert character in parser.get_allowed_characters()
        parser = parser.add_character(character)
    assert '"' in parser.get_allowed_characters()
    assert '{' not in parser.get_allowed_characters()

def test_json_decoder_transformers_integration_is_available():
    from lmformatenforcer.integrations.transformers import build_transformers_prefix_allowed_tokens_fn
    assert callable(build_transformers_prefix_allowed_tokens_fn)

