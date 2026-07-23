"""
Admin/analytics service.

Computes per-employee performance from the REAL stored data — conversations,
turn scores, and assessments — not from client-reported numbers. Cost is priced
per model (chat=Sonnet, scoring=Haiku, assessment=Sonnet) using the central
pricing table.
"""
from __future__ import annotations

import datetime as dt
import json
from dataclasses import dataclass, field

from sqlalchemy import and_, exists, func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import get_settings
from app.core.timeutil import ensure_utc
from app.db.models import (
    Assessment,
    Conversation,
    Message,
    MessageRole,
    Persona,
    TurnScore,
    User,
)

# A conversation is only real once the user has actually spoken — this filters
# out sessions where the user left after just the AI opener (see issue: don't
# count empty conversations).
_HAS_USER_TURN = exists().where(
    and_(Message.conversation_id == Conversation.id, Message.role == MessageRole.user)
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
    db: AsyncSession, *, only_user_id: int | None = None
) -> list[UserMetrics]:
    """
    Aggregate metrics for all users (optionally scoped to a single user). At
    company scale (tens–hundreds of users) a handful of grouped queries is ample.
    """
    user_q = select(User)
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
        ).where(Conversation.user_id.in_(ids), _HAS_USER_TURN)
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

    # Display order: most recently active first; never-active users fall to the
    # bottom, alphabetical among themselves (the dict keeps the query's username
    # order and Python's sort is stable). `.timestamp()` sidesteps naive/aware
    # datetime comparison differences between the SQLite and Azure SQL backends.
    ordered = list(metrics.values())
    ordered.sort(
        key=lambda m: (
            m.latest_activity is not None,
            m.latest_activity.timestamp() if m.latest_activity else 0.0,
        ),
        reverse=True,
    )
    return ordered


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

    # Make the page reconcile exactly: the total cost/tokens shown up top are the
    # sum of the per-conversation rows below (each row is rounded for display, so
    # summing the raw total would drift a few paise from the visible rows).
    rows_cost = round(sum(c["cost"] for c in conversations), 2)
    rows_tokens = sum(c["total_tokens"] for c in conversations)

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
            "employee_id": user.employee_id,
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
            "total_tokens": rows_tokens,
            "estimated_cost": rows_cost,
        },
        "conversations": conversations,
        "history": history,
    }


async def conversation_report(db: AsyncSession, conversation_id: int) -> dict | None:
    """Everything needed to render a persisted report for ONE conversation:
    metadata, the AI persona, statistics, the saved assessment (verbatim — never
    regenerated), and the full transcript in chronological order.

    Returns only stored data, so the report is identical every time it's opened.
    """
    convo = await db.get(Conversation, conversation_id)
    if convo is None:
        return None
    persona = await db.get(Persona, convo.persona_id)
    user = await db.get(User, convo.user_id)

    msg_rows = await db.execute(
        select(Message)
        .where(Message.conversation_id == conversation_id)
        .order_by(Message.turn_index)
    )
    messages = list(msg_rows.scalars().all())
    user_msgs = [m for m in messages if m.role == MessageRole.user]
    ai_msgs = [m for m in messages if m.role == MessageRole.assistant]
    user_words = sum(len(m.content.split()) for m in user_msgs)

    started = ensure_utc(convo.started_at)
    ended = ensure_utc(convo.ended_at)
    duration = (ended - started).total_seconds() if (started and ended) else None

    a_row = await db.execute(
        select(Assessment).where(Assessment.conversation_id == conversation_id)
    )
    a = a_row.scalar_one_or_none()
    assessment = None
    if a is not None:
        fb = json.loads(a.feedback_json) if a.feedback_json else {}
        assessment = {
            "overall_score": a.overall_score,
            "cefr_level": a.cefr_level,
            "fluency": a.fluency,
            "grammar": a.grammar,
            "vocabulary": a.vocabulary,
            "coherence": a.coherence,
            "code_mixing": a.code_mixing,
            "pronunciation": a.pronunciation,
            "summary": a.summary,
            "strengths": fb.get("strengths", []),
            "weaknesses": fb.get("weaknesses", []),
            "corrections": fb.get("corrections", []),
            "next_steps": fb.get("next_steps", []),
            "created_at": ensure_utc(a.created_at),
        }

    return {
        "conversation": {
            "id": convo.id,
            "persona_key": persona.key if persona else None,
            "persona_label": persona.label if persona else "—",
            "persona_emoji": persona.emoji if persona else None,
            "persona_accent": persona.accent_color if persona else None,
            "status": convo.status.value,
            "started_at": started,
            "ended_at": ended,
            "duration_seconds": duration,
            "live_score": convo.live_score,
            "live_level": convo.live_level,
            # Private examiner setup (if this was an interview). Shown in the
            # report above the transcript; never part of the scored transcript.
            "examiner_brief": convo.examiner_brief,
        },
        "employee": {
            "id": user.id if user else None,
            "employee_id": user.employee_id if user else None,
            "display_name": user.display_name if user else None,
            "username": user.username if user else None,
        },
        "stats": {
            "message_count": len(messages),
            "user_messages": len(user_msgs),
            "assistant_messages": len(ai_msgs),
            "user_words": user_words,
            "duration_seconds": duration,
        },
        "assessment": assessment,
        "messages": [
            {
                "id": m.id,
                "turn_index": m.turn_index,
                "role": m.role.value,
                "content": m.content,
                "created_at": ensure_utc(m.created_at),
            }
            for m in messages
        ],
    }


