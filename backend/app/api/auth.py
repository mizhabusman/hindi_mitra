"""
Authentication endpoints (JSON API for the SPA).

Login model:
  * Admin  → password only (matched against any admin account)
  * Employee → pick from a dropdown (by id) + password
  * Employee accounts are created by an admin (see POST /api/admin/users);
    there is no public self-registration.

  GET  /api/auth/employees          public list for the dropdown (names only)
  POST /api/auth/admin-login        {password}
  POST /api/auth/employee-login     {user_id, password}
  POST /api/auth/logout
  GET  /api/auth/me
"""
from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException, Request, Response, status
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import Settings, get_settings
from app.core.dependencies import get_current_user
from app.core.ratelimit import RateLimiter
from app.core.security import issue_session
from app.db.models import User, UserRole
from app.db.session import get_db
from app.schemas.auth import (
    AdminLoginRequest,
    CurrentUser,
    EmployeeLoginRequest,
    EmployeeOption,
    LoginRequest,
)
from app.services import user_service

router = APIRouter(prefix="/api/auth", tags=["auth"])

_settings = get_settings()
_login_limiter = RateLimiter(_settings.login_max_attempts, _settings.login_window_seconds)


def _client_ip(request: Request) -> str:
    return request.client.host if request.client else "unknown"


def _set_session_cookie(response: Response, user_id: int, settings: Settings) -> None:
    response.set_cookie(
        settings.session_cookie_name,
        issue_session(user_id),
        max_age=settings.session_ttl_seconds,
        httponly=True,
        samesite="lax",
        secure=settings.cookie_secure,
    )


@router.post("/login", response_model=CurrentUser)
async def login(
    body: LoginRequest,
    request: Request,
    response: Response,
    db: AsyncSession = Depends(get_db),
    settings: Settings = Depends(get_settings),
) -> User:
    # Internal username+password login (not used by the SPA UI; kept for API/tests).
    await _login_limiter.check(_client_ip(request))
    user = await user_service.authenticate(db, body.username, body.password)
    if user is None:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Invalid username or password")
    _set_session_cookie(response, user.id, settings)
    return user


@router.get("/employees", response_model=list[EmployeeOption])
async def list_employees(db: AsyncSession = Depends(get_db)) -> list[EmployeeOption]:
    employees = await user_service.list_active_employees(db)
    return [
        EmployeeOption(id=u.id, employee_id=u.employee_id, name=u.display_name or u.username)
        for u in employees
    ]


@router.post("/admin-login", response_model=CurrentUser)
async def admin_login(
    body: AdminLoginRequest,
    request: Request,
    response: Response,
    db: AsyncSession = Depends(get_db),
    settings: Settings = Depends(get_settings),
) -> User:
    await _login_limiter.check(_client_ip(request))
    user = await user_service.authenticate_admin(db, body.password)
    if user is None:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Incorrect admin password")
    _set_session_cookie(response, user.id, settings)
    return user


@router.post("/employee-login", response_model=CurrentUser)
async def employee_login(
    body: EmployeeLoginRequest,
    request: Request,
    response: Response,
    db: AsyncSession = Depends(get_db),
    settings: Settings = Depends(get_settings),
) -> User:
    await _login_limiter.check(_client_ip(request))
    user = await user_service.authenticate_by_id(db, body.user_id, body.password)
    if user is None or user.role == UserRole.admin:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Incorrect password")
    _set_session_cookie(response, user.id, settings)
    return user


@router.post("/logout", status_code=status.HTTP_204_NO_CONTENT)
async def logout(response: Response, settings: Settings = Depends(get_settings)) -> None:
    response.delete_cookie(settings.session_cookie_name)


@router.get("/me", response_model=CurrentUser)
async def me(user: User = Depends(get_current_user)) -> User:
    return user
