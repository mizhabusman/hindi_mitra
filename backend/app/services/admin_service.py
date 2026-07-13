"""
Admin/analytics service.

Computes per-employee performance from the REAL stored data — conversations,
turn scores, and assessments — not from client-reported numbers. Cost is priced
per model (chat=Sonnet, scoring=Haiku, assessment=Sonnet) using the central
pricing table.
"""
from __future__ import annotations

import datetime as dt
from dataclasses import dataclass, field

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import get_settings
from app.core.timeutil import ensure_utc
from app.db.models import (
    Assessment,
    Conversation,
    Message,
    Persona,
    TurnScore,
    User,
)
from app.services import cost

_settings = get_settings()


@dataclass
class UserMetrics:
    user: User
    conversations: int = 0
    assessments: int = 0
    practice_seconds: float = 0.0
    avg_score: float | None = None
    latest_level: str | None = None
    latest_activity: dt.datetime | None = None
    total_tokens: int = 0
    estimated_cost: float = 0.0
    # internal token accumulators (per model)
    _chat_in: int = field(default=0, repr=False)
    _chat_out: int = field(default=0, repr=False)
    _score_in: int = field(default=0, repr=False)
    _score_out: int = field(default=0, repr=False)
    _assess_in: int = field(default=0, repr=False)
    _assess_out: int = field(default=0, repr=False)

    def finalize(self) -> None:
        self.total_tokens = (
            self._chat_in + self._chat_out + self._score_in + self._score_out
            + self._assess_in + self._assess_out
        )
        usd = (
            cost.estimate_cost(_settings.model_conversation, self._chat_in, self._chat_out)
            + cost.estimate_cost(_settings.model_scoring, self._score_in, self._score_out)
            + cost.estimate_cost(_settings.model_assessment, self._assess_in, self._assess_out)
        )
        self.estimated_cost = usd * _settings.usd_to_inr  # shown in INR (₹)


async def compute_user_metrics(
    db: AsyncSession, *, team_id: int | None = None, only_user_id: int | None = None
) -> list[UserMetrics]:
    """
    Aggregate metrics for all users (optionally scoped to one team or a single
    user). At company scale (tens–hundreds of users) a handful of grouped
    queries is ample.
    """
    user_q = select(User)
    if team_id is not None:
        user_q = user_q.where(User.team_id == team_id)
    if only_user_id is not None:
        user_q = user_q.where(User.id == only_user_id)
    users = list((await db.execute(user_q.order_by(User.username))).scalars().all())
    metrics = {u.id: UserMetrics(user=u) for u in users}
    ids = set(metrics)
    if not ids:
        return []

    # Conversations: count, practice time, chat-token totals (conversation
    # totals are chat-only now).
    convo_rows = await db.execute(
        select(
            Conversation.user_id,
            Conversation.started_at,
            Conversation.ended_at,
            Conversation.input_tokens,
            Conversation.output_tokens,
        ).where(Conversation.user_id.in_(ids))
    )
    for uid, started, ended, cin, cout in convo_rows:
        m = metrics[uid]
        m.conversations += 1
        m._chat_in += cin or 0
        m._chat_out += cout or 0
        if ended and started:
            m.practice_seconds += max(0.0, (ended - started).total_seconds())
        act = ended or started
        if act and (m.latest_activity is None or act > m.latest_activity):
            m.latest_activity = act

    # Scoring tokens: turn_scores -> messages -> conversations.user_id
    score_rows = await db.execute(
        select(
            Conversation.user_id,
            func.coalesce(func.sum(TurnScore.input_tokens), 0),
            func.coalesce(func.sum(TurnScore.output_tokens), 0),
        )
        .select_from(TurnScore)
        .join(Message, Message.id == TurnScore.message_id)
        .join(Conversation, Conversation.id == Message.conversation_id)
        .where(Conversation.user_id.in_(ids))
        .group_by(Conversation.user_id)
    )
    for uid, sin, sout in score_rows:
        metrics[uid]._score_in += int(sin)
        metrics[uid]._score_out += int(sout)

    # Assessments: count, avg score, latest level, assessment tokens.
    assess_rows = await db.execute(
        select(
            Conversation.user_id,
            Assessment.overall_score,
            Assessment.cefr_level,
            Assessment.created_at,
            Assessment.input_tokens,
            Assessment.output_tokens,
        )
        .join(Conversation, Conversation.id == Assessment.conversation_id)
        .where(Conversation.user_id.in_(ids))
    )
    scores_by_user: dict[int, list[float]] = {}
    latest_by_user: dict[int, tuple[dt.datetime, str]] = {}
    for uid, score, level, created, ain, aout in assess_rows:
        m = metrics[uid]
        m.assessments += 1
        m._assess_in += ain or 0
        m._assess_out += aout or 0
        scores_by_user.setdefault(uid, []).append(score)
        if uid not in latest_by_user or created > latest_by_user[uid][0]:
            latest_by_user[uid] = (created, level)

    for uid, m in metrics.items():
        vals = scores_by_user.get(uid)
        if vals:
            m.avg_score = round(sum(vals) / len(vals), 1)
        if uid in latest_by_user:
            m.latest_level = latest_by_user[uid][1]
        m.finalize()

    return list(metrics.values())


