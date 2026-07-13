"""
Scoring service — the assessment engine.

Two AI-driven operations, both using structured outputs and a server-owned,
versioned rubric (prompts/scoring.yaml):

  * score_turn        — scores a single user turn (fast, Haiku). Updates the
                        conversation's live score (recency-weighted EMA).
  * generate_assessment — holistic end-of-conversation report (Sonnet).

Scores are derived from the model, never from client-supplied numbers.
"""
from __future__ import annotations

import json
from functools import lru_cache

import yaml
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import get_settings
from app.db.models import (
    Assessment,
    Conversation,
    Message,
    MessageRole,
    Persona,
    TurnScore,
)
from app.db.session import SessionLocal
from app.prompts import SCORING_FILE
from app.services import claude_client

_settings = get_settings()

# Recency weight for the live (running) score EMA.
_EMA_ALPHA = 0.4
_CEFR = ["A1", "A2", "B1", "B2", "C1", "C2"]

_TURN_SCHEMA = {
    "type": "object",
    "properties": {
        "fluency": {"type": "number"},
        "grammar": {"type": "number"},
        "vocabulary": {"type": "number"},
        "coherence": {"type": "number"},
        "code_mixing": {"type": "number"},
        "composite": {"type": "number"},
        "cefr_level": {"type": "string", "enum": _CEFR},
        "notes": {"type": "string"},
    },
    "required": [
        "fluency", "grammar", "vocabulary", "coherence",
        "code_mixing", "composite", "cefr_level", "notes",
    ],
    "additionalProperties": False,
}

_ASSESSMENT_SCHEMA = {
    "type": "object",
    "properties": {
        "overall_score": {"type": "number"},
        "cefr_level": {"type": "string", "enum": _CEFR},
        "fluency": {"type": "number"},
        "grammar": {"type": "number"},
        "vocabulary": {"type": "number"},
        "coherence": {"type": "number"},
        "code_mixing": {"type": "number"},
        "summary": {"type": "string"},
        "strengths": {"type": "array", "items": {"type": "string"}},
        "weaknesses": {"type": "array", "items": {"type": "string"}},
        "corrections": {
            "type": "array",
            "items": {
                "type": "object",
                "properties": {
                    "said": {"type": "string"},
                    "better": {"type": "string"},
                    "why": {"type": "string"},
                },
                "required": ["said", "better", "why"],
                "additionalProperties": False,
            },
        },
        "next_steps": {"type": "array", "items": {"type": "string"}},
    },
    "required": [
        "overall_score", "cefr_level", "fluency", "grammar", "vocabulary",
        "coherence", "code_mixing", "summary", "strengths", "weaknesses",
        "corrections", "next_steps",
    ],
    "additionalProperties": False,
}


@lru_cache
def _rubric() -> dict:
    with SCORING_FILE.open(encoding="utf-8") as fh:
        return yaml.safe_load(fh)


def rubric_version() -> str:
    return _rubric().get("rubric_version", "v1")


def _cefr_from_score(score: float) -> str:
    thresholds = [(40, "A1"), (55, "A2"), (70, "B1"), (82, "B2"), (92, "C1")]
    for limit, band in thresholds:
        if score < limit:
            return band
    return "C2"


def _clamp(v: object) -> float | None:
    try:
        return max(0.0, min(100.0, float(v)))  # type: ignore[arg-type]
    except (TypeError, ValueError):
        return None


# ── Per-turn live scoring ────────────────────────────────────────────
async def score_turn(
    *,
    message_id: int,
    conversation_id: int,
    utterance: str,
    context: str,
    pronunciation: float | None = None,
) -> dict | None:
    """
    Score one user turn and update the conversation's live score.

    `pronunciation` (0–100), when provided by Azure Speech, is stored and lightly
    blended into the live composite (the AI scores language from the transcript;
    pronunciation is the one signal a transcript can't carry).

    Opens its own DB session so it can run concurrently with reply streaming.
    Returns a dict for the SSE 'score' event, or None on failure (scoring must
    never break the conversation).
    """
    rubric = _rubric()
    user_prompt = rubric["turn_user_template"].format(context=context or "(none)", utterance=utterance)
    try:
        data, usage = await claude_client.structured(
            system=rubric["turn_system"],
            messages=[{"role": "user", "content": user_prompt}],
            schema=_TURN_SCHEMA,
            model=_settings.model_scoring,
            max_tokens=400,
        )
    except claude_client.ClaudeError:
        return None

    language_composite = _clamp(data.get("composite")) or 0.0
    pron = _clamp(pronunciation)
    # Blend pronunciation into the turn's effective score when available.
    composite = language_composite if pron is None else 0.8 * language_composite + 0.2 * pron

    async with SessionLocal() as db:
        score = TurnScore(
            message_id=message_id,
            fluency=_clamp(data.get("fluency")),
            grammar=_clamp(data.get("grammar")),
            vocabulary=_clamp(data.get("vocabulary")),
            coherence=_clamp(data.get("coherence")),
            code_mixing=_clamp(data.get("code_mixing")),
            pronunciation=pron,
            composite=composite,
            cefr_level=data.get("cefr_level"),
            notes=data.get("notes"),
            rubric_version=rubric_version(),
            scoring_model=_settings.model_scoring,
            input_tokens=usage.input_tokens,
            output_tokens=usage.output_tokens,
        )
        db.add(score)

        convo = await db.get(Conversation, conversation_id)
        if convo is not None:
            prev = convo.live_score
            live = composite if prev is None else _EMA_ALPHA * composite + (1 - _EMA_ALPHA) * prev
            convo.live_score = round(live, 1)
            convo.live_level = _cefr_from_score(live)
            live_score, live_level = convo.live_score, convo.live_level
        else:
            live_score, live_level = composite, _cefr_from_score(composite)
        await db.commit()

    return {
        "message_id": message_id,
        "turn": {
            "fluency": score.fluency,
            "grammar": score.grammar,
            "vocabulary": score.vocabulary,
            "coherence": score.coherence,
            "code_mixing": score.code_mixing,
            "pronunciation": pron,
            "composite": composite,
            "cefr_level": data.get("cefr_level"),
            "notes": data.get("notes"),
        },
        "live_score": live_score,
        "live_level": live_level,
    }


