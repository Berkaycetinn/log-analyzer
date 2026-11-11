from .schemas import Report
import re

class ReportPlanError(ValueError):
    pass

def require_actionable(report):
    for event in report['events']:
        for field in ('likely_root_cause', 'recommended_fix', 'resolution_check'):
            if not isinstance(event.get(field), str) or not event[field].strip():
                raise ReportPlanError(f"Model müdahale planını tamamlamadı: events[{event['event_id']}].{field}")
    # Recommendations are not an executed repair. Do not accept an unqualified
    # completion claim in prose (source evidence remains verbatim and excluded).
    prose = [report.get('cross_event_notes', '')]
    for event in report['events']:
        prose.extend(event.get(field) or '' for field in
                     ('summary', 'likely_root_cause', 'confidence_reason', 'recommended_fix', 'resolution_check'))
        for field in ('assumptions', 'alternative_explanations', 'unknowns', 'recommended_checks'):
            prose.extend(event.get(field, []))
    if any(re.search(r'\b(?:hata|sorun)\s+(?:tamamen\s+)?(?:giderildi|çözüldü|çözülmüştür|giderilmiştir)\b',
                     text, re.IGNORECASE) for text in prose):
        raise ReportPlanError('Model, öneriyi uygulanmış ve doğrulanmış bir onarım gibi sundu.')

def strings(value):
    if isinstance(value, str):
        yield value
    elif isinstance(value, dict):
        for item in value.values():
            yield from strings(item)
    elif isinstance(value, list):
        for item in value:
            yield from strings(item)

def validate_report(result, package):
    report = Report.model_validate(result)
    source = {e["event_id"]: e for e in package["events"]}
    ids = [e.event_id for e in report.events]
    if len(ids) != len(set(ids)) or set(ids) != set(source):
        raise ValueError("LLM event IDs must cover every input event exactly once")
    errors = []
    for event in report.events:
        texts = list(strings(source[event.event_id]))
        for item in event.evidence:
            if not any(item.quote in text for text in texts):
                errors.append(f"Event {event.event_id}: evidence is not an exact input substring")
    return report.model_dump(), {"valid": not errors, "errors": errors,
                                 "note": "Alıntı eşleşmesi nedenselliği kanıtlamaz."}

