"""
Manager endpoints (require manager or admin role).

A manager sees performance for their own team only.

  GET /api/manager/team   metrics for the manager's team
"""
from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.dependencies import require_manager
from app.db.models import User
from app.db.session import get_db
from app.schemas.admin import UserMetricsOut
from app.services import admin_service

router = APIRouter(prefix="/api/manager", tags=["manager"])


@router.get("/team", response_model=list[UserMetricsOut])
async def team_metrics(
    manager: User = Depends(require_manager),
    db: AsyncSession = Depends(get_db),
) -> list[UserMetricsOut]:
    if manager.team_id is None:
        raise HTTPException(
            status.HTTP_400_BAD_REQUEST, "You are not assigned to a team"
        )
    metrics = await admin_service.compute_user_metrics(db, team_id=manager.team_id)
    return [UserMetricsOut.from_metrics(m) for m in metrics]
