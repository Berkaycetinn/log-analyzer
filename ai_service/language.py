"""Validate explanatory prose; log quotes, enum values and identifiers stay intact."""
from functools import lru_cache
from unicodedata import name as unicode_name
from lingua import Language, LanguageDetectorBuilder

TEXT_FIELDS = ("summary", "likely_root_cause", "confidence_reason", "recommended_fix", "resolution_check")
LIST_FIELDS = ("assumptions", "alternative_explanations", "unknowns", "recommended_checks")


@lru_cache(maxsize=1)
def detector():
    return LanguageDetectorBuilder.from_languages(Language.TURKISH, Language.ENGLISH).build()


class ReportLanguageError(ValueError):
    pass


def non_turkish_fields(report):
    fields = []
    for event in report["events"]:
        prefix = f"events[{event['event_id']}]"
        fields.extend((f"{prefix}.{name}", event.get(name)) for name in TEXT_FIELDS)
        for name in LIST_FIELDS:
            fields.extend((f"{prefix}.{name}[{index}]", text) for index, text in enumerate(event[name]))
    fields.append(("cross_event_notes", report["cross_event_notes"]))
    return [name for name, text in fields if text and (
        any(character.isalpha() and 'LATIN' not in unicode_name(character, '') for character in text)
        or detector().detect_language_of(text) != Language.TURKISH)]


def require_turkish(report):
    invalid = non_turkish_fields(report)
    if invalid:
        raise ReportLanguageError("Model Türkçe açıklama üretemedi: " + ", ".join(invalid))
