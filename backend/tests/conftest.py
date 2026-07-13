"""
Test fixtures.

The suite is hermetic and free:
  * a fresh temp SQLite DB per session (HINDIMITRA_SQLITE_FILE override),
  * the Anthropic client stubbed so no real API calls are made,
  * tables created via metadata; personas + admin seeded by the app's lifespan.

IMPORTANT: environment is configured at import time, before any app module is
imported, so the module-level engine binds to the test database.
"""
from __future__ import annotations

import asyncio
import os
import tempfile
from collections.abc import AsyncIterator
from pathlib import Path

# ── Configure environment BEFORE importing the app ───────────────────
_TMP = tempfile.mkdtemp(prefix="hindimitra_test_")
os.environ["HINDIMITRA_SQLITE_FILE"] = str(Path(_TMP) / "test.db")
os.environ["DATABASE_URL"] = ""  # force SQLite, ignore any real .env value
os.environ["ANTHROPIC_API_KEY"] = "test-key-not-used"
os.environ["ADMIN_USERNAME"] = "admin"
os.environ["ADMIN_PASSWORD"] = "admin-pass-123"
os.environ["SECRET_KEY"] = "test-secret-key"
os.environ["ENVIRONMENT"] = "development"
# Effectively disable rate limits for the suite (all tests share one IP).
os.environ["LOGIN_MAX_ATTEMPTS"] = "100000"
os.environ["TURN_MAX_PER_MINUTE"] = "100000"

import pytest  # noqa: E402
from fastapi.testclient import TestClient  # noqa: E402

from app.db.base import Base  # noqa: E402
from app.db import models  # noqa: E402,F401  (register tables)
from app.db.session import engine  # noqa: E402
from app.main import app  # noqa: E402
from app.services import claude_client  # noqa: E402

ADMIN_USER = "admin"
ADMIN_PASS = "admin-pass-123"


@pytest.fixture(scope="session", autouse=True)
def _create_schema():
    async def create():
        async with engine.begin() as conn:
            await conn.run_sync(Base.metadata.create_all)
    asyncio.run(create())
    yield


@pytest.fixture(autouse=True)
def _stub_claude(monkeypatch):
    """Replace all Anthropic calls with deterministic fakes."""

    async def fake_complete(*, system, messages, model=None, max_tokens=500):
        return "नमस्ते! आप कैसे हैं?", claude_client.Usage(12, 6)

    async def fake_stream(*, system, messages, model=None, max_tokens=500) -> AsyncIterator:
        for chunk in ["बहुत ", "बढ़िया, ", "और सुनाइए?"]:
            yield chunk
        yield claude_client.Usage(30, 10)

    async def fake_structured(*, system, messages, schema, model, max_tokens=1024, cache_system=True):
        props = schema.get("properties", {})
        if "overall_score" in props:  # assessment
            data = {
                "overall_score": 62.0, "cefr_level": "B1",
                "fluency": 65, "grammar": 60, "vocabulary": 63,
                "coherence": 64, "code_mixing": 20,
                "summary": "Solid conversational Hindi at a B1 level.",
                "strengths": ["Good sentence flow", "Relevant answers"],
                "weaknesses": ["Occasional gender agreement slips"],
                "corrections": [{"said": "main gaya", "better": "मैं गई", "why": "gender agreement"}],
                "next_steps": ["Practice past-tense gender", "Expand vocabulary"],
            }
            return data, claude_client.Usage(400, 120)
        # turn score
        data = {
            "fluency": 70, "grammar": 65, "vocabulary": 68, "coherence": 72,
            "code_mixing": 15, "composite": 69.0, "cefr_level": "B1",
            "notes": "Nice — try a longer sentence next time.",
        }
        return data, claude_client.Usage(60, 20)

    monkeypatch.setattr(claude_client, "complete", fake_complete)
    monkeypatch.setattr(claude_client, "stream", fake_stream)
    monkeypatch.setattr(claude_client, "structured", fake_structured)
    yield


@pytest.fixture
def client() -> AsyncIterator[TestClient]:
    # Entering the context runs the app lifespan → seeds personas + admin.
    with TestClient(app) as c:
        yield c


@pytest.fixture
def admin_client(client: TestClient) -> TestClient:
    r = client.post("/api/auth/login", json={"username": ADMIN_USER, "password": ADMIN_PASS})
    assert r.status_code == 200, r.text
    return client
