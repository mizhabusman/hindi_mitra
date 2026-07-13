"""
Declarative base and shared column mixins.

We use SQLAlchemy 2.0 typed models (`Mapped` / `mapped_column`). Timestamps are
timezone-aware and default to server-side `now()` where the backend supports it.
"""
from __future__ import annotations

import datetime as dt

from sqlalchemy import DateTime, func
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column


class Base(DeclarativeBase):
    """Base class for all ORM models."""


class TimestampMixin:
    """Adds created_at / updated_at columns."""

    created_at: Mapped[dt.datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )
    updated_at: Mapped[dt.datetime] = mapped_column(
        DateTime(timezone=True),
        server_default=func.now(),
        onupdate=func.now(),
        nullable=False,
    )
