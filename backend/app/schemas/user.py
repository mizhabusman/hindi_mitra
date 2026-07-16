"""User management schemas (used by the admin API in a later phase)."""
from __future__ import annotations

import datetime as dt

from pydantic import BaseModel, Field

from app.db.models import UserRole
from app.schemas._types import UtcDateTime


class UserCreate(BaseModel):
    username: str = Field(..., min_length=1, max_length=150)
    password: str = Field(..., min_length=6, max_length=200)
    display_name: str | None = Field(None, max_length=150)
    role: UserRole = UserRole.employee
    team_id: int | None = None


class UserOut(BaseModel):
    id: int
    employee_id: str | None = None
    username: str
    display_name: str | None
    role: UserRole
    is_active: bool
    team_id: int | None
    last_login_at: UtcDateTime | None
    created_at: UtcDateTime

    model_config = {"from_attributes": True}
