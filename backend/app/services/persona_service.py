"""
Persona service: load persona definitions from YAML and seed the database.

Personas become editable data once seeded. `common_rules` (the shared spoken-
conversation contract) is exposed here so the conversation service can append
it to each persona's system prompt at call time.
"""
from __future__ import annotations

import json
from functools import lru_cache

import yaml
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.db.models import Persona
from app.prompts import PERSONAS_FILE


@lru_cache
def _load_yaml() -> dict:
    with PERSONAS_FILE.open(encoding="utf-8") as fh:
        return yaml.safe_load(fh)


def common_rules() -> str:
    return _load_yaml().get("common_rules", "").strip()


async def list_active(db: AsyncSession) -> list[Persona]:
    result = await db.execute(
        select(Persona).where(Persona.is_active).order_by(Persona.sort_order, Persona.label)
    )
    return list(result.scalars().all())


async def get_by_key(db: AsyncSession, key: str) -> Persona | None:
    result = await db.execute(select(Persona).where(Persona.key == key))
    return result.scalar_one_or_none()


async def seed_defaults(db: AsyncSession) -> int:
    """
    Sync the built-in personas from personas.yaml (matched by `key`).

    personas.yaml is the source of truth for built-ins: missing ones are
    created and existing ones have their display fields + prompt refreshed, so
    edits to the YAML (e.g. English labels) propagate on the next startup.
    Admin-created personas (keys not in the YAML) are left untouched.
    Returns the number of personas newly created.
    """
    data = _load_yaml()
    created = 0
    for entry in data.get("personas", []):
        voice = entry.get("voice_config")
        voice_json = json.dumps(voice, ensure_ascii=False) if voice else None
        persona = await get_by_key(db, entry["key"])
        if persona is None:
            db.add(
                Persona(
                    key=entry["key"],
                    label=entry["label"],
                    emoji=entry.get("emoji"),
                    accent_color=entry.get("accent_color"),
                    description=entry.get("description"),
                    system_prompt=entry["system_prompt"].strip(),
                    voice_config=voice_json,
                    sort_order=entry.get("sort_order", 100),
                )
            )
            created += 1
        else:
            persona.label = entry["label"]
            persona.emoji = entry.get("emoji")
            persona.accent_color = entry.get("accent_color")
            persona.description = entry.get("description")
            persona.system_prompt = entry["system_prompt"].strip()
            persona.voice_config = voice_json
            persona.sort_order = entry.get("sort_order", 100)
    await db.commit()
    return created
