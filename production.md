# Production Deployment Guide: Railway (Backend) & Vercel (Frontend)

## Actual deployment status — 29 October 2026

**Prepared, not live.** After inspecting Railway billing, you explicitly chose
**“No new charges; prepare Railway deployment only.”** Railway reports an active Hobby plan,
$1 remaining usage credit and no hard spending limit. No new Railway project, database, Redis,
API or worker was created, and no payment, plan change or workspace spending-limit change was made.
Existing Railway databases/projects were left untouched. This is not a production deployment.

The following Vercel projects were actually created and their settings verified:

| Application | Project dashboard                                                                       | Project ID                         | State                     |
| ----------- | --------------------------------------------------------------------------------------- | ---------------------------------- | ------------------------- |
| Student     | [dsa-assessment-student](https://vercel.com/empower-air-esearch/dsa-assessment-student) | `prj_Meuzoh7cggS81Y0ISb0b82R60iGt` | Configured; no deployment |
| Admin       | [dsa-assessment-admin](https://vercel.com/empower-air-esearch/dsa-assessment-admin)     | `prj_ijki5msZnq3Uc6rhOusles0XpMyR` | Configured; no deployment |

Both use the existing `empower-air-esearch` Hobby scope, Next.js, Node **24.x**, their own
`assessment-platform/frontend` or `assessment-platform/admin` root, source files outside the
root enabled, `cd .. && pnpm install --frozen-lockfile` for installation, and
`pnpm run build:vercel` for builds. No paid option was enabled. The projects are not connected
to automatic Git deployments yet; the required live backend origin does not exist.
These dashboard links are **not** public application URLs.

Vercel Hobby is intended for personal, non-commercial use. Check the actual usage against
[Vercel's Hobby plan terms](https://vercel.com/docs/plans/hobby) before treating this setup as
an enterprise/commercial production deployment; no paid plan was selected here.

Production-only secrets were generated independently of local development and preserved in
Git-ignored `assessment-platform/.local/production/`:

- `secrets.json`: shared CSRF signing secret and separate PUBLIC/HIDDEN/DIAGNOSTICS AES material.
- `testcase-keyring.json`: full judge-only keyring; `question-keyring.json`: authoring subset.
- `api.env.prepared`, `admin-api.env.prepared`: private drafts with real signing/key IDs but
  explicit placeholder database/Redis/origin values. **Do not deploy those drafts unchanged.**
- `deployment.json`: verified Vercel project identities and the deferred Railway status.

No database password can be supplied until the new production database is provisioned.
No production secrets were uploaded to either platform. Vercel requires only the real server-side
`BACKEND_API_URL` and public `NEXT_PUBLIC_API_BASE_URL=/api/v1`, not database/testcase credentials.
Retain these ignored secret files securely; do not commit or delete them during cleanup.

Code changes prepared for deployment:

- Untargeted `backend/Dockerfile` builds now finish at the HTTP API stage. Previously the final
  stage was the judge, so a host building without `--target` would start the wrong process.
- Both Next.js applications have `vercel.json` and `build:vercel` profiles. Their ordinary local
  and standalone build commands remain available.
- With `VERCEL=1`, builds reject missing, insecure or non-origin `BACKEND_API_URL` values instead
  of publishing a frontend that tries to contact localhost.
- Vercel local metadata is excluded from Git/Docker uploads.

Checked: frozen offline installation, Prisma validation/generation, OpenAPI validation,
TypeScript, application lint, scaffold validation, all **68 root tests** (including six
deployment checks), and backend/student/admin production builds passed. The combined `validate`
invocation hit a Windows libuv assertion at Redocly shutdown; Redocly and the remaining checks
were run successfully as separate commands. A fresh full audit on 29 October passed the high/critical
gate but reported one moderate and one low advisory. This differs from the clean 24 October
snapshot; inspect `artifacts/security/` and rerun before a release. No live health/login/migration
or real judge test is claimed for these prepared cloud projects.

### What remains before a working public deployment

1. Resolve the Railway cost constraint. Do not create metered workloads under an assumption of
   permanent free hosting. A workspace spending cap could also stop existing unrelated projects;
   it was not changed without your authorization.
2. Create a **new** production PostgreSQL **17** service/database and persistent authenticated
   Redis, using a separate production project/environment. Record the actual resource IDs/URLs.
3. Apply the reviewed migrations through a one-off migration job inside Railway's private
   network. Provision restricted workload LOGIN identities with the groups in
   `backend/prisma/runtime-grants.sql`; never run the API as the database owner/superuser.
4. Deploy the student API, separate administration API if publishing admin, and maintenance
   worker using only their required private env variables. Verify DB/Redis connections.
5. Set each Vercel project's `BACKEND_API_URL` to its actual HTTPS Railway API origin. Add the
   exact final student/admin Vercel origins to the correct backend origin allowlists, then build
   and deploy. Vercel rewrites use that value at build time; redeploy after changing it.
6. Provision real accounts using an approved production onboarding process. Do not reuse local
   demo credentials or bypass the development-only guards to run fixture seeds in production.
7. Verify HTTPS cookies, CSRF, login/logout, ownership/role restrictions, refresh/draft recovery,
   expiry and maintenance. Inspect both platform deployment logs and actual health responses.
8. Keep `EXECUTION_ENABLED=false` until an independently isolated Linux gVisor broker and judge
   coordinators are provisioned and the real gate passes. Vercel/Railway web deployment alone
   does not provide this sandbox. Do not reuse the Windows development judge as production.

The remaining sections describe setup instructions, not completed cloud actions.

This complete guide details how to take the Assessment Platform codebase from this repository and deploy it to a live production environment using:

- **Backend**: [Railway](https://railway.com) (PostgreSQL 17, Redis, NestJS API, Maintenance Worker)
- **Frontend**: [Vercel](https://vercel.com) (Next.js 16 Student Portal, optional Admin Portal)

---

## Table of Contents

1. [Architecture & Deployment Overview](#1-architecture--deployment-overview)
2. [All Required Keys, Secrets, and Environment Variables](#2-all-required-keys-secrets-and-environment-variables)
   - [Cryptographic Secrets (How to Generate)](#a-cryptographic-secrets-how-to-generate)
   - [Database & Redis URLs (From Railway)](#b-database--redis-urls-from-railway)
   - [Platform API Tokens & Docker Registry Keys](#c-platform-api-tokens--docker-registry-keys)
   - [Backend Service Environment Variables (Railway)](#d-backend-service-environment-variables-railway)
   - [Frontend Service Environment Variables (Vercel)](#e-frontend-service-environment-variables-vercel)
3. [Step-by-Step Backend Deployment on Railway](#3-step-by-step-backend-deployment-on-railway)
   - [Step 3.1: Create Project and Provision PostgreSQL](#step-31-create-project-and-provision-postgresql)
   - [Step 3.2: Provision Redis](#step-32-provision-redis)
   - [Step 3.3: Deploy NestJS API Container](#step-33-deploy-nestjs-api-container)
   - [Step 3.4: Run Database Migrations](#step-34-run-database-migrations)
   - [Step 3.5: Deploy the Maintenance Worker (BullMQ Outbox)](#step-35-deploy-the-maintenance-worker-bullmq-outbox)
   - [Development-only CLI Railway Setup](#development-only-cli-railway-setup)
4. [Step-by-Step Frontend Deployment on Vercel](#4-step-by-step-frontend-deployment-on-vercel)
   - [Step 4.1: Import Repository to Vercel](#step-41-import-repository-to-vercel)
   - [Step 4.2: Configure Monorepo Build Settings](#step-42-configure-monorepo-build-settings)
   - [Step 4.3: Configure Environment Variables](#step-43-configure-environment-variables)
   - [Step 4.4: Deploy and Connect Vercel URL with Railway CORS](#step-44-deploy-and-connect-vercel-url-with-railway-cors)
   - [Step 4.5: (Optional) Deploy Admin Portal to Vercel](#step-45-optional-deploy-admin-portal-to-vercel)
5. [Docker Build & Container Registry Workflow](#5-docker-build--container-registry-workflow)
6. [Post-Deployment Smoke Tests & Verification](#6-post-deployment-smoke-tests--verification)
7. [Troubleshooting & Common Production Errors](#7-troubleshooting--common-production-errors)

---

## 1. Architecture & Deployment Overview

The codebase is organized as a pnpm monorepo under `assessment-platform/`:

```
Assignment/
├── package.json                         # Root launcher scripts
└── assessment-platform/
    ├── package.json                     # Monorepo root package & scripts
    ├── pnpm-workspace.yaml              # Workspace packages definition
    ├── backend/                         # NestJS API, Prisma ORM, BullMQ workers
    │   └── Dockerfile                   # Multi-stage Dockerfile (api, maintenance, judge, migrate)
    ├── frontend/                        # Next.js 16 Student Web App & Monaco Editor
    │   └── next.config.ts               # Proxies /api/v1 via Next.js rewrites to BACKEND_API_URL
    ├── admin/                           # Next.js 16 Admin Web App
    ├── contracts/                       # OpenAPI contract specifications & generated types
    ├── infra/                           # Deployment manifests, systemd, Caddy, monitoring
    └── scripts/                         # Build, Monaco security, and Railway helper scripts
```

### How the Frontend Communicates with the Backend

- In `frontend/next.config.ts`, Next.js rewrites `/api/v1/:path*` to `${process.env.BACKEND_API_URL}/api/v1/:path*`.
- The student's browser talks **exclusively** to the Vercel domain (`https://your-frontend.vercel.app/api/v1/...`).
- Next.js running on Vercel acts as a reverse proxy, forwarding API requests to the Railway backend.
- This design ensures cookies with the `__Host-` prefix (`__Host-assessment_session`) function securely in the browser, while preventing cross-origin cookie blocking.

---

## 2. All Required Keys, Secrets, and Environment Variables

### A. Cryptographic Secrets (How to Generate)

These secrets are strictly validated by the backend's Zod environment parser (`backend/src/config/environment.ts`) when `NODE_ENV=production`. If any key is missing or shorter than required, the backend will refuse to boot.

| Key                          | Description                                | Length / Format                                   | How to Generate / Command                                                                                               |
| ---------------------------- | ------------------------------------------ | ------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------- |
| `CSRF_SIGNING_KEY`           | Secret used to HMAC-sign CSRF tokens       | Min 32 characters hex/string                      | Run in terminal:<br>`node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"`                          |
| `PUBLIC_TESTCASE_KMS_KEY_ID` | Identifier for public testcase key version | String identifier matching its real keyring entry | Use the PUBLIC entry ID from the preserved production keyring. An arbitrary new ID does not create encryption material. |
| `SESSION_COOKIE_NAME`        | Name of the session cookie                 | Must be `__Host-assessment_session`               | Fixed value: `__Host-assessment_session`                                                                                |
| `SESSION_SECURE`             | Forces HTTPS-only cookies                  | Must be `true` in production                      | Fixed value: `true`                                                                                                     |
| `JUDGE_QUEUE_PREFIX`         | Prefix for BullMQ queues                   | Alphanumeric with hyphens                         | Fixed value: `assessment-production`                                                                                    |

---

### B. Database & Redis URLs (From Railway)

| Key                 | Description                                                                                      | How to Obtain from Railway                                                                                                                    |
| ------------------- | ------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------- |
| `DATABASE_URL`      | PostgreSQL 17 connection string with SCRAM auth                                                  | Automatically provided by Railway Postgres service as `${{Postgres.DATABASE_URL}}` or found under **Postgres Service > Variables / Connect**. |
| `REDIS_QUEUE_URL`   | Redis URL for BullMQ job queue (DB 0)                                                            | From Railway Redis service: `${{Redis.REDIS_URL}}/0`                                                                                          |
| `REDIS_SESSION_URL` | Configured/reserved Redis DB 1 URL; actual sessions currently live in PostgreSQL `auth_sessions` | Derive from the real Redis URL using its database pathname; do not blindly append a second path.                                              |

> Use Railway private networking for services in the same authorized project/environment. Use
> separate restricted workload logins and verified TLS with the service CA; the provider's
> default database owner URL is not an appropriate runtime API identity. Private networking
> does not imply zero latency. A Windows terminal cannot directly resolve Railway private hosts.

---

### C. Platform API Tokens & Docker Registry Keys

| Token / Key Name                                      | Where It Is Used                                                                      | How to Get It                                                                                                                                                                                             |
| ----------------------------------------------------- | ------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Railway CLI authorization**                         | Local operator deployment                                                             | Existing CLI OAuth sign-in is sufficient. `RAILWAY_API_TOKEN` is account-scoped; `RAILWAY_TOKEN` is project-scoped. Do not expose either in application envs or source.                                   |
| **Vercel CLI authorization**                          | Local operator deployment                                                             | The existing CLI OAuth authorization is sufficient. A scoped `VERCEL_TOKEN` is optional for separately configured CI; do not create a Full Access token by default or place it in frontend env variables. |
| **GitHub Container Registry (GHCR) Token** (`CR_PAT`) | _(Optional)_ If building Docker images on your machine and pushing to GitHub Packages | 1. GitHub > Settings > **Developer Settings**<br>2. **Personal access tokens** > **Tokens (classic)**<br>3. Generate token with `write:packages`, `read:packages`, `repo` scopes.                         |
| **Docker Hub Token**                                  | _(Optional)_ If publishing images to Docker Hub                                       | 1. Log in to [hub.docker.com](https://hub.docker.com)<br>2. Account Settings > **Security** > **New Access Token**                                                                                        |

_(Note: When connecting Railway and Vercel directly to your GitHub repository, images and builds happen natively inside Railway and Vercel—you do not need an external Docker Hub account!)_

---

### D. Backend Service Environment Variables (Railway)

Set these in the **Variables** tab of your Railway Backend Service:

```env
# Runtime mode
NODE_ENV=production
HOST=0.0.0.0
PORT=4000
LOG_LEVEL=info

# Database (Railway Postgres reference or private URL)
DATABASE_URL=postgresql://RESTRICTED_API_LOGIN:PRIVATE_PASSWORD@PRIVATE_POSTGRES_HOST:5432/assessment_production?sslmode=verify-full
DATABASE_POOL_MAX=20

# Redis (Railway Redis reference or private URL)
REDIS_QUEUE_URL=rediss://REDIS_LOGIN:PRIVATE_PASSWORD@PRIVATE_TLS_REDIS_HOST:6379/0
REDIS_SESSION_URL=rediss://REDIS_LOGIN:PRIVATE_PASSWORD@PRIVATE_TLS_REDIS_HOST:6379/1

# CORS & Origins (Must match your Vercel deployment URL exactly, HTTPS, NO trailing slash)
APP_ORIGINS=https://your-frontend.vercel.app
# If deploying admin portal as well:
# ADMIN_ORIGINS belongs in the separate privileged admin API environment.

# Security & Sessions
SESSION_COOKIE_NAME=__Host-assessment_session
SESSION_SECURE=true
SESSION_TTL_SECONDS=43200
SESSION_REMEMBER_TTL_SECONDS=604800
CSRF_SIGNING_KEY=PASTE_YOUR_GENERATED_64_CHAR_HEX_KEY_HERE
TRUST_PROXY_HOPS=1

# Rate limiting
LOGIN_ACCOUNT_LIMIT=10
LOGIN_IP_LIMIT=1000
LOGIN_WINDOW_SECONDS=900
ARGON2_MEMORY_KIB=65536
ARGON2_TIME_COST=3
ARGON2_PARALLELISM=1

# Queues & Execution
JUDGE_QUEUE_PREFIX=assessment-production
PUBLIC_TESTCASE_KMS_KEY_ID=production-public-v1
EXECUTION_ENABLED=false
EXECUTION_MAX_PENDING_PUBLIC=1500
EXECUTION_MAX_PENDING_HIDDEN=1500
```

> [!IMPORTANT]
> `APP_ORIGINS` and `ADMIN_ORIGINS` are validated with strict regex. They must start with `https://` and must **not** include a trailing slash (e.g. `https://assessment.vercel.app`, not `https://assessment.vercel.app/`).

---

### E. Frontend Service Environment Variables (Vercel)

Set these in the **Environment Variables** tab of your Vercel Project:

```env
# Client-side base URL (always relative same-origin)
NEXT_PUBLIC_API_BASE_URL=/api/v1

# Server-side proxy target (Public HTTPS URL of your Railway Backend API)
BACKEND_API_URL=https://your-backend-api.up.railway.app
```

---

## 3. Step-by-Step Backend Deployment on Railway

### Step 3.1: Create Project and Provision PostgreSQL

1. Open [Railway Dashboard](https://railway.com/dashboard) and click **New Project**.
2. Select **Provision PostgreSQL**.
3. Railway will start a managed PostgreSQL container.
4. Click on the PostgreSQL card, navigate to the **Variables** tab, and verify that `DATABASE_URL` is generated.
5. Provision PostgreSQL **17** from the start. Do not change a populated service's image to another major version; that requires a separate reviewed database migration.

---

### Step 3.2: Provision Redis

1. In the same Railway project, click **+ Create** or **+ New** button.
2. Select **Database** -> **Add Redis**.
3. Railway provisions a Redis instance.
4. Check the **Variables** tab of the Redis card to verify `REDIS_URL` is populated.

---

### Step 3.3: Deploy NestJS API Container

1. In the same Railway project, click **+ New** -> **GitHub Repo**.
2. Choose your repository (e.g. `your-username/Assignment`).
3. Click on the newly created service card and navigate to **Settings**:
   - **Service Name**: `assessment-api`
   - **Root Directory**: `assessment-platform`
   - **Build**:
     - **Builder**: Select `Dockerfile`
     - **Dockerfile Path**: `backend/Dockerfile`
     - Untargeted builds now select the final `railway-api` stage. An explicit `api` target is also supported where the builder exposes it; do not assume Railway config has a `dockerBuildTarget` field.
4. Go to the **Variables** tab and click **Raw Editor** or add each variable listed in [Section 2.D](#d-backend-service-environment-variables-railway).
5. Go to the **Networking** tab:
   - Click **Generate Domain**.
   - Copy your public Railway URL (e.g. `assessment-api-production-xxxx.up.railway.app`).

---

### Step 3.4: Run Database Migrations

Before the API can handle requests, the database tables must be initialized with Prisma migrations.

#### Option A: Run via Railway CLI from your local machine

From the `assessment-platform/` directory:

```powershell
# Login to Railway
pnpm railway:login

# Link to your Railway project
railway link

# Inspect available remote execution commands.
railway ssh --help
```

`railway run` executes locally with injected variables; it does not move your Windows terminal
inside Railway's private network. Use a dedicated one-off migration service built from the
`migrate` target, with its own private DBA URL, or an authenticated remote job that actually has
Prisma tooling and private connectivity. The ordinary runtime API image intentionally lacks
migration tooling. Rehearse migrations and backups first; do not reset existing data.

#### Production accounts and question content

`db:seed`, `dev:student`, `dev:admin-user`, `db:seed:judge` and `railway:setup/up` are development
workflows. They must not be run against production by forcing `NODE_ENV=development`.
Provision the first real administrator through a reviewed one-off production onboarding
operation, then author/assign real question versions and assessments. A fresh production schema
does not automatically contain your Windows demo accounts or fixtures.

---

### Step 3.5: Deploy the Maintenance Worker (BullMQ Outbox)

The maintenance worker handles attempt expiry, durable outbox dispatch, evaluation recovery
and result reconciliation. Authentication sessions are stored and expiry-checked in PostgreSQL.

1. In the same Railway project, click **+ New** -> **GitHub Repo** (select the same repo).
2. Go to **Settings**:
   - **Service Name**: `assessment-maintenance`
   - **Root Directory**: `assessment-platform`
   - **Dockerfile Path**: `backend/Dockerfile`
   - Use the same compiled runtime image with start command `node dist/workers/outbox/main.js`, or explicitly build the `maintenance` target on a builder that supports target selection.
3. Go to **Variables**:
   - Supply only `NODE_ENV`, `LOG_LEVEL`, `DATABASE_MAINTENANCE_URL`, its pool bound, `REDIS_QUEUE_URL`, matching `JUDGE_QUEUE_PREFIX` and reviewed maintenance limits. It needs no API signing key, question keyring or public domain.
4. Click **Deploy**.

---

### Development-only CLI Railway Setup

The scripts in `assessment-platform/scripts/railway.mjs` provision a development database and
start apps on your computer. They do **not** deploy a production API/frontend or bypass the
production account/migration process:

```powershell
cd d:\myProjects\redResumes\Assignment\assessment-platform

# 1. Sign in to Railway
pnpm railway:login

# 2. Provision isolated PostgreSQL 17 with custom TLS
pnpm railway:setup

# 3. Apply schema migrations and launch
pnpm railway:up
```

---

## 4. Step-by-Step Frontend Deployment on Vercel

The student portal is a Next.js 16 App Router application located in `assessment-platform/frontend`.

### Step 4.1: Import Repository to Vercel

1. Log in to [vercel.com](https://vercel.com) and click **Add New...** -> **Project**.
2. Select your Git provider (GitHub / GitLab) and click **Import** next to your repository.

---

### Step 4.2: Configure Monorepo Build Settings

In the Vercel project configuration screen:

1. **Framework Preset**: `Next.js`
2. **Root Directory**: Click **Edit** and choose:
   ```
   assessment-platform/frontend
   ```
   Check the box: **"Include source files outside of the Root Directory in the Build Step"** (essential because the frontend imports Monaco scripts and contracts from the parent folder).
3. **Build & Development Settings**:
   - Leave **Build Command** as default or set to:
     ```bash
     pnpm run build:vercel
     ```
   - **Output Directory**: `.next`
   - **Install Command**: `cd .. && pnpm install --frozen-lockfile`
   - **Node.js Version**: `24.x`; source files outside the Root Directory enabled.

---

### Step 4.3: Configure Environment Variables

Add the following variables in Vercel's **Environment Variables** section:

| Key                        | Value                                                   | Notes                                       |
| -------------------------- | ------------------------------------------------------- | ------------------------------------------- |
| `BACKEND_API_URL`          | `https://assessment-api-production-xxxx.up.railway.app` | Replace with your Railway API domain        |
| `NEXT_PUBLIC_API_BASE_URL` | `/api/v1`                                               | Do not change; routes through Next.js proxy |

---

### Step 4.4: Deploy and Connect Vercel URL with Railway CORS

1. Click **Deploy**.
2. Once the build finishes, Vercel gives you your production URL (e.g. `https://assessment-student.vercel.app`).
3. **Crucial Final Step**:
   - Go back to your **Railway Dashboard** -> **assessment-api** service -> **Variables**.
   - Update `APP_ORIGINS` to match your Vercel URL:
     ```env
     APP_ORIGINS=https://assessment-student.vercel.app
     ```
   - Railway will automatically redeploy the backend with the new CORS permissions.

---

### Step 4.5: (Optional) Deploy Admin Portal to Vercel

If you want administrators to have their own dashboard:

1. In Vercel, click **Add New...** -> **Project** -> Import the same repository.
2. Set **Project Name**: `assessment-admin`.
3. Set **Root Directory**: `assessment-platform/admin`.
4. Environment Variables:
   - `BACKEND_API_URL` = `https://assessment-api-production-xxxx.up.railway.app`
   - `NEXT_PUBLIC_API_BASE_URL` = `/api/v1`
5. Deploy and copy the admin URL (e.g. `https://assessment-admin.vercel.app`).
6. In Railway Backend Variables, set:
   ```env
   ADMIN_ORIGINS=https://assessment-admin.vercel.app
   ```

---

## 5. Docker Build & Container Registry Workflow

If you prefer building Docker containers locally or via GitHub Actions and pushing them to a private container registry (such as GitHub Container Registry or Docker Hub) before pulling into Railway:

### 5.1 Build All Images Locally

Run these commands from `assessment-platform/` (Docker context must be the monorepo root):

```powershell
cd d:\myProjects\redResumes\Assignment\assessment-platform

# 1. Login to GitHub Container Registry
# (Replace USERNAME and paste your GitHub Personal Access Token)
echo $CR_PAT | docker login ghcr.io -u YOUR_GITHUB_USERNAME --password-stdin

# 2. Build Backend API target
docker build `
  --target api `
  -f backend/Dockerfile `
  -t ghcr.io/YOUR_GITHUB_USERNAME/assessment-api:latest .

# 3. Build Maintenance Worker target
docker build `
  --target maintenance `
  -f backend/Dockerfile `
  -t ghcr.io/YOUR_GITHUB_USERNAME/assessment-maintenance:latest .

# 4. Build Database Migration runner target
docker build `
  --target migrate `
  -f backend/Dockerfile `
  -t ghcr.io/YOUR_GITHUB_USERNAME/assessment-migrate:latest .

# 5. Build Frontend (Standalone server)
docker build `
  -f frontend/Dockerfile `
  -t ghcr.io/YOUR_GITHUB_USERNAME/assessment-frontend:latest .

# 6. Push images to Registry
docker push ghcr.io/YOUR_GITHUB_USERNAME/assessment-api:latest
docker push ghcr.io/YOUR_GITHUB_USERNAME/assessment-maintenance:latest
docker push ghcr.io/YOUR_GITHUB_USERNAME/assessment-migrate:latest
docker push ghcr.io/YOUR_GITHUB_USERNAME/assessment-frontend:latest
```

---

## 6. Post-Deployment Smoke Tests & Verification

Once both Railway and Vercel are running, execute these tests:

### 1. Test Backend Liveness and Readiness

Run in your browser or terminal:

```bash
# 1. Liveness (proves process is up)
curl https://your-backend-api.up.railway.app/api/v1/health/live

# 2. Readiness (verifies PostgreSQL and Redis connections)
curl https://your-backend-api.up.railway.app/api/v1/health/ready
```

Inspect the actual API envelope and HTTP status. Readiness must have `data.ready=true` and
database readiness; execution/queue readiness is explicitly `DISABLED` while execution is off.
A 200 liveness response is not proof that Redis, grading or the sandbox works.

### 2. Test Frontend Rewrites & CSRF

Navigate to your Vercel domain in your browser:

```
https://your-frontend.vercel.app/login
```

Open **Developer Tools (F12)** -> **Network Tab**:

1. Check that a request was sent to `/api/v1/auth/csrf`.
2. Status should be `200 OK` with JSON response containing `{ "csrfToken": "...", "expiresAt": "..." }`.
3. Check the **Application > Cookies** tab:
   - You should see `__Host-assessment_csrf` cookie present with `Secure` flag enabled.

### 3. Test Student Login Flow

1. Attempt to log in with an assigned student credential.
2. A successful login sets the `__Host-assessment_session` cookie (HttpOnly, Secure, Lax).
3. The dashboard loads assessments without any CORS or cross-domain cookie warnings.

---

## 7. Troubleshooting & Common Production Errors

### ❌ Error: `Production requires a shared CSRF_SIGNING_KEY of at least 32 characters`

- **Cause**: `CSRF_SIGNING_KEY` is missing or fewer than 32 characters long.
- **Fix**: Generate a 64-character random hex string:
  ```powershell
  node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
  ```
  Add it to Railway Backend variables and redeploy.

---

### ❌ Error: `Production browser origins require HTTPS` / `APP_ORIGINS must contain exact origins`

- **Cause**: `APP_ORIGINS` has `http://`, contains trailing slashes, or has paths.
- **Fix**: Format `APP_ORIGINS` strictly as:
  ```env
  APP_ORIGINS=https://your-frontend.vercel.app
  ```
  (No trailing `/`, no path like `/login`).

---

### ❌ Error: `CSRF_INVALID: Your security token expired. Refresh and try again.`

- **Cause**: Origin mismatch between Vercel and Railway, or browser cookies are blocked.
- **Fix**: Verify that:
  1. The Vercel app is calling its own same-origin `/api/v1/auth/csrf` (handled automatically by `NEXT_PUBLIC_API_BASE_URL=/api/v1`).
  2. `BACKEND_API_URL` on Vercel points to the valid Railway domain.
  3. `TRUST_PROXY_HOPS=1` is set in Railway backend variables so Express correctly handles forwarded SSL headers.

---

### ❌ Error: `P1001: Can't reach database server`

- **Cause**: Backend cannot connect to Railway Postgres.
- **Fix**: Check the actual workload login URL, private networking, database name, service readiness and CA trust. Use verified TLS (`sslmode=verify-full` and the correct public CA) for external connections. Never use `no-verify`, disable certificate validation, or switch to an owner password merely to silence a connection error.

---

### ❌ Error: Vercel Build Fails on `prepare-monaco.mjs`

- **Cause**: Vercel could not access files outside the `frontend` folder.
- **Fix**: In Vercel Project Settings -> Git -> **Root Directory**, ensure **"Include source files outside of the Root Directory in the Build Step"** is checked. Alternatively, run the build from the monorepo root:
  - Root Directory: `assessment-platform`
  - Build Command: `pnpm --filter @assessment/frontend build`
  - Output Directory: `frontend/.next`