def build_context(messages: list[Message], limit: int = 4) -> str:
    """A short recent-history string to give the scorer conversational context."""
    recent = messages[-limit:]
    lines = []
    for m in recent:
        who = "Persona" if m.role == MessageRole.assistant else "User"
        lines.append(f"{who}: {m.content}")
    return "\n".join(lines)


# ── End-of-conversation assessment ───────────────────────────────────
async def generate_assessment(
    db: AsyncSession, conversation: Conversation, persona: Persona
) -> Assessment:
    """Produce (and persist) the holistic assessment over the full transcript."""
    result = await db.execute(
        select(Message)
        .where(Message.conversation_id == conversation.id)
        .order_by(Message.turn_index)
    )
    messages = list(result.scalars().all())
    transcript = "\n".join(
        f"{'assistant' if m.role == MessageRole.assistant else 'user'}: {m.content}"
        for m in messages
    )

    rubric = _rubric()
    user_prompt = rubric["assessment_user_template"].format(
        persona=persona.label, transcript=transcript
    )
    data, usage = await claude_client.structured(
        system=rubric["assessment_system"],
        messages=[{"role": "user", "content": user_prompt}],
        schema=_ASSESSMENT_SCHEMA,
        model=_settings.model_assessment,
        max_tokens=2000,
    )

    feedback = {
        "strengths": data.get("strengths", []),
        "weaknesses": data.get("weaknesses", []),
        "corrections": data.get("corrections", []),
        "next_steps": data.get("next_steps", []),
    }

    # Average measured pronunciation across scored turns (Azure signal; the
    # model can't hear the audio, so this is computed, not model-generated).
    pron_rows = await db.execute(
        select(TurnScore.pronunciation)
        .join(Message, Message.id == TurnScore.message_id)
        .where(Message.conversation_id == conversation.id, TurnScore.pronunciation.is_not(None))
    )
    pron_vals = [p for (p,) in pron_rows if p is not None]
    avg_pronunciation = round(sum(pron_vals) / len(pron_vals), 1) if pron_vals else None

    # Replace any existing assessment (regenerate on demand).
    existing = await db.execute(
        select(Assessment).where(Assessment.conversation_id == conversation.id)
    )
    old = existing.scalar_one_or_none()
    if old is not None:
        await db.delete(old)
        await db.flush()

    assessment = Assessment(
        conversation_id=conversation.id,
        overall_score=_clamp(data.get("overall_score")) or 0.0,
        cefr_level=data.get("cefr_level", "A1"),
        fluency=_clamp(data.get("fluency")),
        grammar=_clamp(data.get("grammar")),
        vocabulary=_clamp(data.get("vocabulary")),
        coherence=_clamp(data.get("coherence")),
        code_mixing=_clamp(data.get("code_mixing")),
        pronunciation=avg_pronunciation,
        summary=data.get("summary"),
        feedback_json=json.dumps(feedback, ensure_ascii=False),
        rubric_version=rubric_version(),
        assessment_model=_settings.model_assessment,
        input_tokens=usage.input_tokens,
        output_tokens=usage.output_tokens,
    )
    db.add(assessment)
    await db.commit()
    await db.refresh(assessment)
    return assessment


async def get_assessment(db: AsyncSession, conversation_id: int) -> Assessment | None:
    result = await db.execute(
        select(Assessment).where(Assessment.conversation_id == conversation_id)
    )
    return result.scalar_one_or_none()
