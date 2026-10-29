# Production Deployment Guide: Railway (Backend) & Vercel (Frontend)

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
   - [Alternative: CLI Automated Railway Setup](#alternative-cli-automated-railway-setup)
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

| Key | Description | Length / Format | How to Generate / Command |
|---|---|---|---|
| `CSRF_SIGNING_KEY` | Secret used to HMAC-sign CSRF tokens | Min 32 characters hex/string | Run in terminal:<br>`node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"` |
| `PUBLIC_TESTCASE_KMS_KEY_ID` | Identifier for public testcase key version | String identifier | Run in terminal:<br>`node -e "console.log('prod-key-' + require('crypto').randomBytes(8).toString('hex'))"` |
| `SESSION_COOKIE_NAME` | Name of the session cookie | Must be `__Host-assessment_session` | Fixed value: `__Host-assessment_session` |
| `SESSION_SECURE` | Forces HTTPS-only cookies | Must be `true` in production | Fixed value: `true` |
| `JUDGE_QUEUE_PREFIX` | Prefix for BullMQ queues | Alphanumeric with hyphens | Fixed value: `assessment-production` |

---

### B. Database & Redis URLs (From Railway)

| Key | Description | How to Obtain from Railway |
|---|---|---|
| `DATABASE_URL` | PostgreSQL 17 connection string with SCRAM auth | Automatically provided by Railway Postgres service as `${{Postgres.DATABASE_URL}}` or found under **Postgres Service > Variables / Connect**. |
| `REDIS_QUEUE_URL` | Redis URL for BullMQ job queue (DB 0) | From Railway Redis service: `${{Redis.REDIS_URL}}/0` |
| `REDIS_SESSION_URL` | Redis URL for user session tracking (DB 1) | From Railway Redis service: `${{Redis.REDIS_URL}}/1` |

> [!NOTE]
> If your Railway PostgreSQL service and backend API service are inside the same Railway project, use Railway's **Private Networking URL** (e.g. `postgresql://postgres:...@postgres.railway.internal:5432/railway`) instead of public proxy URLs for zero-latency, free internal bandwidth and higher security.

---

### C. Platform API Tokens & Docker Registry Keys

| Token / Key Name | Where It Is Used | How to Get It |
|---|---|---|
| **Railway Account Token** (`RAILWAY_TOKEN`) | Used by Railway CLI or GitHub Actions to push deployments | 1. Go to [railway.com](https://railway.com)<br>2. Click your Avatar > **Account Settings** > **Tokens**<br>3. Click **Create New Token** and copy the secret. |
| **Vercel Access Token** (`VERCEL_TOKEN`) | Used if deploying via Vercel CLI or GitHub Actions CI/CD | 1. Go to [vercel.com](https://vercel.com)<br>2. Click your Avatar > **Settings** > **Tokens**<br>3. Click **Create** (scope: Full Access) and copy. |
| **GitHub Container Registry (GHCR) Token** (`CR_PAT`) | *(Optional)* If building Docker images on your machine and pushing to GitHub Packages | 1. GitHub > Settings > **Developer Settings**<br>2. **Personal access tokens** > **Tokens (classic)**<br>3. Generate token with `write:packages`, `read:packages`, `repo` scopes. |
| **Docker Hub Token** | *(Optional)* If publishing images to Docker Hub | 1. Log in to [hub.docker.com](https://hub.docker.com)<br>2. Account Settings > **Security** > **New Access Token** |

*(Note: When connecting Railway and Vercel directly to your GitHub repository, images and builds happen natively inside Railway and Vercel—you do not need an external Docker Hub account!)*

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
DATABASE_URL=${{Postgres.DATABASE_URL}}
DATABASE_POOL_MAX=20

# Redis (Railway Redis reference or private URL)
REDIS_QUEUE_URL=${{Redis.REDIS_URL}}/0
REDIS_SESSION_URL=${{Redis.REDIS_URL}}/1

# CORS & Origins (Must match your Vercel deployment URL exactly, HTTPS, NO trailing slash)
APP_ORIGINS=https://your-frontend.vercel.app
# If deploying admin portal as well:
ADMIN_ORIGINS=https://your-admin.vercel.app

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
PUBLIC_TESTCASE_KMS_KEY_ID=prod-key-primary
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
5. In **Settings**, ensure the database version is PostgreSQL 16 or 17.

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
     - **Docker Build Target**: `api` (or configure Dockerfile build target)
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

# Run prisma migrate deploy against Railway's DATABASE_URL
railway run pnpm --filter @assessment/backend db:migrate
```

#### Option B: Run Seed (Initial Data / Admin User)
To create an administrator or initial seed dataset:
```powershell
railway run pnpm --filter @assessment/backend db:seed
# Or create an admin account:
railway run pnpm --filter @assessment/backend dev:admin-user
```

---

### Step 3.5: Deploy the Maintenance Worker (BullMQ Outbox)

The maintenance worker handles outbox events, session expiration cleanup, and queue dispatching.

1. In the same Railway project, click **+ New** -> **GitHub Repo** (select the same repo).
2. Go to **Settings**:
   - **Service Name**: `assessment-maintenance`
   - **Root Directory**: `assessment-platform`
   - **Dockerfile Path**: `backend/Dockerfile`
   - **Docker Build Target**: `maintenance`
3. Go to **Variables**:
   - Copy the same environment variables as `assessment-api`, but you do not need to generate a public domain (it runs headless in the background).
4. Click **Deploy**.

---

### Alternative: CLI Automated Railway Setup

The repository contains automated setup scripts located in `assessment-platform/scripts/railway.mjs`:

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
     node ../scripts/prepare-monaco.mjs && next build
     ```
   - **Output Directory**: `.next`
   - **Install Command**: `pnpm install`

---

### Step 4.3: Configure Environment Variables

Add the following variables in Vercel's **Environment Variables** section:

| Key | Value | Notes |
|---|---|---|
| `BACKEND_API_URL` | `https://assessment-api-production-xxxx.up.railway.app` | Replace with your Railway API domain |
| `NEXT_PUBLIC_API_BASE_URL` | `/api/v1` | Do not change; routes through Next.js proxy |

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
Expected response: `{"status":"ok", ...}` with HTTP 200.

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
- **Fix**: In Railway, link the services using Railway's reference variable `${{Postgres.DATABASE_URL}}` or use the private hostname `postgres.railway.internal`. If connecting externally, ensure SSL mode `?sslmode=no-verify` or proper CA cert is supplied.

---

### ❌ Error: Vercel Build Fails on `prepare-monaco.mjs`
- **Cause**: Vercel could not access files outside the `frontend` folder.
- **Fix**: In Vercel Project Settings -> Git -> **Root Directory**, ensure **"Include source files outside of the Root Directory in the Build Step"** is checked. Alternatively, run the build from the monorepo root:
  - Root Directory: `assessment-platform`
  - Build Command: `pnpm --filter @assessment/frontend build`
  - Output Directory: `frontend/.next`
