# Hindi Mitra — Database Reference

Everything about the app's database: what it is, how it connects, what each table
stores, and the answers your hosting engineer will need. Written for **Azure SQL
Database / Microsoft SQL Server** (production), with a local SQLite fallback for
quick development.

---

## 1. At a glance

| | Production | Local dev (fallback) |
|---|---|---|
| **Engine** | Azure SQL Database (Microsoft SQL Server) | SQLite file |
| **Driver** | `aioodbc` + `pyodbc` + **ODBC Driver 18 for SQL Server** | `aiosqlite` |
| **Collation** | **must be `Latin1_General_100_CI_AS_SC_UTF8`** (UTF‑8, for Hindi + emoji) | n/a (SQLite is Unicode natively) |
| **Selected by** | the `DATABASE_URL` env var being **set** | `DATABASE_URL` **empty/absent** |
| **Schema built by** | `alembic upgrade head` (migrations) | same |
| **ORM** | SQLAlchemy 2.0 (async) | same |

The app is **database-agnostic** — the same code runs on SQL Server or SQLite;
only the `DATABASE_URL` differs.

---

## 2. How the app connects (the one switch: `DATABASE_URL`)

The app reads a single environment variable, `DATABASE_URL`, from the repo‑root
`.env` file:

- **Set** → the app uses that database (SQL Server).
- **Empty / not set** → the app uses a local SQLite file.

Code path: `backend/app/config.py` (`async_database_url`) normalizes the URL and
forces the ODBC driver → `backend/app/db/session.py` opens the async engine.

### Local (what's configured right now)
- **Server / instance:** `localhost\SQLSERVER` (SQL Server 2025)
- **Database:** `hindimitra`
- **Auth:** Windows Authentication (`Trusted_Connection=yes`) — no DB password needed locally
- **`.env` value (root `.env`, line ~17):**
  ```
  DATABASE_URL=mssql+aioodbc:///?odbc_connect=DRIVER%3D%7BODBC+Driver+18+for+SQL+Server%7D%3BSERVER%3Dlocalhost%5CSQLSERVER%3BDATABASE%3Dhindimitra%3BTrusted_Connection%3Dyes%3BTrustServerCertificate%3Dyes%3B
  ```
  (URL‑encoded ODBC string; decoded it means: Driver 18, server `localhost\SQLSERVER`,
  database `hindimitra`, Windows auth, trust the local self‑signed certificate.)

### Production (Azure SQL) — the form to use
```
DATABASE_URL=mssql+aioodbc://<user>:<password>@<server>.database.windows.net:1433/<db>?driver=ODBC+Driver+18+for+SQL+Server&Encrypt=yes&TrustServerCertificate=no
```
(A bare `mssql://…` also works — the app auto‑adds the async driver.)

---

## 3. Where the data physically lives

**Local SQL Server** (managed by the SQL Server service, not in the project folder):
```
C:\Program Files\Microsoft SQL Server\MSSQL17.SQLSERVER\MSSQL\DATA\hindimitra.mdf      (data)
C:\Program Files\Microsoft SQL Server\MSSQL17.SQLSERVER\MSSQL\DATA\hindimitra_log.ldf  (transaction log)
```
You never touch these directly — the app talks to the SQL Server *service*, which
owns these files.

**Local SQLite fallback file** (only used when `DATABASE_URL` is empty):
```
C:\Users\Salam\Desktop\hindibol-azure\hindibol-py\backend\hindimitra.db
```

**Azure SQL:** storage is fully managed by Azure — there is no file to manage.

---

## 4. Tables

7 application tables + `alembic_version` (migration bookkeeping). Timestamps
(`created_at`, `updated_at`, UTC) exist on every table.

