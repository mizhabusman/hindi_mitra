"""
User service: creation, lookup, authentication.

Keeps all password handling and uniqueness rules in one place so routers never
touch hashing or raw SQL.
"""
from __future__ import annotations

import datetime as dt

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.security import hash_password, verify_password
from app.db.models import User, UserRole


class UsernameTakenError(ValueError):
    """Raised when creating a user whose username already exists."""


async def get_by_id(db: AsyncSession, user_id: int) -> User | None:
    return await db.get(User, user_id)


async def get_by_username(db: AsyncSession, username: str) -> User | None:
    result = await db.execute(
        select(User).where(func.lower(User.username) == username.strip().lower())
    )
    return result.scalar_one_or_none()


async def create_user(
    db: AsyncSession,
    *,
    username: str,
    password: str,
    display_name: str | None = None,
    role: UserRole = UserRole.employee,
    team_id: int | None = None,
) -> User:
    username = username.strip()
    if not username or not password:
        raise ValueError("Username and password are required.")
    if await get_by_username(db, username) is not None:
        raise UsernameTakenError("That username already exists.")

    user = User(
        username=username,
        display_name=display_name or username,
        password_hash=hash_password(password),
        role=role,
        team_id=team_id,
    )
    db.add(user)
    await db.commit()
    await db.refresh(user)
    return user


async def authenticate(db: AsyncSession, username: str, password: str) -> User | None:
    user = await get_by_username(db, username)
    if user is None or not user.is_active:
        return None
    if not verify_password(password, user.password_hash):
        return None
    user.last_login_at = dt.datetime.now(dt.timezone.utc)
    await db.commit()
    return user


async def list_active_employees(db: AsyncSession) -> list[User]:
    """Active employees, for the login dropdown (name only exposed by the API)."""
    result = await db.execute(
        select(User)
        .where(User.role == UserRole.employee, User.is_active.is_(True))
        .order_by(User.display_name, User.username)
    )
    return list(result.scalars().all())


async def authenticate_admin(db: AsyncSession, password: str) -> User | None:
    """Password-only admin login: match the password against any active admin."""
    result = await db.execute(
        select(User).where(User.role == UserRole.admin, User.is_active.is_(True))
    )
    for user in result.scalars().all():
        if verify_password(password, user.password_hash):
            user.last_login_at = dt.datetime.now(dt.timezone.utc)
            await db.commit()
            return user
    return None


async def authenticate_by_id(db: AsyncSession, user_id: int, password: str) -> User | None:
    """Login a specific user (chosen from the employee dropdown) by id + password."""
    user = await get_by_id(db, user_id)
    if user is None or not user.is_active:
        return None
    if not verify_password(password, user.password_hash):
        return None
    user.last_login_at = dt.datetime.now(dt.timezone.utc)
    await db.commit()
    return user
