# DSA Coding Assessment Platform — Step 5

Working student authentication, assessment dashboard and coding workspace, backed by NestJS, Prisma and PostgreSQL. Exactly three applications remain: `frontend/`, `backend/`, `admin/`.

The workspace supports Python, Java and C++, revisioned drafts, autosave and responsive coding panels. Starts allocate four immutable questions and persist a three-hour deadline. Durable public/hidden evaluations, BullMQ workers, a dedicated gVisor broker, weighted scoring and exactly-once finalization support the student workflow. Step 5 adds the separate admin application, immutable question publication, assessment/student management, monitoring/results/CSV/audit, security hardening and deployment/load-test configuration. **Execution is disabled by default until the Linux judge gate passes. Capacity for 500 students remains unverified until the documented load gate runs on real infrastructure.**

## Run locally

Requirements: Node 24.12+ within major 24, pnpm 10.34.6, PostgreSQL 17 or Docker Compose. Use `.cmd` launchers on Windows when PowerShell blocks `.ps1` files.

```powershell
cd assessment-platform
# If pnpm is not installed:
npm.cmd install --global pnpm@10.34.6
Copy-Item .env.example .env
Copy-Item backend/.env.example backend/.env
Copy-Item frontend/.env.example frontend/.env.local
Copy-Item admin/.env.example admin/.env.local
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

## Enable execution on a dedicated Linux host

Follow [sandbox setup](backend/sandbox/README.md) and the [real judge gate](docs/judge-test-gate.md).
The host requires Docker/cgroups v2, reviewed runsc, pinned images, mTLS and private testcase keys.
This Windows workspace has no such host; real sandbox/Redis recovery and 500-student load tests
remain pending.

```sh
pnpm sandbox:build
pnpm sandbox:dev-keys
# Configure broker TLS/catalog/runtime settings in backend/.env.sandbox.local.
pnpm sandbox:broker
# In the development seed process set TESTCASE_KEYRING_FILE and SANDBOX_TOOLCHAIN_CATALOG.
# Set DEV_EXECUTION_START_AT (UTC ending in Z) before the FIRST seed to open immediately.
pnpm db:seed:judge
# Configure separate DB/Redis identities/secrets from the backend env examples.
pnpm worker:maintenance
pnpm worker:judge
# On the isolated Linux gate node:
pnpm test:judge
```

Run each long-lived process in a separate terminal/service. The seed adds a separate round with
eight published questions and a 70-mark policy, preserving older fixtures. After the gate and
deployment review pass, set `EXECUTION_ENABLED=true` in the API env and restart it. Healthy matching
workers are still required before Run/Submit can be enabled.

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

See [Step 4 implementation](docs/step-4.md), [validation and changed files](docs/step-4-validation.md), [OpenAPI](contracts/openapi.json), and [folder inventory](docs/folder-structure.md). Historical [Step 3](docs/step-3.md) / [validation](docs/step-3-validation.md), [Step 2](docs/step-2.md) / [validation](docs/step-2-validation.md), [architecture](docs/architecture.md), [database adoption](docs/database.md), [authentication](docs/authentication.md), [execution security](docs/execution-security.md), [Step 1 README](docs/step-1-readme.md) and [Step 1 validation](docs/validation.md) remain available.

## Admin application

Existing ADMIN credentials use the same backend session/password system at **http://localhost:3001/login**.
For an empty development database, explicitly set `DEV_ADMIN_EMAIL`, `DEV_ADMIN_NAME` and a
private `DEV_ADMIN_PASSWORD` in `backend/.env`, then provision without resetting existing users:

```powershell
pnpm.cmd dev:admin-user
pnpm.cmd dev:admin
```

Keep `ADMIN_ORIGINS=http://localhost:3001` configured in the backend development env. Question
testcase editing/publication also requires `QUESTION_KEYRING_FILE` and an approved
`SANDBOX_TOOLCHAIN_CATALOG`; use the Linux setup for real supported execution images.
The admin browser never receives database credentials. In production, separate student/admin
API processes use the same backend image/authentication system with distinct privileged envs.
See [Step 5 deployment](docs/step-5-deployment.md), [security review](docs/step-5-security.md)
and [500-student load gate](docs/step-5-load-testing.md).

```powershell
pnpm.cmd validate
pnpm.cmd test:backend
pnpm.cmd test:frontend
pnpm.cmd test:admin
pnpm.cmd build
pnpm.cmd test:e2e
pnpm.cmd security:audit
```

The dependency review currently reports an unpatched high advisory in development tooling;
the full security gate fails while the separate production dependency audit is clear after
the DOMPurify fix. Docker image/Compose runtime, native PostgreSQL/Redis, real Linux judge,
TLS/backup restore and 500-student capacity gates have not run in this Windows workspace.
Production release requires those gates and the infrastructure/latency/resource evidence,
without substituting local transport doubles for real sandbox execution.
