# DSA Coding Assessment Platform — Step 3

Working student authentication, assessment dashboard and coding workspace, backed by NestJS, Prisma and PostgreSQL. Exactly three applications remain: `frontend/`, `backend/`, `admin/`.

The workspace supports Python, Java and C++, separate revisioned drafts, autosave, question navigation, resizable desktop panels and mobile tabs. Starts allocate four fixed published questions and persist a three-hour deadline. Final submission and expiry freeze four immutable source snapshots. Execution controls remain unavailable; the judge, grading and admin portal belong to later steps.

## Run locally

Requirements: Node 24.12+ within major 24, pnpm 10.34.6, PostgreSQL 17 or Docker Compose. Use `.cmd` launchers on Windows when PowerShell blocks `.ps1` files.

```powershell
cd assessment-platform
# If pnpm is not installed:
npm.cmd install --global pnpm@10.34.6
Copy-Item .env.example .env
Copy-Item backend/.env.example backend/.env
Copy-Item frontend/.env.example frontend/.env.local
# Choose a local PostgreSQL password; use the same URL-encoded password in DATABASE_URL.
pnpm.cmd install --frozen-lockfile
pnpm.cmd db:generate
pnpm.cmd infra:up
pnpm.cmd db:migrate
```

`db:migrate` targets an empty development database or an existing Step 1 installation. **Read [database adoption](docs/database.md) before using an existing production users table.** The initial migration refuses unmanaged existing identities; no reset or production data replacement is performed.

Use your existing student credentials. For an empty local database only, explicitly set `DEV_STUDENT_ID`, `DEV_STUDENT_NAME`, and `DEV_STUDENT_PASSWORD` in private `backend/.env`, then run:

```powershell
pnpm.cmd dev:student
# Set DEV_ASSESSMENT_START_AT to a recent UTC timestamp ending in Z before the FIRST seed
# to start immediately; otherwise the assessment opens one hour after seeding.
pnpm.cmd db:seed
pnpm.cmd dev:backend
# In another terminal:
pnpm.cmd dev:frontend
```

Open **http://localhost:3000/login**. The frontend proxies `/api/v1` to the API on port 4000. In the dashboard, select Active → Start Assessment → Begin assessment. Resume opens the same `/attempts/{id}` workspace. Development seed reruns preserve credentials, published versions, schedules and revoked assignments. Fresh fixtures include public examples and templates; their encrypted tests and unconfigured toolchains cannot be used for execution or grading. Existing Step 2 fixtures are not backfilled, so public samples may be unavailable. See [Step 3 migration notes](docs/step-3.md).

## Verify

```powershell
pnpm.cmd validate
pnpm.cmd test:backend
pnpm.cmd test:frontend
pnpm.cmd --filter @assessment/backend build
pnpm.cmd --filter @assessment/frontend build
pnpm.cmd exec playwright install chromium
pnpm.cmd test:e2e
```

Backend integration and browser tests use an isolated PostgreSQL engine, real SQL and real API requests; they do not need Docker or your credentials. Native PostgreSQL concurrency and 500-student capacity require deployment load testing.

See [Step 3 design, routes and scope](docs/step-3.md), [validation and changed files](docs/step-3-validation.md), [OpenAPI](contracts/openapi.json), and [folder inventory](docs/folder-structure.md). The [Step 2 implementation](docs/step-2.md), [Step 2 validation](docs/step-2-validation.md), original [architecture](docs/architecture.md), [database strategy](docs/database.md), [authentication design](docs/authentication.md), [execution security](docs/execution-security.md), [Step 1 README](docs/step-1-readme.md) and [Step 1 validation](docs/validation.md) are preserved.
