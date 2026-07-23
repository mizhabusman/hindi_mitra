"""
Application configuration.

All settings come from environment variables (or a .env file). Nothing that
varies between environments — secrets, database URLs, model names — is
hardcoded anywhere else in the codebase.

Settings are loaded once and cached; import `get_settings()` where needed, or
depend on it in FastAPI routes via `Depends(get_settings)`.
"""
from __future__ import annotations

from functools import lru_cache
from pathlib import Path
from typing import Literal

from pydantic import Field, field_validator
from pydantic_settings import BaseSettings, SettingsConfigDict

# The repo root holds the shared .env.
BACKEND_DIR = Path(__file__).resolve().parent.parent
REPO_ROOT = BACKEND_DIR.parent


class Settings(BaseSettings):
    # Look for .env in the backend dir first, then the repo root.
    model_config = SettingsConfigDict(
        env_file=(REPO_ROOT / ".env", BACKEND_DIR / ".env"),
        env_file_encoding="utf-8",
        extra="ignore",
        case_sensitive=False,
    )

    # ── Environment ──────────────────────────────────────────────────
    environment: Literal["development", "staging", "production"] = "development"
    debug: bool = False

    # ── Anthropic / Claude ───────────────────────────────────────────
    anthropic_api_key: str = Field(..., alias="ANTHROPIC_API_KEY")
    # Model tiering — cheap+fast for per-turn scoring, balanced for chat,
    # highest quality for the one-shot final assessment.
    model_conversation: str = "claude-sonnet-5"
    model_scoring: str = "claude-haiku-4-5"
    # Sonnet handles the end-of-conversation assessment well at a fraction of
    # Opus's cost. Override with MODEL_ASSESSMENT to use a stronger model.
    model_assessment: str = "claude-sonnet-5"

    # ── Azure AI Speech (optional; enables cloud STT/TTS + pronunciation) ──
    azure_speech_key: str = Field("", alias="AZURE_SPEECH_KEY")
    azure_speech_region: str = Field("", alias="AZURE_SPEECH_REGION")

    # ── Auth / sessions ──────────────────────────────────────────────
    secret_key: str = Field("", alias="SECRET_KEY")
    session_cookie_name: str = "hindimitra_session"
    session_ttl_seconds: int = 60 * 60 * 12  # 12 hours
    cookie_secure: bool = Field(False, alias="COOKIE_SECURE")

    # Bootstrap admin (created once on first startup if absent).
    admin_username: str = Field("", alias="ADMIN_USERNAME")
    admin_password: str = Field("", alias="ADMIN_PASSWORD")

    # ── Database ─────────────────────────────────────────────────────
    # If DATABASE_URL is set → MySQL (production). Otherwise a local
    # SQLite file is used for development and tests only.
    database_url: str = Field("", alias="DATABASE_URL")

    # ── CORS (for the React dev server / SPA) ────────────────────────
    cors_origins: list[str] = ["http://localhost:5173", "http://localhost:3000"]

    # ── Chat guardrails ──────────────────────────────────────────────
    max_message_chars: int = 2000
    max_turns_per_conversation: int = 200

    # ── Currency ─────────────────────────────────────────────────────
    # AI cost is computed in USD internally, then shown in INR (₹).
    usd_to_inr: float = Field(88.0, alias="USD_TO_INR")

    # ── Rate limiting ────────────────────────────────────────────────
    login_max_attempts: int = 10           # per IP
    login_window_seconds: int = 300
    turn_max_per_minute: int = 30          # per user

    # ── Local dev DB override (used by the test suite) ───────────────
    sqlite_file: str = Field("", alias="HINDIMITRA_SQLITE_FILE")

    # ─────────────────────────────────────────────────────────────────
    @field_validator("cookie_secure", mode="before")
    @classmethod
    def _parse_bool(cls, v: object) -> bool:
        if isinstance(v, bool):
            return v
        return str(v).strip().lower() in {"1", "true", "yes", "on"}

    @property
    def is_production(self) -> bool:
        return self.environment == "production"

    @property
    def speech_enabled(self) -> bool:
        return bool(self.azure_speech_key and self.azure_speech_region)

    @property
    def async_database_url(self) -> str:
        """Return an async-driver SQLAlchemy URL for the configured backend.

        Production uses MySQL via the async `asyncmy` driver, forced to utf8mb4 so
        Hindi (Devanagari) text and emoji store correctly. Common URL forms
        (mysql://, mysql+pymysql://, mysql+aiomysql://) are normalised to it.
        """
        if self.database_url:
            url = self.database_url
            for prefix in ("mysql://", "mysql+pymysql://", "mysql+aiomysql://"):
                if url.startswith(prefix):
                    url = "mysql+asyncmy://" + url[len(prefix):]
                    break
            if url.startswith("mysql+asyncmy://") and "charset=" not in url:
                url += ("&" if "?" in url else "?") + "charset=utf8mb4"
            return url
        # Local development fallback: SQLite file next to the backend (or an
        # override, used by tests).
        path = self.sqlite_file or str(BACKEND_DIR / "hindimitra.db")
        return f"sqlite+aiosqlite:///{path}"

    @property
    def uses_server_db(self) -> bool:
        """True when a managed server DB (MySQL) is configured; False = local SQLite."""
        return bool(self.database_url)

    def effective_secret_key(self) -> str:
        """A usable signing key, with a loud dev fallback."""
        if self.secret_key:
            return self.secret_key
        if self.is_production:
            raise RuntimeError(
                "SECRET_KEY must be set in production. "
                'Generate one: python -c "import secrets; print(secrets.token_hex(32))"'
            )
        return "dev-insecure-key-change-me"


@lru_cache
def get_settings() -> Settings:
    return Settings()  # type: ignore[call-arg]
