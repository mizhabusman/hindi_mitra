"""
Async engine and session management.

Exposes:
  * `engine` / `SessionLocal` — module-level async engine + session factory
  * `get_db()` — FastAPI dependency yielding a session per request
"""
from __future__ import annotations

from collections.abc import AsyncGenerator

from sqlalchemy.ext.asyncio import (
    AsyncSession,
    async_sessionmaker,
    create_async_engine,
)

from app.config import get_settings

_settings = get_settings()

# SQLite needs no pool tuning; Postgres benefits from pre-ping to survive
# dropped connections on managed cloud databases. A single streamed turn
# writes from two concurrent sessions (assistant message + live score) — on
# SQLite we give the writer a generous busy timeout so they never contend.
_engine_kwargs: dict = {"echo": _settings.debug, "future": True}
if _settings.uses_postgres:
    _engine_kwargs.update(pool_pre_ping=True, pool_size=10, max_overflow=20)
else:
    _engine_kwargs["connect_args"] = {"timeout": 30}

engine = create_async_engine(_settings.async_database_url, **_engine_kwargs)

SessionLocal = async_sessionmaker(
    bind=engine, expire_on_commit=False, class_=AsyncSession
)


async def get_db() -> AsyncGenerator[AsyncSession, None]:
    """Yield a database session, rolling back on error and always closing."""
    async with SessionLocal() as session:
        try:
            yield session
        except Exception:
            await session.rollback()
            raise
