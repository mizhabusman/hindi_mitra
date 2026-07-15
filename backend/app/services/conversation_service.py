"""
Conversation service — the heart of Phase 2.

Responsibilities:
  * Assemble the system prompt server-side (persona prompt + shared rules).
    The client never sends a system prompt.
  * Start a conversation and generate the persona's opener.
  * Persist every user and assistant message with real token usage.
  * Provide history to the Claude client in API shape.

Scoring hooks (Phase 3) will attach to `record_user_turn`.
"""
from __future__ import annotations

import datetime as dt

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import get_settings
from app.core.timeutil import ensure_utc
from app.db.models import (
    Assessment,
    Conversation,
    ConversationStatus,
    Message,
    MessageRole,
    Persona,
    User,
)
from app.services import claude_client, persona_service

_settings = get_settings()

# Kickoff instruction sent (as the first user turn) to elicit the opener.
_OPENER_PROMPT = "बातचीत शुरू करो — मुझे एक छोटा सा अभिवादन करो और एक सवाल पूछो।"


class ConversationError(RuntimeError):
    pass


def _now() -> dt.datetime:
    return dt.datetime.now(dt.timezone.utc)


def build_system_prompt(persona: Persona) -> str:
    """Persona character + the shared spoken-conversation rules (server-owned)."""
    return f"{persona.system_prompt.strip()}\n\n{persona_service.common_rules()}"


def history_for_api(messages: list[Message]) -> list[dict]:
    """Convert stored messages into Anthropic message dicts, in turn order."""
    return [{"role": m.role.value, "content": m.content} for m in messages]


async def _next_turn_index(db: AsyncSession, conversation_id: int) -> int:
    result = await db.execute(
        select(func.count(Message.id)).where(Message.conversation_id == conversation_id)
    )
    return int(result.scalar_one())


async def get_owned(db: AsyncSession, conversation_id: int, user: User) -> Conversation | None:
    """Fetch a conversation only if it belongs to the requesting user."""
    convo = await db.get(Conversation, conversation_id)
    if convo is None or convo.user_id != user.id:
        return None
    return convo


async def load_messages(db: AsyncSession, conversation_id: int) -> list[Message]:
    result = await db.execute(
        select(Message)
        .where(Message.conversation_id == conversation_id)
        .order_by(Message.turn_index)
    )
    return list(result.scalars().all())


async def start_conversation(
    db: AsyncSession, user: User, persona_key: str
) -> tuple[Conversation, Message]:
    """Create a conversation and generate the persona's opening message."""
    persona = await persona_service.get_by_key(db, persona_key)
    if persona is None or not persona.is_active:
        raise ConversationError(f"Unknown or inactive persona: {persona_key!r}")

    convo = Conversation(
        user_id=user.id,
        persona_id=persona.id,
        status=ConversationStatus.active,
        started_at=_now(),
    )
    db.add(convo)
    await db.flush()  # assign convo.id

    system = build_system_prompt(persona)
    text, usage = await claude_client.complete(
        system=system,
        messages=[{"role": "user", "content": _OPENER_PROMPT}],
        max_tokens=150,
    )
    if not text:
        text = "नमस्ते! कैसे हो आप?"

    opener = Message(
        conversation_id=convo.id,
        turn_index=0,
        role=MessageRole.assistant,
        content=text,
        input_tokens=usage.input_tokens,
        output_tokens=usage.output_tokens,
    )
    db.add(opener)
    convo.input_tokens += usage.input_tokens
    convo.output_tokens += usage.output_tokens
    await db.commit()
    await db.refresh(convo)
    await db.refresh(opener)
    return convo, opener


async def record_user_message(
    db: AsyncSession, conversation: Conversation, text: str
) -> Message:
    """Persist a user turn. Returns the stored Message (for scoring in Phase 3)."""
    idx = await _next_turn_index(db, conversation.id)
    msg = Message(
        conversation_id=conversation.id,
        turn_index=idx,
        role=MessageRole.user,
        content=text,
    )
    db.add(msg)
    await db.commit()
    await db.refresh(msg)
    return msg


async def record_assistant_message(
    db: AsyncSession,
    conversation_id: int,
    text: str,
    usage: claude_client.Usage,
) -> Message:
    """Persist an assistant turn and roll usage up to the conversation."""
    idx = await _next_turn_index(db, conversation_id)
    msg = Message(
        conversation_id=conversation_id,
        turn_index=idx,
        role=MessageRole.assistant,
        content=text,
        input_tokens=usage.input_tokens,
        output_tokens=usage.output_tokens,
    )
    db.add(msg)
    convo = await db.get(Conversation, conversation_id)
    if convo is not None:
        convo.input_tokens += usage.input_tokens
        convo.output_tokens += usage.output_tokens
    await db.commit()
    await db.refresh(msg)
    return msg


async def resume_conversation(db: AsyncSession, conversation: Conversation) -> None:
    """Re-open a just-ended conversation so the user can keep going in the SAME
    conversation (in-session "Continue"). Any prior assessment is discarded so
    the next one is generated over the whole extended transcript (one combined
    report)."""
    conversation.status = ConversationStatus.active
    conversation.ended_at = None
    existing = await db.execute(
        select(Assessment).where(Assessment.conversation_id == conversation.id)
    )
    old = existing.scalar_one_or_none()
    if old is not None:
        await db.delete(old)
    await db.commit()


async def _user_turn_count(db: AsyncSession, conversation_id: int) -> int:
    result = await db.execute(
        select(func.count(Message.id)).where(
            Message.conversation_id == conversation_id,
            Message.role == MessageRole.user,
        )
    )
    return int(result.scalar_one())


async def end_conversation(db: AsyncSession, conversation: Conversation) -> None:
    # A conversation only counts once the user has actually spoken. If they left
    # after just the AI opener, drop it entirely rather than record an empty one.
    if await _user_turn_count(db, conversation.id) == 0:
        await db.delete(conversation)  # cascade removes the opener
        await db.commit()
        return
    conversation.status = ConversationStatus.ended
    conversation.ended_at = _now()
    await db.commit()


async def abandon_stale(db: AsyncSession, idle_minutes: int = 30) -> int:
    """Close conversations left 'active' after the user walked away.

    A conversation only becomes 'ended' when the user explicitly ends it, so
    sessions where they closed the tab or navigated away linger as 'active'.
    This marks any active conversation with no message in the last
    `idle_minutes` as 'abandoned', stamping ended_at with the last activity so
    practice-time metrics stay accurate (and never inflated). Returns the count.
    """
    cutoff = _now() - dt.timedelta(minutes=idle_minutes)
    result = await db.execute(
        select(Conversation).where(Conversation.status == ConversationStatus.active)
    )
    closed = 0
    removed = 0
    for convo in result.scalars().all():
        last_row = await db.execute(
            select(func.max(Message.created_at)).where(Message.conversation_id == convo.id)
        )
        last = last_row.scalar_one_or_none() or convo.started_at
        last_utc = ensure_utc(last)
        if last_utc is None or last_utc >= cutoff:
            continue
        # Stale. Drop it if the user never replied (only the opener); otherwise
        # mark it abandoned so its practice time still counts.
        if await _user_turn_count(db, convo.id) == 0:
            await db.delete(convo)
            removed += 1
        else:
            convo.status = ConversationStatus.abandoned
            convo.ended_at = last
            closed += 1
    if closed or removed:
        await db.commit()
    return closed
