from .schemas import Report

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
                                 "note": "Quote matching does not establish causality."}

