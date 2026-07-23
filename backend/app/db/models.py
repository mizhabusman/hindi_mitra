"""
ORM models — the full production schema.

Design notes
------------
* Conversations and every message are persisted (the prototype stored neither),
  so assessments can be regenerated and admins can review transcripts.
* Scoring is first-class: `turn_scores` holds the AI's per-turn judgement and
  `assessments` holds the end-of-conversation report. Neither is derived from
  client-supplied numbers.
* Personas are data, not code — admins can add/edit them without a deploy.
* Token/cost usage is recorded per message from the real Anthropic response.
"""
from __future__ import annotations

import datetime as dt
import enum

from sqlalchemy import (
    Boolean,
    DateTime,
    Enum,
    Float,
    ForeignKey,
    Integer,
    String,
    Text,
    UniqueConstraint,
)
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db.base import Base, TimestampMixin


# ── Enums ────────────────────────────────────────────────────────────
class UserRole(str, enum.Enum):
    employee = "employee"
    admin = "admin"


class ConversationStatus(str, enum.Enum):
    active = "active"
    ended = "ended"
    abandoned = "abandoned"


class MessageRole(str, enum.Enum):
    user = "user"
    assistant = "assistant"


# ── Users ────────────────────────────────────────────────────────────
class User(Base, TimestampMixin):
    __tablename__ = "users"

    id: Mapped[int] = mapped_column(primary_key=True)
    # Human-facing unique identifier (e.g. "EMP0007"), auto-assigned on creation
    # and backfilled for existing rows. Nullable only so the row can be inserted
    # before the id-derived value is set; every persisted user has one.
    employee_id: Mapped[str | None] = mapped_column(String(20), unique=True, index=True)
    username: Mapped[str] = mapped_column(String(150), unique=True, nullable=False, index=True)
    display_name: Mapped[str | None] = mapped_column(String(150))
    password_hash: Mapped[str] = mapped_column(String(255), nullable=False)
    role: Mapped[UserRole] = mapped_column(
        Enum(UserRole, native_enum=False, length=20), default=UserRole.employee, nullable=False
    )
    is_active: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)
    last_login_at: Mapped[dt.datetime | None] = mapped_column(DateTime(timezone=True))

    conversations: Mapped[list["Conversation"]] = relationship(
        back_populates="user", cascade="all, delete-orphan"
    )


# ── Personas (data-driven) ───────────────────────────────────────────
class Persona(Base, TimestampMixin):
    __tablename__ = "personas"

    id: Mapped[int] = mapped_column(primary_key=True)
    key: Mapped[str] = mapped_column(String(50), unique=True, nullable=False, index=True)
    label: Mapped[str] = mapped_column(String(120), nullable=False)      # e.g. "बिज़नेसमैन"
    emoji: Mapped[str | None] = mapped_column(String(16))
    accent_color: Mapped[str | None] = mapped_column(String(16))
    description: Mapped[str | None] = mapped_column(String(300))
    # The system prompt lives here — server-owned, never sent by the client.
    system_prompt: Mapped[str] = mapped_column(Text, nullable=False)
    # Voice tuning (persona-specific TTS hints), stored as free-form JSON text.
    voice_config: Mapped[str | None] = mapped_column(Text)
    is_active: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)
    sort_order: Mapped[int] = mapped_column(Integer, default=100, nullable=False)

    conversations: Mapped[list["Conversation"]] = relationship(back_populates="persona")


# ── Conversations & messages ─────────────────────────────────────────
class Conversation(Base, TimestampMixin):
    __tablename__ = "conversations"

    id: Mapped[int] = mapped_column(primary_key=True)
    user_id: Mapped[int] = mapped_column(
        ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True
    )
    persona_id: Mapped[int] = mapped_column(
        ForeignKey("personas.id", ondelete="NO ACTION"), nullable=False
    )
    status: Mapped[ConversationStatus] = mapped_column(
        Enum(ConversationStatus, native_enum=False, length=20),
        default=ConversationStatus.active,
        nullable=False,
    )
    started_at: Mapped[dt.datetime] = mapped_column(
        DateTime(timezone=True), nullable=False
    )
    ended_at: Mapped[dt.datetime | None] = mapped_column(DateTime(timezone=True))

    # Optional private examiner setup (instructions/questions). Injected into the
    # system prompt so the AI conducts the interview accordingly, but never stored
    # as a message — so it's invisible to the candidate and excluded from scoring,
    # the transcript, and the assessment.
    examiner_brief: Mapped[str | None] = mapped_column(Text)

    # Running (live) score, updated as turns are scored. 0–100 composite.
    live_score: Mapped[float | None] = mapped_column(Float)
    live_level: Mapped[str | None] = mapped_column(String(4))  # CEFR band e.g. "B1"

    # Server-side usage roll-up (derived from real API responses, not client).
    input_tokens: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    output_tokens: Mapped[int] = mapped_column(Integer, default=0, nullable=False)

    user: Mapped["User"] = relationship(back_populates="conversations")
    persona: Mapped["Persona"] = relationship(back_populates="conversations")
    messages: Mapped[list["Message"]] = relationship(
        back_populates="conversation",
        cascade="all, delete-orphan",
        order_by="Message.turn_index",
    )
    assessment: Mapped["Assessment | None"] = relationship(
        back_populates="conversation", cascade="all, delete-orphan", uselist=False
    )


