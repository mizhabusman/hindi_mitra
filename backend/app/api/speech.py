"""
Speech endpoints.

  GET /api/speech/config  → { enabled }  (client picks Azure vs browser fallback)
  GET /api/speech/token   → { token, region }  (short-lived Azure auth token)
"""
from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException, status

from app.config import Settings, get_settings
from app.core.dependencies import get_current_user
from app.db.models import User
from app.services import speech_service

router = APIRouter(prefix="/api/speech", tags=["speech"])


@router.get("/config")
async def speech_config(
    _: User = Depends(get_current_user),
    settings: Settings = Depends(get_settings),
) -> dict:
    return {"enabled": settings.speech_enabled}


@router.get("/token")
async def speech_token(_: User = Depends(get_current_user)) -> dict:
    try:
        return await speech_service.issue_token()
    except speech_service.SpeechNotConfiguredError:
        raise HTTPException(status.HTTP_503_SERVICE_UNAVAILABLE, "Azure Speech is not configured")
    except speech_service.SpeechTokenError as exc:
        raise HTTPException(status.HTTP_502_BAD_GATEWAY, f"Speech token error: {exc}")
