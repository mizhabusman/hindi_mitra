"""
Conversation endpoints.

  POST /api/conversations              → start; returns opener
  GET  /api/conversations              → list the user's conversations
  GET  /api/conversations/{id}         → conversation + full transcript
  POST /api/conversations/{id}/turns   → send a transcribed turn; streams reply (SSE)
  POST /api/conversations/{id}/end     → mark ended

The client sends a `persona_key` and utterance text only — never a system
prompt. Token usage is recorded from the real Anthropic response, so stats
cannot be forged by the client.
"""
from __future__ import annotations

import asyncio
import json

from fastapi import APIRouter, Depends, HTTPException, status
from fastapi.responses import StreamingResponse
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.config import Settings, get_settings
from app.core.dependencies import get_current_user
from app.core.ratelimit import RateLimiter
from app.db.models import Conversation, ConversationStatus, Persona, User
from app.db.session import SessionLocal, get_db
from app.schemas.assessment import AssessmentOut
from app.schemas.conversation import (
    ConversationDetail,
    ConversationOut,
    MessageOut,
    StartConversationRequest,
    StartConversationResponse,
    TurnRequest,
)
from app.services import (
    claude_client,
    conversation_service,
    persona_service,
    scoring_service,
)

router = APIRouter(prefix="/api/conversations", tags=["conversations"])

_turn_limiter = RateLimiter(get_settings().turn_max_per_minute, 60)


def _sse(payload: dict) -> str:
    return f"data: {json.dumps(payload, ensure_ascii=False)}\n\n"


@router.post("", response_model=StartConversationResponse, status_code=status.HTTP_201_CREATED)
async def start(
    body: StartConversationRequest,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
) -> StartConversationResponse:
    try:
        convo, opener = await conversation_service.start_conversation(
            db, user, body.persona_key, body.brief
        )
    except conversation_service.ConversationError as exc:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, str(exc))
    except claude_client.ClaudeError as exc:
        raise HTTPException(status.HTTP_502_BAD_GATEWAY, f"AI service error: {exc}")

    persona = await persona_service.get_by_key(db, body.persona_key)
    return StartConversationResponse(
        conversation=ConversationOut.from_model(convo, persona.key),
        opener=MessageOut.from_model(opener),
    )


@router.get("", response_model=list[ConversationOut])
async def list_conversations(
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
) -> list[ConversationOut]:
    result = await db.execute(
        select(Conversation)
        .options(selectinload(Conversation.persona))
        .where(Conversation.user_id == user.id)
        .order_by(Conversation.started_at.desc())
    )
    convos = result.scalars().all()
    return [ConversationOut.from_model(c, c.persona.key) for c in convos]


@router.get("/{conversation_id}", response_model=ConversationDetail)
async def get_conversation(
    conversation_id: int,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
) -> ConversationDetail:
    convo = await conversation_service.get_owned(db, conversation_id, user)
    if convo is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Conversation not found")
    persona = await db.get(Persona, convo.persona_id)
    messages = await conversation_service.load_messages(db, conversation_id)
    return ConversationDetail(
        conversation=ConversationOut.from_model(convo, persona.key),
        messages=[MessageOut.from_model(m) for m in messages],
    )


@router.post("/{conversation_id}/end", status_code=status.HTTP_204_NO_CONTENT)
async def end(
    conversation_id: int,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
) -> None:
    convo = await conversation_service.get_owned(db, conversation_id, user)
    if convo is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Conversation not found")
    await conversation_service.end_conversation(db, convo)


@router.post("/{conversation_id}/resume", response_model=ConversationDetail)
async def resume(
    conversation_id: int,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
) -> ConversationDetail:
    """Re-open a just-ended conversation (in-session 'Continue') so more turns
    append to the SAME conversation and the assessment covers the whole chat."""
    convo = await conversation_service.get_owned(db, conversation_id, user)
    if convo is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Conversation not found")
    await conversation_service.resume_conversation(db, convo)
    persona = await db.get(Persona, convo.persona_id)
    messages = await conversation_service.load_messages(db, conversation_id)
    return ConversationDetail(
        conversation=ConversationOut.from_model(convo, persona.key),
        messages=[MessageOut.from_model(m) for m in messages],
    )


