# Hindi Mitra backend

FastAPI + async SQLAlchemy + Alembic. Server-owned prompts, AI-based scoring
(from Phase 3), and a clean service layer.

## Layout

```
backend/
  app/
    config.py            # env-driven settings (pydantic-settings)
    main.py              # app factory + lifespan
    bootstrap.py         # first-run: seed personas + admin
    core/                # security (hashing, sessions), auth dependencies
    db/                  # base, async engine/session, ORM models (full schema)
    schemas/             # pydantic request/response contracts
    services/            # business logic (user, persona, ...)
    api/                 # routers (auth, personas, ...)
    prompts/             # persona definitions (YAML) + scoring prompts (later)
  migrations/            # Alembic
  requirements.txt
```

## Run locally

```bash
cd backend
python -m venv .venv
.venv\Scripts\Activate.ps1          # Windows  (source .venv/bin/activate on *nix)
pip install -r requirements.txt

# Ensure the repo-root .env has ANTHROPIC_API_KEY, ADMIN_USERNAME,
# ADMIN_PASSWORD (SECRET_KEY optional in dev). See .env.example.

alembic upgrade head                # create/upgrade the schema
uvicorn app.main:app --reload --port 8000
```

Open http://localhost:8000/docs for the interactive API.
Local dev uses a SQLite file; set `DATABASE_URL` for PostgreSQL.

## Migrations

```bash
alembic revision --autogenerate -m "describe change"   # after editing models
alembic upgrade head
```

## Tests

The suite is hermetic and free — a temp SQLite DB and a stubbed Anthropic
client (no real API calls):

```bash
pip install -r requirements-dev.txt
pytest
```

## Endpoints

| Method | Path | Role | Notes |
|---|---|---|---|
| GET  | `/api/health` | — | liveness |
| POST | `/api/auth/login` | — | `{username, password}` → session cookie (rate-limited per IP) |
| POST | `/api/auth/logout` | any | clears cookie |
| GET  | `/api/auth/me` | any | current user |
| GET  | `/api/personas` | any | active personas (system prompts never exposed) |
| POST | `/api/conversations` | any | start; returns persona opener |
| GET  | `/api/conversations` | any | list own conversations |
| GET  | `/api/conversations/{id}` | owner | conversation + transcript |
| POST | `/api/conversations/{id}/turns` | owner | send transcribed turn; **SSE** stream (reply deltas + live score); rate-limited per user |
| POST | `/api/conversations/{id}/end` | owner | end |
| POST | `/api/conversations/{id}/assessment` | owner | generate holistic assessment |
| GET  | `/api/conversations/{id}/assessment` | owner | fetch stored assessment |
| GET  | `/api/admin/overview` | admin | org metrics |
| GET  | `/api/admin/users` | admin | per-employee performance (real data) |
| POST | `/api/admin/users` | admin | create |
| PATCH| `/api/admin/users/{id}` | admin | update role/active/team/password |
| DELETE| `/api/admin/users/{id}` | admin | remove (cascades data) |
| GET  | `/api/admin/users/{id}/conversations` | admin | drill-down |
| GET/POST | `/api/admin/teams` | admin | teams |
| GET  | `/api/manager/team` | manager | own team's metrics |
| GET  | `/api/speech/config` | any | `{enabled}` — Azure Speech on/off |
| GET  | `/api/speech/token` | any | short-lived Azure auth token + region (503 if unconfigured) |

## The scoring engine

Two AI operations, both structured-output and server-owned (rubric in
`app/prompts/scoring.yaml`, versioned):

- **Live per-turn scoring** (`claude-haiku-4-5`) runs concurrently with the
  reply; dimensions fluency/grammar/vocabulary/coherence + informational
  code-mixing → composite 0–100 + CEFR band. Feeds a recency-weighted live score.
- **End-of-conversation assessment** (`claude-sonnet-5`) over the full
  transcript → overall score, CEFR level, strengths, weaknesses, concrete
  corrections, and next steps.

Token usage is recorded per model, so admin cost reporting is accurate.
