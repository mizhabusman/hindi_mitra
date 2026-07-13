"""
First-run bootstrap: seed personas and reconcile the single admin account.

Idempotent — safe to run on every startup:
  * Personas are synced from personas.yaml.
  * Exactly ONE admin exists, matching ADMIN_USERNAME / ADMIN_PASSWORD from the
    environment. The configured admin is created (or updated to the configured
    username + password), and any OTHER admin accounts are removed — so demo /
    stray admins can never linger or be used to log in.
"""
from __future__ import annotations

import logging

from sqlalchemy import select

from app.config import get_settings
from app.core.security import hash_password
from app.db.models import User, UserRole
from app.db.session import SessionLocal
from app.services import persona_service, user_service

logger = logging.getLogger("hindimitra.bootstrap")


async def run_bootstrap() -> None:
    settings = get_settings()
    async with SessionLocal() as db:
        created = await persona_service.seed_defaults(db)
        if created:
            logger.info("Seeded %d persona(s).", created)

        admin_user = settings.admin_username.strip()
        admin_pass = settings.admin_password
        if not (admin_user and admin_pass):
            return

        # Ensure the single configured admin exists with the exact username +
        # password (username lookup is case-insensitive).
        admin = await user_service.get_by_username(db, admin_user)
        if admin is None:
            admin = await user_service.create_user(
                db, username=admin_user, password=admin_pass,
                display_name=admin_user, role=UserRole.admin,
            )
            logger.info("Created admin account '%s'.", admin_user)
        else:
            admin.username = admin_user
            admin.display_name = admin_user
            admin.password_hash = hash_password(admin_pass)
            admin.role = UserRole.admin
            admin.is_active = True
            await db.commit()

        # Enforce a single admin: remove any other admin-role accounts (and
        # their data cascades away). Employees are untouched.
        result = await db.execute(select(User).where(User.role == UserRole.admin))
        removed = 0
        for u in result.scalars().all():
            if u.id != admin.id:
                await db.delete(u)
                removed += 1
        if removed:
            await db.commit()
            logger.info("Removed %d stray admin account(s).", removed)