async def list_user_conversations(db: AsyncSession, user_id: int) -> list[dict]:
    """Conversations for one user with score/level, plus per-conversation token
    usage and estimated cost.

    Cost is priced exactly like the per-user totals in `compute_user_metrics`
    (chat=conversation model, scoring=scoring model, assessment=assessment
    model), so the rows here always sum to the employee's total cost shown up
    top — they can never disagree.
    """
    rows = await db.execute(
        select(
            Conversation,
            Persona.key,
            Persona.label,
            Assessment.overall_score,
            Assessment.cefr_level,
            Assessment.input_tokens,
            Assessment.output_tokens,
        )
        .join(Persona, Persona.id == Conversation.persona_id)
        .outerjoin(Assessment, Assessment.conversation_id == Conversation.id)
        .where(Conversation.user_id == user_id, _HAS_USER_TURN)
        .order_by(Conversation.started_at.desc())
    )

    # Live-scoring tokens (Haiku) summed per conversation.
    score_rows = await db.execute(
        select(
            Message.conversation_id,
            func.coalesce(func.sum(TurnScore.input_tokens), 0),
            func.coalesce(func.sum(TurnScore.output_tokens), 0),
        )
        .select_from(TurnScore)
        .join(Message, Message.id == TurnScore.message_id)
        .join(Conversation, Conversation.id == Message.conversation_id)
        .where(Conversation.user_id == user_id)
        .group_by(Message.conversation_id)
    )
    score_tokens = {cid: (int(sin), int(sout)) for cid, sin, sout in score_rows}

    out = []
    for convo, pkey, plabel, a_score, a_level, a_in, a_out in rows:
        chat_in, chat_out = convo.input_tokens or 0, convo.output_tokens or 0
        score_in, score_out = score_tokens.get(convo.id, (0, 0))
        assess_in, assess_out = a_in or 0, a_out or 0
        total_tokens = chat_in + chat_out + score_in + score_out + assess_in + assess_out
        usd = (
            cost.estimate_cost(_settings.model_conversation, chat_in, chat_out)
            + cost.estimate_cost(_settings.model_scoring, score_in, score_out)
            + cost.estimate_cost(_settings.model_assessment, assess_in, assess_out)
        )
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
                "total_tokens": total_tokens,
                "cost": round(usd * _settings.usd_to_inr, 2),
            }
        )
    return out
