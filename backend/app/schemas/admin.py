"""Admin/analytics schemas."""
from __future__ import annotations

import datetime as dt

from pydantic import BaseModel, Field

from app.db.models import UserRole
from app.schemas._types import UtcDateTime
from app.services.admin_service import UserMetrics


class UserMetricsOut(BaseModel):
    id: int
    username: str
    display_name: str | None
    role: UserRole
    is_active: bool
    team_id: int | None
    conversations: int
    assessments: int
    practice_seconds: float
    avg_score: float | None
    latest_level: str | None
    latest_activity: UtcDateTime | None
    total_tokens: int
    estimated_cost: float

    @classmethod
    def from_metrics(cls, m: UserMetrics) -> "UserMetricsOut":
        return cls(
            id=m.user.id,
            username=m.user.username,
            display_name=m.user.display_name,
            role=m.user.role,
            is_active=m.user.is_active,
            team_id=m.user.team_id,
            conversations=m.conversations,
            assessments=m.assessments,
            practice_seconds=m.practice_seconds,
            avg_score=m.avg_score,
            latest_level=m.latest_level,
            latest_activity=m.latest_activity,
            total_tokens=m.total_tokens,
            estimated_cost=round(m.estimated_cost, 4),
        )


class UserUpdate(BaseModel):
    display_name: str | None = Field(None, max_length=150)
    role: UserRole | None = None
    is_active: bool | None = None
    team_id: int | None = None
    password: str | None = Field(None, min_length=6, max_length=200)


class TeamCreate(BaseModel):
    name: str = Field(..., min_length=1, max_length=120)
    description: str | None = Field(None, max_length=500)


class TeamOut(BaseModel):
    id: int
    name: str
    description: str | None

    model_config = {"from_attributes": True}