@router.post("/{conversation_id}/turns")
async def send_turn(
    conversation_id: int,
    body: TurnRequest,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
    settings: Settings = Depends(get_settings),
) -> StreamingResponse:
    await _turn_limiter.check(f"user:{user.id}")
    convo = await conversation_service.get_owned(db, conversation_id, user)
    if convo is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Conversation not found")
    if convo.status != ConversationStatus.active:
        raise HTTPException(status.HTTP_409_CONFLICT, "Conversation has ended")

    text = body.text.strip()
    if not text:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Empty message")
    if len(text) > settings.max_message_chars:
        raise HTTPException(
            413, f"Message exceeds {settings.max_message_chars} characters"
        )

    messages = await conversation_service.load_messages(db, conversation_id)
    if len(messages) >= settings.max_turns_per_conversation:
        raise HTTPException(status.HTTP_409_CONFLICT, "Conversation turn limit reached")

    # Persist the user turn, then build the prompt for the reply.
    persona = await db.get(Persona, convo.persona_id)
    context = scoring_service.build_context(messages)
    user_msg = await conversation_service.record_user_message(db, convo, text)
    system = conversation_service.build_system_prompt(persona, convo.examiner_brief)
    history = conversation_service.history_for_api(messages) + [
        {"role": "user", "content": text}
    ]

    async def event_stream():
        # Score the user turn concurrently with generating the reply, so the
        # live score costs almost no extra wall-clock. Skipped entirely when the
        # user has turned the live coach off — no per-turn Claude call at all.
        score_task = (
            asyncio.create_task(
                scoring_service.score_turn(
                    message_id=user_msg.id,
                    conversation_id=conversation_id,
                    utterance=text,
                    context=context,
                    pronunciation=body.pronunciation,
                )
            )
            if body.live_coach
            else None
        )

        parts: list[str] = []
        usage = claude_client.Usage()
        try:
            # Short spoken replies: keep the cap low as a backstop so a reply
            # can never balloon into a lecture (the prompt asks for ~1 sentence).
            async for chunk in claude_client.stream(
                system=system, messages=history, max_tokens=200
            ):
                if isinstance(chunk, claude_client.Usage):
                    usage = chunk
                else:
                    parts.append(chunk)
                    yield _sse({"type": "delta", "text": chunk})
        except claude_client.ClaudeError as exc:
            if score_task is not None:
                score_task.cancel()
            yield _sse({"type": "error", "detail": str(exc)})
            return

        full_text = "".join(parts).strip() or "थोड़ी दिक्कत आई, फिर से बोलो ना?"
        # Persist the assistant turn in a fresh session (the request-scoped one
        # may be torn down once streaming begins).
        async with SessionLocal() as s:
            msg = await conversation_service.record_assistant_message(
                s, conversation_id, full_text, usage
            )
        yield _sse(
            {
                "type": "done",
                "message": {
                    "id": msg.id,
                    "turn_index": msg.turn_index,
                    "role": "assistant",
                    "content": full_text,
                },
                "usage": {
                    "input_tokens": usage.input_tokens,
                    "output_tokens": usage.output_tokens,
                },
            }
        )

        # Emit the live score + coach once scoring finishes (best-effort). When
        # the live coach is off there is no scoring task and nothing to emit.
        if score_task is not None:
            try:
                score = await score_task
            except asyncio.CancelledError:
                score = None
            if score is not None:
                yield _sse({"type": "score", **score})

    return StreamingResponse(
        event_stream(),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )


@router.post("/{conversation_id}/assessment", response_model=AssessmentOut)
async def create_assessment(
    conversation_id: int,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
) -> AssessmentOut:
    """Get-or-create the holistic end-of-conversation assessment.

    A conversation has exactly one assessment. Once generated it is returned
    as-is on every subsequent call — re-opening the report never regenerates
    it, so it costs tokens only once and the score can never drift between
    views.
    """
    convo = await conversation_service.get_owned(db, conversation_id, user)
    if convo is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Conversation not found")

    existing = await scoring_service.get_assessment(db, conversation_id)
    if existing is not None:
        return AssessmentOut.from_model(existing)

    messages = await conversation_service.load_messages(db, conversation_id)
    if not any(m.role.value == "user" for m in messages):
        raise HTTPException(
            status.HTTP_400_BAD_REQUEST, "Nothing to assess — no user turns yet"
        )
    persona = await db.get(Persona, convo.persona_id)
    try:
        assessment = await scoring_service.generate_assessment(db, convo, persona)
    except claude_client.ClaudeError as exc:
        raise HTTPException(status.HTTP_502_BAD_GATEWAY, f"AI service error: {exc}")
    return AssessmentOut.from_model(assessment)


@router.get("/{conversation_id}/assessment", response_model=AssessmentOut)
async def get_assessment(
    conversation_id: int,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
) -> AssessmentOut:
    convo = await conversation_service.get_owned(db, conversation_id, user)
    if convo is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Conversation not found")
    assessment = await scoring_service.get_assessment(db, conversation_id)
    if assessment is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "No assessment yet")
    return AssessmentOut.from_model(assessment)
