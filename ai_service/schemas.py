from typing import Literal
from pydantic import BaseModel, ConfigDict, Field
from copy import deepcopy

class Evidence(BaseModel):
    time: str
    quote: str = Field(min_length=1, max_length=200)

class EventAnalysis(BaseModel):
    model_config = ConfigDict(extra="forbid")
    event_id: int
    summary: str = Field(min_length=1)
    severity: Literal["none", "low", "medium", "high"]
    likely_root_cause: str | None
    confidence: Literal["low", "medium", "high"]
    confidence_reason: str = Field(min_length=1)
    evidence: list[Evidence]
    assumptions: list[str]
    alternative_explanations: list[str]
    unknowns: list[str]
    recommended_checks: list[str]
    recommended_fix: str | None

class Report(BaseModel):
    model_config = ConfigDict(extra="forbid")
    events: list[EventAnalysis]
    cross_event_notes: str


def brief_report_schema():
    """Bound generated prose/arrays without cutting any source log input."""
    schema = deepcopy(Report.model_json_schema())
    fields = schema["$defs"]["EventAnalysis"]["properties"]
    for name in ("summary", "confidence_reason"):
        fields[name]["maxLength"] = 180
    for name in ("likely_root_cause", "recommended_fix"):
        for option in fields[name]["anyOf"]:
            if option.get("type") == "string": option["maxLength"] = 180
    for name, maximum in (("assumptions", 1), ("alternative_explanations", 1), ("unknowns", 2), ("recommended_checks", 2)):
        fields[name]["maxItems"] = maximum
        fields[name]["items"]["maxLength"] = 140
    fields["evidence"]["maxItems"] = 3
    schema["properties"]["cross_event_notes"]["maxLength"] = 180
    return schema

