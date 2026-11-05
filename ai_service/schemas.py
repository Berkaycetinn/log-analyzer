from typing import Literal
from pydantic import BaseModel, ConfigDict, Field

class Evidence(BaseModel):
    time: str
    quote: str = Field(min_length=1, max_length=200)

class EventAnalysis(BaseModel):
    model_config = ConfigDict(extra="forbid")
    event_id: int
    summary: str
    severity: Literal["none", "low", "medium", "high"]
    likely_root_cause: str | None
    confidence: Literal["low", "medium", "high"]
    confidence_reason: str
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

