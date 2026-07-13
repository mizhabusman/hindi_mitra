# हिंदी मित्र — Hindi Mitra

An enterprise Hindi speaking-assessment platform. Employees practice spoken
Hindi by talking to AI personas; Claude evaluates their proficiency **live**
during the conversation and produces a full assessment at the end. Admins
manage employees and monitor real performance.

## What it does

- **Practice** — pick a persona (businessman, teacher, doctor, …), speak, and
  the AI replies in natural spoken Hindi. Personas are data (DB-backed),
  addable without code changes.
- **Live scoring** — every turn is scored by AI (fluency, grammar, vocabulary,
  coherence, + informational code-mixing) into a 0–100 composite and a CEFR
  band; a recency-weighted live score updates as you talk.
- **Assessment** — at the end, a holistic report: overall score, CEFR level,
  strengths, weaknesses, concrete corrections, and next steps.
- **Admin** — RBAC (employee / manager / admin), teams, per-employee metrics
  from real stored data, and accurate per-model cost.

## Architecture

```
frontend/   React + Vite + TypeScript SPA (login, practice + live score, admin)
backend/    FastAPI + async SQLAlchemy + Alembic
              - server-owned prompts (personas + scoring rubric, versioned)
              - Claude tiering: chat=Sonnet 5, scoring=Haiku 4.5, assess=Sonnet 5
              - all AI calls server-side; the API key is never exposed
PostgreSQL  production DB (SQLite locally)
```

Key properties: prompts and scoring live on the server; the chat endpoint never
accepts a client-supplied system prompt; all stats/costs derive from real API
responses (not client-reported); conversations and scores are persisted.

## Run locally

**1. Backend** (see `backend/README.md` for detail):

```bash
cd backend
python -m venv .venv && .venv\Scripts\Activate.ps1   # (source .venv/bin/activate on *nix)
pip install -r requirements.txt
# repo-root .env needs ANTHROPIC_API_KEY, ADMIN_USERNAME, ADMIN_PASSWORD (see backend/.env.example)
alembic upgrade head
uvicorn app.main:app --reload --port 8000
```

**2. Frontend:**

```bash
cd frontend
npm install
npm run dev          # http://localhost:5173 (proxies /api → :8000)
```

Open http://localhost:5173, log in with the admin credentials, and either
practice (as any user) or open the admin dashboard.

> The dev proxy target is set in `frontend/vite.config.ts` (`/api` → `:8000`).

## Voice

Speech-to-text and the persona's spoken voice. Both providers are built in and
selected automatically:

- **Azure AI Speech** (recommended) — reliable Hindi STT, neural TTS, and
  phoneme-level **pronunciation assessment** that feeds into the score. This is
  a **voice-only API key** (Azure Cognitive Services "Speech" resource, free F0
  tier) — it is **not** related to app hosting. Activate by setting
  `AZURE_SPEECH_KEY` and `AZURE_SPEECH_REGION` in the environment and restarting
  the backend. The key stays server-side; the browser uses a short-lived token
  minted by `/api/speech/token`.
- **Browser Web Speech API** (fallback) — used automatically when no Azure key
  is set. Free, no account; works best in Chrome and needs mic permission.

The UI shows which provider is active, and when Azure is on, a pronunciation
score appears in the live score board and the final assessment.

### Get the free Azure Speech key
1. Sign in at https://portal.azure.com → **Create a resource** → search
   **"Speech"** (Azure AI services / Cognitive Services) → **Create**.
2. Pick a resource group + region (e.g. `Central India`), and **Pricing tier
   `Free F0`**. Create.
3. Open the resource → **Keys and Endpoint** → copy **KEY 1** and the
   **Location/Region** (e.g. `centralindia`).
4. Put them in the repo-root `.env`:
   ```
   AZURE_SPEECH_KEY=<KEY 1>
   AZURE_SPEECH_REGION=centralindia
   ```
5. Restart the backend. The app switches to Azure voice automatically (the chat
   header shows "Azure voice").

## Tests

```bash
cd backend && pip install -r requirements-dev.txt && pytest
```

Hermetic and free — temp SQLite DB, Anthropic client stubbed.

## Deploy (any host)

Host-agnostic — runs anywhere that can run Python + serve static files
(Render, Railway, Fly.io, a VM, a container, etc.).

- Backend: Python 3.11/3.12, start command
  `uvicorn app.main:app --host 0.0.0.0 --port $PORT`, run `alembic upgrade head`
  on release. Set `DATABASE_URL` (any managed PostgreSQL),
  `ANTHROPIC_API_KEY`, `SECRET_KEY`, `ADMIN_USERNAME`, `ADMIN_PASSWORD`,
  `COOKIE_SECURE=1`, `ENVIRONMENT=production`, and `CORS_ORIGINS` for the SPA
  origin.
- Frontend: `npm run build` → static `dist/` served by any static host / CDN,
  pointed at the backend origin.
