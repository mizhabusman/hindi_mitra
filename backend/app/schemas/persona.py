"""Persona schemas (public view — system prompt is NOT exposed to clients)."""
from __future__ import annotations

import json

from pydantic import BaseModel

from app.db.models import Persona


class PersonaOut(BaseModel):
    key: str
    label: str
    emoji: str | None = None
    accent_color: str | None = None
    description: str | None = None
    voice_config: dict | None = None

    @classmethod
    def from_model(cls, p: Persona) -> "PersonaOut":
        voice = json.loads(p.voice_config) if p.voice_config else None
        return cls(
            key=p.key,
            label=p.label,
            emoji=p.emoji,
            accent_color=p.accent_color,
            description=p.description,
            voice_config=voice,
        )