async def org_overview(db: AsyncSession) -> dict:
    metrics = await compute_user_metrics(db)
    total_users = len(metrics)
    total_convos = sum(m.conversations for m in metrics)
    total_assessments = sum(m.assessments for m in metrics)
    scored = [m.avg_score for m in metrics if m.avg_score is not None]
    return {
        "total_users": total_users,
        "total_conversations": total_convos,
        "total_assessments": total_assessments,
        "avg_score": round(sum(scored) / len(scored), 1) if scored else None,
        "total_cost": round(sum(m.estimated_cost for m in metrics), 4),
        "total_practice_seconds": round(sum(m.practice_seconds for m in metrics)),
    }


async def employee_detail(db: AsyncSession, user_id: int) -> dict | None:
    """Everything about one employee: profile, metrics, conversations, and the
    improvement history (assessment scores over time)."""
    user = await db.get(User, user_id)
    if user is None:
        return None

    metrics = await compute_user_metrics(db, only_user_id=user_id)
    m = metrics[0] if metrics else None
    conversations = await list_user_conversations(db, user_id)

    # Improvement history: assessment scores over time (oldest → newest).
    hist_rows = await db.execute(
        select(Assessment.overall_score, Assessment.cefr_level, Assessment.created_at)
        .join(Conversation, Conversation.id == Assessment.conversation_id)
        .where(Conversation.user_id == user_id)
        .order_by(Assessment.created_at)
    )
    history = [
        {"score": s, "level": lvl, "date": ensure_utc(created)}
        for (s, lvl, created) in hist_rows
    ]

    return {
        "user": {
            "id": user.id,
            "username": user.username,
            "display_name": user.display_name,
            "role": user.role.value,
            "is_active": user.is_active,
            "created_at": ensure_utc(user.created_at),
            "last_login_at": ensure_utc(user.last_login_at),
        },
        "metrics": {
            "conversations": m.conversations if m else 0,
            "assessments": m.assessments if m else 0,
            "practice_seconds": m.practice_seconds if m else 0.0,
            "avg_score": m.avg_score if m else None,
            "latest_level": m.latest_level if m else None,
            "total_tokens": m.total_tokens if m else 0,
            "estimated_cost": round(m.estimated_cost, 2) if m else 0.0,
        },
        "conversations": conversations,
        "history": history,
    }


async def list_user_conversations(db: AsyncSession, user_id: int) -> list[dict]:
    """Conversations for one user with score/level and whether assessed."""
    rows = await db.execute(
        select(Conversation, Persona.key, Persona.label, Assessment.overall_score, Assessment.cefr_level)
        .join(Persona, Persona.id == Conversation.persona_id)
        .outerjoin(Assessment, Assessment.conversation_id == Conversation.id)
        .where(Conversation.user_id == user_id)
        .order_by(Conversation.started_at.desc())
    )
    out = []
    for convo, pkey, plabel, a_score, a_level in rows:
        out.append(
            {
                "id": convo.id,
                "persona_key": pkey,
                "persona_label": plabel,
                "status": convo.status.value,
                "started_at": ensure_utc(convo.started_at),
                "ended_at": ensure_utc(convo.ended_at),
                "live_score": convo.live_score,
                "live_level": convo.live_level,
                "assessment_score": a_score,
                "assessment_level": a_level,
            }
        )
    return out