### `users` — admin + employee accounts
| Column | Type | Notes |
|---|---|---|
| `id` | int (PK, identity) | |
| `employee_id` | varchar(20) | e.g. `EMP0007`; **unique among employees** (admin's is NULL — see §5) |
| `username` | varchar(150) | unique; login name |
| `display_name` | varchar(150) | shown in the UI |
| `password_hash` | varchar(255) | **bcrypt** hash (never plaintext) |
| `role` | varchar(20) | `employee` or `admin` |
| `is_active` | bit | enable/disable an account |
| `last_login_at` | datetimeoffset | |

### `personas` — the 8 AI characters (seeded from `backend/app/prompts/personas.yaml`)
| Column | Type | Notes |
|---|---|---|
| `id` | int (PK) | |
| `key` | varchar(50) | unique, e.g. `friend`, `doctor` |
| `label` | varchar(120) | English display name |
| `emoji`, `accent_color` | varchar(16) | UI styling |
| `description` | varchar(300) | |
| `system_prompt` | text | the **Hindi** persona instructions — **server‑only, never sent to the browser** |
| `voice_config` | text | JSON voice/TTS hints |
| `is_active` | bit | |
| `sort_order` | int | |

### `conversations` — each practice / interview session
| Column | Type | Notes |
|---|---|---|
| `id` | int (PK) | |
| `user_id` | int → `users` | the employee |
| `persona_id` | int → `personas` | which character |
| `status` | varchar(20) | `active` / `ended` / `abandoned` |
| `started_at`, `ended_at` | datetimeoffset | |
| `examiner_brief` | text | private examiner setup — steers the AI, **never shown to the candidate, never scored** |
| `live_score` | float | running 0–100 score |
| `live_level` | varchar(4) | CEFR band (A1…C2) |
| `input_tokens`, `output_tokens` | int | Claude usage (for cost) |

### `messages` — every chat turn
| Column | Type | Notes |
|---|---|---|
| `id` | int (PK) | |
| `conversation_id` | int → `conversations` | |
| `turn_index` | int | ordering |
| `role` | varchar(20) | `user` (candidate) or `assistant` (AI) |
| `content` | text | the Hindi utterance / reply |
| `input_tokens`, `output_tokens` | int | |

### `turn_scores` — AI's per‑turn scoring of a user message
| Column | Type | Notes |
|---|---|---|
| `id` | int (PK) | |
| `message_id` | int → `messages` | the scored user turn |
| `fluency`, `grammar`, `vocabulary`, `coherence`, `code_mixing`, `pronunciation`, `composite` | float | 0–100 |
| `cefr_level` | varchar(4) | |
| `notes` | text | short rationale |
| `rubric_version`, `scoring_model` | varchar | audit trail |
| `input_tokens`, `output_tokens` | int | |

### `assessments` — end‑of‑conversation report (one per conversation)
| Column | Type | Notes |
|---|---|---|
| `id` | int (PK) | |
| `conversation_id` | int → `conversations` | |
| `overall_score` | float | 0–100 |
| `cefr_level` | varchar(4) | |
| `fluency` … `pronunciation` | float | per‑dimension |
| `summary` | text | narrative summary |
| `feedback_json` | text | JSON: strengths / weaknesses / corrections / next_steps |
| `rubric_version`, `assessment_model` | varchar | audit trail |
| `input_tokens`, `output_tokens` | int | |

### `alembic_version`
One row holding the current migration id (not app data). Currently: **`f5c2a9d81b34`**.

---

## 5. Relationships & delete behavior (verified live)

```
users ──1:N──> conversations ──1:N──> messages ──1:N──> turn_scores
                     │
                     └────1:1──> assessments
personas ──1:N──> conversations
```

| Foreign key | On delete |
|---|---|
| `conversations.user_id → users` | **CASCADE** (deleting an employee removes all their data) |
| `conversations.persona_id → personas` | **NO ACTION** (a persona in use cannot be deleted) |
| `messages.conversation_id → conversations` | **CASCADE** |
| `turn_scores.message_id → messages` | **CASCADE** |
| `assessments.conversation_id → conversations` | **CASCADE** |

So deleting a user cleanly removes their conversations → messages → turn‑scores →
assessments (confirmed: 0 orphan rows left).

> **SQL Server note:** `employee_id` uses a **filtered unique index**
> (`WHERE employee_id IS NOT NULL`). SQL Server allows only one NULL in a normal
> unique index, and the admin account has a NULL `employee_id`; the filter lets
> employees be created without colliding on NULL. (No‑op on other databases.)

---

## 6. Migrations (how the schema is created & updated)

- Managed by **Alembic** (`backend/migrations/`). The app does **not** auto‑create
  tables — you run migrations.
- Build/upgrade the schema:
  ```
  cd backend
  alembic upgrade head
  ```
- On an **empty** database this creates all 7 tables from scratch. On every release,
  run it again to apply any new migrations.
- Migration chain (6): `59ca173046ca` → `51f2a28e7c12` → `b6f6128fad41` →
  `c4a7e1f9d2b8` → `e3b1d9f4a2c6` → `f5c2a9d81b34` (single linear line, current head).
- The migrations are **SQL Server–safe** (verified on SQL Server 2025): no
  `RESTRICT`, correct FK‑drop ordering, filtered unique index, no `IS <bool>`.

**Acceptance check:** after migrating, run `python backend/verify_sqlserver.py`
(reads `DATABASE_URL`) — it confirms the collation, all tables, seed data, and that
Hindi + emoji round‑trip correctly. Exit code 0 = good.

---

## 7. What the app writes, and when
- **On startup:** seeds the 8 personas (from YAML) and one admin (from
  `ADMIN_USERNAME`/`ADMIN_PASSWORD`, only if no admin exists yet).
- **During a session:** inserts a `conversation`, each `message`, and (if the live
  coach is on) a `turn_score` per user turn.
- **At the end:** inserts one `assessment`.
- **Tokens/costs** are recorded from the real Claude responses (not client‑reported).

---

## 8. What your hosting engineer will likely ask — and the answers

| Question | Answer |
|---|---|
| **What engine / version?** | Microsoft SQL Server. **Azure SQL Database** is ideal. Needs 2019+ (for the UTF‑8 collation). Verified on SQL Server 2025. |
| **Do you need the schema pre‑created, or tables set up?** | **No — just give me an EMPTY database.** The app builds every table itself via `alembic upgrade head` on release. |
| **What collation?** | **`Latin1_General_100_CI_AS_SC_UTF8`** (a UTF‑8 collation). This is **required** so Hindi (Devanagari) + emoji store correctly. Set it when the database is created. |
| **Connection string?** | `mssql+aioodbc://<user>:<pass>@<server>.database.windows.net:1433/<db>?driver=ODBC+Driver+18+for+SQL+Server&Encrypt=yes` (goes into `DATABASE_URL`). |
| **What driver on the app host?** | **ODBC Driver 18 for SQL Server** must be installed on the machine running the backend. |
| **What DB permissions does the app user need?** | Enough to run migrations (create/alter tables + indexes) and read/write data — simplest is **`db_owner`** on the app's own database. (Can be tightened to DDL for the migration step + DML at runtime if you prefer.) |
| **Auth type?** | SQL authentication (username + password) for Azure. (Locally we use Windows auth.) Managed Identity is also possible but needs a small connection‑string change. |
| **Firewall / networking (Azure)?** | The backend host's outbound IP must be allowed through the Azure SQL firewall; connections are over TCP **1433**, encrypted (`Encrypt=yes`). |
| **How big will it get / sizing?** | Small. Rows are short text + numeric scores; no blobs/media. Grows with usage (a conversation ≈ a few dozen small rows). A basic/entry Azure SQL tier is plenty to start. |
| **Backups?** | Handled by the platform — Azure SQL does automatic backups / point‑in‑time restore. Nothing app‑specific required. |
| **Migrations on deploy?** | Run `alembic upgrade head` as a release step (before starting the app). Safe to run every deploy; it only applies what's new. |
| **Time zone?** | The app stores timestamps in **UTC**. |
| **Character encoding issues?** | Covered by the UTF‑8 collation above — no code changes needed. |
| **Multiple app instances / scaling?** | Fine against one database. Note: the login rate‑limiter is per‑process (in‑memory), so either run a single web worker or add Redis if you scale out — unrelated to the DB. |

---

*Keep `DATABASE.md`, `HANDOVER.md`, and `backend/.env.example` together when handing
off. The single source of truth for schema is the Alembic migrations in
`backend/migrations/`.*
