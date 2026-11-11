from copy import deepcopy
import json
import pytest
from ai_service.diagnostics import diagnostic_hints
from ai_service.pipeline import Pipeline
from ai_service.config import Settings
from ai_service.schemas import Report
from ai_service.validation import require_actionable
from test_service import Analyzer, Embedder, line


def source(message):
    return {'events': [{'event_id': 7, 'templates': [{'example': message}]}]}


@pytest.mark.parametrize('message, signal', [
    ('java.nio.file.AccessDeniedException: /demo/input.txt', 'Dosya erişimi reddedildi'),
    ('read failed: Permission denied', 'Dosya erişimi reddedildi'),
    ('No route to host', 'Hedefe ağ yolu yok'),
    ('Connection refused', 'Bağlantı reddedildi'),
    ('No space left on device', 'Yazma alanı tükendi'),
    ('java.nio.file.NoSuchFileException: input.txt', 'Dosya yolu bulunamadı'),
])
def test_matching_error_has_specific_intervention_and_success_check(message, signal):
    package = source(message)
    before = deepcopy(package)
    hints = diagnostic_hints(package)
    assert hints[0]['event_id'] == 7
    context = hints[0]['technical_context'][0]
    assert context['signal'] == signal
    assert context['intervention'] and context['success_check']
    assert package == before


def test_unrelated_context_does_not_become_a_diagnosis():
    package = source('Unknown application error')
    package['events'][0]['context_before'] = [{'message': 'AccessDeniedException'}]
    assert diagnostic_hints(package) == []


def test_hints_are_model_context_and_never_fabricated_source_evidence(tmp_path):
    class CapturingAnalyzer(Analyzer):
        def analyze_package(self, payload, **kwargs):
            self.input = json.loads(payload)
            return super().analyze_package(payload, **kwargs)
    analyzer = CapturingAnalyzer()
    result = Pipeline(Settings(output_dir=tmp_path), Embedder(), analyzer).run(
        line(message='java.nio.file.AccessDeniedException: /demo/input.txt').encode())
    assert analyzer.input['diagnostic_hints'][0]['technical_context'][0]['signal'] == 'Dosya erişimi reddedildi'
    assert 'diagnostic_hints' not in result['package']
    assert result['validation']['valid']


@pytest.mark.parametrize('field', ['likely_root_cause', 'recommended_fix', 'resolution_check'])
@pytest.mark.parametrize('value', [None, '', '   '])
def test_incomplete_new_plan_is_not_accepted_as_success(field, value):
    report = Analyzer().analyze_package(json.dumps({'events': [{'event_id': 0}]}))
    report['events'][0][field] = value
    with pytest.raises(ValueError, match='Model müdahale planını tamamlamadı'):
        require_actionable(report)


def test_old_persisted_null_fields_remain_readable():
    report = Analyzer().analyze_package(json.dumps({'events': [{'event_id': 0}]}))
    report['events'][0]['likely_root_cause'] = None
    report['events'][0]['recommended_fix'] = None
    report['events'][0].pop('resolution_check')
    assert Report.model_validate(report).events[0].resolution_check is None


def test_a_proposal_is_not_reported_as_a_completed_repair(tmp_path):
    class PrematureAnalyzer(Analyzer):
        def analyze_package(self, payload, **kwargs):
            value = super().analyze_package(payload, **kwargs)
            value['cross_event_notes'] = 'Hata giderildi.'
            return value
    with pytest.raises(ValueError, match='doğrulanmış bir onarım'):
        Pipeline(Settings(output_dir=tmp_path), Embedder(), PrematureAnalyzer()).run(line().encode())
    assert not list(tmp_path.glob('*/final_root_cause_report.json'))


def test_conditional_success_criteria_are_allowed_and_evidence_is_not_rewritten():
    report = Analyzer().analyze_package(json.dumps({'events': [{'event_id': 0}]}))
    report['events'][0]['resolution_check'] = 'İzinler düzeltildiğinde hata giderilmelidir; yeniden çalıştırarak doğrulayın.'
    report['events'][0]['evidence'] = [{'time': '00:00:00', 'quote': 'Hata giderildi'}]
    require_actionable(report)


def test_bad_plan_returns_specific_http_error(tmp_path):
    from fastapi.testclient import TestClient
    from ai_service.api import create_app
    class EmptyPlanAnalyzer(Analyzer):
        def analyze_package(self, payload, **kwargs):
            value = super().analyze_package(payload, **kwargs)
            value['events'][0]['recommended_fix'] = None
            return value
    settings = Settings(output_dir=tmp_path)
    client = TestClient(create_app(settings, Pipeline(settings, Embedder(), EmptyPlanAnalyzer())))
    response = client.post('/analyze', files={'file': ('synthetic.txt', line())})
    assert response.status_code == 422
    assert response.json()['detail']['code'] == 'REPORT_PLAN_INVALID'
