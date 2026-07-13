"""Prompt assets: persona definitions and (later) scoring/assessment prompts."""

from pathlib import Path

PROMPTS_DIR = Path(__file__).resolve().parent
PERSONAS_FILE = PROMPTS_DIR / "personas.yaml"
SCORING_FILE = PROMPTS_DIR / "scoring.yaml"
