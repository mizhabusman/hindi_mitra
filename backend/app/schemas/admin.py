"""Admin/analytics schemas."""
from __future__ import annotations


from pydantic import BaseModel, Field

from app.db.models import UserRole
from app.schemas._types import UtcDateTime
from app.services.admin_service import UserMetrics


class UserMetricsOut(BaseModel):
    id: int
    employee_id: str | None
    username: str
    display_name: str | None
    role: UserRole
    is_active: bool
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
            employee_id=m.user.employee_id,
            username=m.user.username,
            display_name=m.user.display_name,
            role=m.user.role,
            is_active=m.user.is_active,
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
    password: str | None = Field(None, min_length=6, max_length=200)
