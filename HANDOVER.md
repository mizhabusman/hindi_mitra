# Hindi Mitra — Session Handover

Enterprise **Hindi speaking-assessment** platform. Employees practice spoken Hindi
with AI personas; **Claude** scores their Hindi live and produces a full assessment;
admins manage/monitor employees. Status: **complete and working, production-grade.**

---

## Where things live
```
hindibol-py/
├── backend/     FastAPI + async SQLAlchemy 2.0 + Alembic   (the API + AI + DB)
│   └── app/     config, core, db(models), schemas, services, api, prompts, bootstrap
├── frontend/    React 18 + Vite + TypeScript SPA
│   └── src/     pages/, components/, hooks/, api.ts, auth.tsx, brand.ts, styles.css
├── .env         secrets (root) — ANTHROPIC_API_KEY, ADMIN_USERNAME/PASSWORD, SECRET_KEY, DATABASE_URL, COOKIE_SECURE
└── HANDOVER.md  (this file)
```

## Run it
- **Backend** (Python 3.14, venv `backend/.venv`, SQLite local):
  ```
  cd backend
  PYTHONPATH="$PWD" ./.venv/Scripts/python.exe -m alembic upgrade head
  PYTHONPATH="$PWD" ./.venv/Scripts/python.exe -m uvicorn app.main:app --port 8010 --host 127.0.0.1
  ```
- **Frontend** (Node 24): `cd frontend && npm run dev` → http://localhost:5173 (Vite proxies `/api` → :8010).
- **Tests:** `cd backend && ./.venv/Scripts/python.exe -m pytest` → 23 passing (Claude mocked, free).
- Ports: backend **:8010**, frontend **:5173**. **:8000 is the user's OLD prototype — don't touch.**
- No `--reload`: **restart the backend** after backend/.env changes.

## Login (current)
- **Admin:** password **`admin`** only (no username). Single admin `Admin`, enforced by bootstrap.
- **Employee:** pick name from dropdown + password, or self-register on the Employee Login page.
- Test employee "Mizhab" exists in the DB (deletable from the dashboard).

---

## Architecture / key decisions
- **Server owns everything sensitive:** persona prompts + scoring rubric live server-side (`backend/app/prompts/personas.yaml`, `scoring.yaml`); the client NEVER sends a system prompt; all stats/cost come from real Claude usage (not client-reported).
- **Claude models** (`backend/app/config.py`): conversation=`claude-sonnet-5`, live scoring=`claude-haiku-4-5`, assessment=`claude-sonnet-5` (was Opus; switched to Sonnet to cut cost — override via `MODEL_ASSESSMENT`). Structured outputs for scoring/assessment; prompt caching on persona+rubric.
- **Scoring:** per-turn live score (fluency/grammar/vocabulary/coherence/code-mixing + optional pronunciation → 0–100 + CEFR, recency-weighted) and a full end-of-conversation assessment (summary, strengths, weaknesses, Hindi corrections, next steps). Stored in `turn_scores` / `assessments`.
- **Personas** (7): data-driven; `personas.yaml` is source-of-truth, synced to DB on startup. English labels, Hindi system prompts.
- **Currency:** INR ₹ (config `usd_to_inr = 88`).
- **Bootstrap** (`backend/app/bootstrap.py`): seeds personas + reconciles the single admin from `.env` and deletes any other admin on every startup.