class Message(Base, TimestampMixin):
    __tablename__ = "messages"
    __table_args__ = (
        UniqueConstraint("conversation_id", "turn_index", name="uq_message_turn"),
    )

    id: Mapped[int] = mapped_column(primary_key=True)
    conversation_id: Mapped[int] = mapped_column(
        ForeignKey("conversations.id", ondelete="CASCADE"), nullable=False, index=True
    )
    turn_index: Mapped[int] = mapped_column(Integer, nullable=False)
    role: Mapped[MessageRole] = mapped_column(
        Enum(MessageRole, native_enum=False, length=20), nullable=False
    )
    content: Mapped[str] = mapped_column(Text, nullable=False)

    # Per-message usage (assistant turns carry real token counts).
    input_tokens: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    output_tokens: Mapped[int] = mapped_column(Integer, default=0, nullable=False)

    conversation: Mapped["Conversation"] = relationship(back_populates="messages")
    turn_score: Mapped["TurnScore | None"] = relationship(
        back_populates="message", cascade="all, delete-orphan", uselist=False
    )


# ── Scoring ──────────────────────────────────────────────────────────
class TurnScore(Base, TimestampMixin):
    """AI judgement of a single user turn. Dimensions are 0–100."""

    __tablename__ = "turn_scores"

    id: Mapped[int] = mapped_column(primary_key=True)
    message_id: Mapped[int] = mapped_column(
        ForeignKey("messages.id", ondelete="CASCADE"), unique=True, nullable=False
    )

    fluency: Mapped[float | None] = mapped_column(Float)
    grammar: Mapped[float | None] = mapped_column(Float)
    vocabulary: Mapped[float | None] = mapped_column(Float)
    coherence: Mapped[float | None] = mapped_column(Float)
    # How much the speaker leaned on English rather than Hindi (0 = all Hindi).
    code_mixing: Mapped[float | None] = mapped_column(Float)
    # Phoneme-level pronunciation (0–100) from Azure Speech; null if unavailable.
    pronunciation: Mapped[float | None] = mapped_column(Float)
    composite: Mapped[float | None] = mapped_column(Float)  # 0–100 overall for the turn
    cefr_level: Mapped[str | None] = mapped_column(String(4))

    notes: Mapped[str | None] = mapped_column(Text)          # short rationale
    rubric_version: Mapped[str] = mapped_column(String(20), default="v1", nullable=False)
    scoring_model: Mapped[str | None] = mapped_column(String(60))
    # Usage for this scoring call (kept separate so cost is priced per model).
    input_tokens: Mapped[int] = mapped_column(Integer, server_default="0", default=0, nullable=False)
    output_tokens: Mapped[int] = mapped_column(Integer, server_default="0", default=0, nullable=False)

    message: Mapped["Message"] = relationship(back_populates="turn_score")


class Assessment(Base, TimestampMixin):
    """End-of-conversation holistic report over the entire transcript."""

    __tablename__ = "assessments"

    id: Mapped[int] = mapped_column(primary_key=True)
    conversation_id: Mapped[int] = mapped_column(
        ForeignKey("conversations.id", ondelete="CASCADE"), unique=True, nullable=False
    )

    overall_score: Mapped[float] = mapped_column(Float, nullable=False)  # 0–100
    cefr_level: Mapped[str] = mapped_column(String(4), nullable=False)

    fluency: Mapped[float | None] = mapped_column(Float)
    grammar: Mapped[float | None] = mapped_column(Float)
    vocabulary: Mapped[float | None] = mapped_column(Float)
    coherence: Mapped[float | None] = mapped_column(Float)
    code_mixing: Mapped[float | None] = mapped_column(Float)
    # Average measured pronunciation across the conversation (Azure); null if none.
    pronunciation: Mapped[float | None] = mapped_column(Float)

    # Narrative feedback, stored as JSON text: strengths[], weaknesses[],
    # corrections[], next_steps[]. Kept as Text for portability across DBs.
    summary: Mapped[str | None] = mapped_column(Text)
    feedback_json: Mapped[str | None] = mapped_column(Text)

    rubric_version: Mapped[str] = mapped_column(String(20), default="v1", nullable=False)
    assessment_model: Mapped[str | None] = mapped_column(String(60))
    input_tokens: Mapped[int] = mapped_column(Integer, server_default="0", default=0, nullable=False)
    output_tokens: Mapped[int] = mapped_column(Integer, server_default="0", default=0, nullable=False)

    conversation: Mapped["Conversation"] = relationship(back_populates="assessment")
