"""
Persona endpoints.

  GET /api/personas → list active personas the user can chat with.

Crucially, the system prompt is NOT returned — it stays server-side. The client
only receives display metadata and voice hints.
"""
from __future__ import annotations

from fastapi import APIRouter, Depends
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.dependencies import get_current_user
from app.db.models import User
from app.db.session import get_db
from app.schemas.persona import PersonaOut
from app.services import persona_service

router = APIRouter(prefix="/api/personas", tags=["personas"])


@router.get("", response_model=list[PersonaOut])
async def list_personas(
    db: AsyncSession = Depends(get_db),
    _: User = Depends(get_current_user),
) -> list[PersonaOut]:
    personas = await persona_service.list_active(db)
    return [PersonaOut.from_model(p) for p in personas]