## Design system
- **Font:** Plus Jakarta Sans (UI) + Noto Sans Devanagari (Hindi content).
- **Icons:** Lucide (`lucide-react`) everywhere.
- **Theme:** indigo/violet accent, neutral palette, light + dark, refined shadows/radii, subtle animations. All in `frontend/src/styles.css` (design tokens at top).
- **Reusable components:** `Brand`, `UserBadge` (user icon before every name), `PasswordInput` (eye-icon toggle, no text), `GradeScale` (CEFR explainer).
- **Rebrand in one place:** `frontend/src/brand.ts` → `BRAND`.
- **Conversation screen = fixed 3 columns** (`.convo` 300px / 1fr / 344px): left rail (brand, user, persona list, controls) · center (chat + bottom-anchored composer, ChatGPT-style so ONLY the center scrolls — body gets `.lockScroll`) · right rail (live score + skill bars + coaching tip). Responsive fallbacks below 1080/760px.
- Back buttons = small outlined `btn btn-secondary btn-sm`. Buttons: `.btn` + `.btn-primary/-secondary/-ghost/-danger` (+ `-sm/-lg`), `.iconBtn`.

## Voice
- **Now:** browser Web Speech API (Chrome + mic permission). Hands-free auto-listen loop; bot speaks its reply sentence-by-sentence; mic re-opens after each reply. Typing also works (composer input).
- **Azure AI Speech:** fully built but **dormant** — set `AZURE_SPEECH_KEY` + `AZURE_SPEECH_REGION` in `.env` to activate reliable Hindi STT + neural TTS + phoneme pronunciation scoring. (User deferred to future.) Broker at `/api/speech/{config,token}`; frontend `src/speech/azure.ts` + `hooks/useSpeech.ts`.

## Deploy
- Any Python host + **Azure SQL Database** (create the DB with a **UTF-8 collation**, e.g. `Latin1_General_100_CI_AS_SC_UTF8`, so Hindi + emoji store correctly; host needs **ODBC Driver 18 for SQL Server**). Prod env: `DATABASE_URL` (`mssql+aioodbc://user:pass@server.database.windows.net:1433/db?driver=ODBC+Driver+18+for+SQL+Server&Encrypt=yes`), `SECRET_KEY`, `COOKIE_SECURE=1`, `ENVIRONMENT=production`, `CORS_ORIGINS`, `ANTHROPIC_API_KEY`, `ADMIN_USERNAME/PASSWORD`. Run `alembic upgrade head` on release; serve `frontend/dist/` on the same origin (reverse-proxy `/api`). Run `python verify_sqlserver.py` after migrating to confirm Hindi round-trips.

## Gotchas when verifying in the browser (Claude_Preview MCP)
- `preview_click` is flaky on some React buttons/inputs → drive via `preview_eval` (native `.click()` + React value-setter + `input` event).
- Screenshots lag/scale — verify with `preview_eval` DOM reads.
- Headless preview has NO mic → voice shows a "mic isn't picking up" hint (expected); test by TYPING in the composer.

## Rebrand cleanup (done 2026-07-12)
- **Legacy removed:** deleted `_legacy/` (old prototype `app.py`/`db.py`/`static/`) and the orphaned root `hindibol.db`. The app is the sole source of truth.
- **Rebranded identifiers** (behaviour unchanged): logger namespace `hindibol*` → `hindimitra*`; session cookie `hindibol_session` → `hindimitra_session`; token salt `hindibol.session` → `hindimitra.session`; local DB file `backend/hindibol.db` → `backend/hindimitra.db` (renamed on disk, data preserved); test/dev override env var `HINDIBOL_SQLITE_FILE` → `HINDIMITRA_SQLITE_FILE`; frontend package `hindibol-frontend` → `hindimitra-frontend`. Cookie+salt rename invalidated any sessions active at the time (one-time re-login).
- **Not renamed (deliberate):** the project root folder is still `hindibol-py` (renaming it would break the venv's absolute paths, the working directory, and tooling). Rename later only if you also recreate the venv.
- Verified after: backend starts clean on :8010, admin login works, all existing data intact, 23 tests pass, frontend builds.

## Likely next tasks / open threads
- Wire Azure Speech when the user provisions a key.
- Optional: clear leftover test employee ("Mizhab") for a clean slate.
- Continue UI/UX polish; the user cares deeply about premium, enterprise-grade feel and attention to detail.
- Be cautious: it's a **fully functional app with many moving parts** — make small, verified changes and build/test after each.
