"""Assessment response schema."""
from __future__ import annotations

import json

from pydantic import BaseModel

from app.db.models import Assessment
from app.schemas._types import UtcDateTime


class AssessmentOut(BaseModel):
    conversation_id: int
    overall_score: float
    cefr_level: str
    fluency: float | None
    grammar: float | None
    vocabulary: float | None
    coherence: float | None
    code_mixing: float | None
    pronunciation: float | None
    summary: str | None
    strengths: list[str]
    weaknesses: list[str]
    corrections: list[dict]
    next_steps: list[str]
    rubric_version: str
    created_at: UtcDateTime

    @classmethod
    def from_model(cls, a: Assessment) -> "AssessmentOut":
        fb = json.loads(a.feedback_json) if a.feedback_json else {}
        return cls(
            conversation_id=a.conversation_id,
            overall_score=a.overall_score,
            cefr_level=a.cefr_level,
            fluency=a.fluency,
            grammar=a.grammar,
            vocabulary=a.vocabulary,
            coherence=a.coherence,
            code_mixing=a.code_mixing,
            pronunciation=a.pronunciation,
            summary=a.summary,
            strengths=fb.get("strengths", []),
            weaknesses=fb.get("weaknesses", []),
            corrections=fb.get("corrections", []),
            next_steps=fb.get("next_steps", []),
            rubric_version=a.rubric_version,
            created_at=a.created_at,
        )
