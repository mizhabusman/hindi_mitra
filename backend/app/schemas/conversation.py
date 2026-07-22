"""Conversation & message schemas."""
from __future__ import annotations


from pydantic import BaseModel, Field

from app.db.models import Conversation, ConversationStatus, Message, MessageRole
from app.schemas._types import UtcDateTime


class StartConversationRequest(BaseModel):
    persona_key: str = Field(..., min_length=1, max_length=50)
    # Optional examiner setup: private instructions/questions the interviewer
    # writes before starting. Steers the AI (which asks them in Hindi) but is
    # stored as session context — never a chat message — so it is never shown to
    # the candidate, never scored, and never in the transcript or assessment.
    brief: str | None = Field(None, max_length=4000)


class BriefAppendRequest(BaseModel):
    # A live examiner instruction added mid-conversation. Appended to the
    # conversation's brief (system prompt only) — never a chat message, so it
    # stays out of the transcript, scoring, and the assessment.
    text: str = Field(..., min_length=1, max_length=1000)


class TurnRequest(BaseModel):
    # The transcribed user utterance. Length is enforced server-side too.
    text: str = Field(..., min_length=1)
    # Optional 0–100 pronunciation score from Azure Speech (client-measured).
    pronunciation: float | None = Field(None, ge=0, le=100)
    # When false, the live scoring + AI-coach call is skipped entirely for this
    # turn (no per-turn Claude cost). The end-of-conversation assessment is
    # unaffected. Defaults to on.
    live_coach: bool = True


class MessageOut(BaseModel):
    id: int
    turn_index: int
    role: MessageRole
    content: str
    created_at: UtcDateTime

    @classmethod
    def from_model(cls, m: Message) -> "MessageOut":
        return cls(
            id=m.id,
            turn_index=m.turn_index,
            role=m.role,
            content=m.content,
            created_at=m.created_at,
        )


class ConversationOut(BaseModel):
    id: int
    persona_key: str
    status: ConversationStatus
    started_at: UtcDateTime
    ended_at: UtcDateTime | None
    live_score: float | None
    live_level: str | None
    input_tokens: int
    output_tokens: int

    @classmethod
    def from_model(cls, c: Conversation, persona_key: str) -> "ConversationOut":
        return cls(
            id=c.id,
            persona_key=persona_key,
            status=c.status,
            started_at=c.started_at,
            ended_at=c.ended_at,
            live_score=c.live_score,
            live_level=c.live_level,
            input_tokens=c.input_tokens,
            output_tokens=c.output_tokens,
        )


class StartConversationResponse(BaseModel):
    conversation: ConversationOut
    opener: MessageOut


class ConversationDetail(BaseModel):
    conversation: ConversationOut
    messages: list[MessageOut]
