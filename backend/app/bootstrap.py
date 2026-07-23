"""
First-run bootstrap: seed personas and reconcile the single admin account.

Idempotent — safe to run on every startup:
  * Personas are synced from personas.yaml.
  * The single admin is SEEDED from ADMIN_USERNAME / ADMIN_PASSWORD only when no
    admin exists yet. If an admin already exists, its credentials are left
    untouched (name/password are managed in-app and must survive restarts) — so
    ADMIN_PASSWORD in the environment applies only on the FIRST boot against an
    empty database, not as an ongoing password reset. Any extra/stray admin
    accounts are removed, leaving exactly one.
"""
from __future__ import annotations

import logging

from sqlalchemy import select

from app.config import get_settings
from app.db.models import User, UserRole
from app.db.session import SessionLocal
from app.services import conversation_service, persona_service, user_service

logger = logging.getLogger("hindimitra.bootstrap")


async def run_bootstrap() -> None:
    settings = get_settings()
    async with SessionLocal() as db:
        created = await persona_service.seed_defaults(db)
        if created:
            logger.info("Seeded %d persona(s).", created)

        # Close conversations left 'active' after the user navigated away.
        closed = await conversation_service.abandon_stale(db)
        if closed:
            logger.info("Marked %d stale conversation(s) as abandoned.", closed)

        admin_user = settings.admin_username.strip()
        admin_pass = settings.admin_password

        # The admin's name + password are managed IN-APP (Change name / Change
        # password). So .env is only the initial SEED: if no admin exists yet we
        # create one from it; if an admin already exists we leave its credentials
        # alone (never reset them on restart, or UI changes would be wiped).
        result = await db.execute(select(User).where(User.role == UserRole.admin).order_by(User.id))
        admins = list(result.scalars().all())

        if not admins:
            if admin_user and admin_pass:
                await user_service.create_user(
                    db, username=admin_user, password=admin_pass,
                    display_name=admin_user, role=UserRole.admin,
                )
                logger.info("Seeded admin account '%s' from environment.", admin_user)
            return

        # Enforce a single admin: keep the oldest, remove any strays (cascades
        # their data). The kept admin's credentials are preserved as-is.
        removed = 0
        for u in admins[1:]:
            await db.delete(u)
            removed += 1
        if removed:
            await db.commit()
            logger.info("Removed %d stray admin account(s).", removed)
