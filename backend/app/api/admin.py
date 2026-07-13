"""
Admin endpoints (require the admin role).

  GET    /api/admin/overview
  GET    /api/admin/users                     performance metrics (real data)
  POST   /api/admin/users                     create
  PATCH  /api/admin/users/{id}                update role/active/team/password
  DELETE /api/admin/users/{id}                remove (cascades their data)
  GET    /api/admin/users/{id}/conversations  drill-down
  GET    /api/admin/teams  /  POST /api/admin/teams
"""
from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.dependencies import require_admin
from app.core.security import hash_password
from app.db.models import Team, User
from app.db.session import get_db
from app.schemas.admin import (
    TeamCreate,
    TeamOut,
    UserMetricsOut,
    UserUpdate,
)
from app.schemas.user import UserCreate, UserOut
from app.services import admin_service, user_service

router = APIRouter(prefix="/api/admin", tags=["admin"], dependencies=[Depends(require_admin)])


@router.get("/overview")
async def overview(db: AsyncSession = Depends(get_db)) -> dict:
    return await admin_service.org_overview(db)


@router.get("/users", response_model=list[UserMetricsOut])
async def list_users(db: AsyncSession = Depends(get_db)) -> list[UserMetricsOut]:
    metrics = await admin_service.compute_user_metrics(db)
    return [UserMetricsOut.from_metrics(m) for m in metrics]


@router.post("/users", response_model=UserOut, status_code=status.HTTP_201_CREATED)
async def create_user(body: UserCreate, db: AsyncSession = Depends(get_db)) -> User:
    try:
        return await user_service.create_user(
            db,
            username=body.username,
            password=body.password,
            display_name=body.display_name,
            role=body.role,
            team_id=body.team_id,
        )
    except user_service.UsernameTakenError as exc:
        raise HTTPException(status.HTTP_409_CONFLICT, str(exc))
    except ValueError as exc:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, str(exc))


@router.patch("/users/{user_id}", response_model=UserOut)
async def update_user(
    user_id: int,
    body: UserUpdate,
    admin: User = Depends(require_admin),
    db: AsyncSession = Depends(get_db),
) -> User:
    user = await user_service.get_by_id(db, user_id)
    if user is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "User not found")
    # Guard against an admin locking themselves out.
    if user.id == admin.id and body.is_active is False:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "You can't deactivate your own account")
    if user.id == admin.id and body.role is not None and body.role.value != "admin":
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "You can't demote your own account")

    if body.display_name is not None:
        user.display_name = body.display_name
    if body.role is not None:
        user.role = body.role
    if body.is_active is not None:
        user.is_active = body.is_active
    if body.team_id is not None:
        user.team_id = body.team_id
    if body.password:
        user.password_hash = hash_password(body.password)
    await db.commit()
    await db.refresh(user)
    return user


@router.delete("/users/{user_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_user(
    user_id: int,
    admin: User = Depends(require_admin),
    db: AsyncSession = Depends(get_db),
) -> None:
    if user_id == admin.id:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "You can't delete your own account")
    user = await user_service.get_by_id(db, user_id)
    if user is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "User not found")
    await db.delete(user)  # cascades conversations/messages/scores/assessments
    await db.commit()


@router.get("/users/{user_id}/conversations")
async def user_conversations(user_id: int, db: AsyncSession = Depends(get_db)) -> list[dict]:
    return await admin_service.list_user_conversations(db, user_id)


@router.get("/users/{user_id}/detail")
async def user_detail(user_id: int, db: AsyncSession = Depends(get_db)) -> dict:
    detail = await admin_service.employee_detail(db, user_id)
    if detail is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "User not found")
    return detail


@router.get("/teams", response_model=list[TeamOut])
async def list_teams(db: AsyncSession = Depends(get_db)) -> list[Team]:
    result = await db.execute(select(Team).order_by(Team.name))
    return list(result.scalars().all())


@router.post("/teams", response_model=TeamOut, status_code=status.HTTP_201_CREATED)
async def create_team(body: TeamCreate, db: AsyncSession = Depends(get_db)) -> Team:
    team = Team(name=body.name, description=body.description)
    db.add(team)
    await db.commit()
    await db.refresh(team)
    return team
