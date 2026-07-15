"""Auth-related request/response schemas."""
from __future__ import annotations

from pydantic import BaseModel, Field

from app.db.models import UserRole


class LoginRequest(BaseModel):
    username: str = Field(..., min_length=1, max_length=150)
    password: str = Field(..., min_length=1, max_length=200)


class AdminLoginRequest(BaseModel):
    password: str = Field(..., min_length=1, max_length=200)


class EmployeeLoginRequest(BaseModel):
    user_id: int
    password: str = Field(..., min_length=1, max_length=200)


class EmployeeOption(BaseModel):
    id: int
    name: str


class CurrentUser(BaseModel):
    id: int
    username: str
    display_name: str | None = None
    role: UserRole

    model_config = {"from_attributes": True}
