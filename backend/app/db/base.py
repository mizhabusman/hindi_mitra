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


def _utcnow() -> dt.datetime:
    """Timezone-aware UTC now.

    Used as the Python-side default so created_at/updated_at are consistent UTC on
    every backend. SQL Server's CURRENT_TIMESTAMP / GETDATE() (what func.now()
    compiles to) returns *local server* time, which would disagree with the UTC
    the app sets everywhere else (started_at, last_login_at, …). SQLite's
    CURRENT_TIMESTAMP is already UTC; this makes both correct and identical.
    """
    return dt.datetime.now(dt.timezone.utc)


class TimestampMixin:
    """Adds created_at / updated_at columns, always stored in UTC."""

    created_at: Mapped[dt.datetime] = mapped_column(
        DateTime(timezone=True), default=_utcnow, server_default=func.now(), nullable=False
    )
    updated_at: Mapped[dt.datetime] = mapped_column(
        DateTime(timezone=True),
        default=_utcnow,
        onupdate=_utcnow,
        server_default=func.now(),
        nullable=False,
    )
