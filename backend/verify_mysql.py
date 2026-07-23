"""One-shot MySQL compatibility check for Hindi Mitra.

Proves the app works on the configured MySQL: the connection is utf8mb4, every
table exists, the app's own bootstrap seeds cleanly, and Hindi (Devanagari) +
emoji round-trip EXACTLY through the tables the app writes during real use.
Makes NO Claude API calls, so it's free and fast.

Usage (after the DB exists and `alembic upgrade head` has run):

    cd backend
    export ANTHROPIC_API_KEY=dummy            # not called; only needed to load settings
    export ADMIN_USERNAME=admin ADMIN_PASSWORD=probe-pw
    export DATABASE_URL="mysql+aiomysql://root:rootpw@127.0.0.1:3306/hindimitra"   # local test
    #   (production uses  mysql://user:pass@host:3306/db  → asyncmy driver)
    python verify_mysql.py

Exit code 0 = all checks passed.
"""
from __future__ import annotations

import asyncio
import sys
from datetime import datetime, timezone

sys.stdout.reconfigure(encoding="utf-8")

from sqlalchemy import select, text

from app.bootstrap import run_bootstrap
from app.config import get_settings
from app.db.models import (
    Conversation,
    ConversationStatus,
    Message,
    MessageRole,
    Persona,
    User,
    UserRole,
)
from app.db.session import SessionLocal, engine

SAMPLE = "नमस्ते 🙂 ERP सॉफ्टवेयर बनाना — परीक्षा ✅"


def _devanagari(s: str | None) -> bool:
    return any("ऀ" <= c <= "ॿ" for c in (s or ""))


async def main() -> None:
    settings = get_settings()
    assert settings.uses_server_db, "DATABASE_URL is not set — point it at MySQL first."
    print("Target DB:", settings.async_database_url.split("@")[-1])  # host/db only (no creds)
    ok = True

    # 1) Connection charset + tables (proves migrations ran on utf8mb4)
    async with engine.connect() as conn:
        cs = (await conn.execute(text("SELECT @@character_set_connection"))).scalar()
        print(("[OK]  " if cs == "utf8mb4" else "[FAIL] ") + f"connection charset = {cs}")
        ok &= cs == "utf8mb4"
        tables = {r[0] for r in (await conn.execute(text("SHOW TABLES")))}
        need = {"users", "personas", "conversations", "messages",
                "turn_scores", "assessments", "alembic_version"}
        missing = need - tables
        print(("[OK]  " if not missing else "[FAIL] ") + f"tables: {sorted(tables)}")
        if missing:
            print("        MISSING:", missing)
        ok &= not missing

    # 2) The app's real seed path (personas carry Hindi labels + emoji)
    await run_bootstrap()
    async with SessionLocal() as db:
        personas = list((await db.execute(select(Persona))).scalars().all())
        hindi = [p for p in personas if _devanagari(p.label)]
        emoji = [p for p in personas if (p.emoji or "")]
        print(("[OK]  " if personas else "[FAIL] ") + f"bootstrap seeded {len(personas)} personas")
        print(("[OK]  " if hindi else "[FAIL] ") + f"Devanagari label round-trip, e.g. {hindi[0].label if hindi else '(none)'}")
        print(("[OK]  " if emoji else "[FAIL] ") + f"emoji round-trip, e.g. {emoji[0].emoji if emoji else '(none)'}")
        ok &= bool(personas) and bool(hindi)

        # 3) Hot-path round-trip: write Hindi + emoji into the tables the app uses
        user = (await db.execute(select(User))).scalars().first()
        if user is None:
            user = User(username="mysql_probe", password_hash="probe",
                        role=UserRole.employee, display_name="जाँच 🙂")
            db.add(user)
            await db.flush()
        convo = Conversation(
            user_id=user.id, persona_id=personas[0].id,
            status=ConversationStatus.active,
            started_at=datetime.now(timezone.utc), examiner_brief=SAMPLE,
        )
        db.add(convo)
        await db.flush()
        db.add(Message(conversation_id=convo.id, turn_index=0,
                       role=MessageRole.user, content=SAMPLE))
        await db.commit()
        cid = convo.id

    async with SessionLocal() as db:
        c2 = await db.get(Conversation, cid)
        m2 = (await db.execute(select(Message).where(Message.conversation_id == cid))).scalars().first()
        print(("[OK]  " if c2.examiner_brief == SAMPLE else "[FAIL] ") + "examiner_brief exact round-trip")
        print(("[OK]  " if m2.content == SAMPLE else "[FAIL] ") + "message content exact round-trip")
        print("        stored:", repr(c2.examiner_brief))
        ok &= c2.examiner_brief == SAMPLE and m2.content == SAMPLE
        await db.delete(c2)  # cleanup the probe conversation
        await db.commit()

    await engine.dispose()
    print()
    print("ALL CHECKS PASSED — the app works on MySQL." if ok
          else "SOME CHECKS FAILED — see above.")
    sys.exit(0 if ok else 1)


if __name__ == "__main__":
    asyncio.run(main())
