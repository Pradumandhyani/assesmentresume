# Step 2: student authentication and dashboard

Step 2 implements the student login, authenticated dashboard, own-assessment reads and development data seeding. The three application boundaries, initial migration, immutable question rules and future assessment contracts remain intact. Only the student App Router directory moved from `frontend/app` to the requested `frontend/src/app`; the existing feature/component/service folders remain in place.

## Run against your development PostgreSQL database

From `assessment-platform`, use Node 24.12+ within major 24 and pnpm 10.34.6. On Windows, use `pnpm.cmd` if `.ps1` launchers are blocked.

1. Copy root `.env.example` to `.env`, backend `.env.example` to `backend/.env`, and frontend `.env.example` to `frontend/.env.local`. Choose a local PostgreSQL password in root `.env`; put the same URL-encoded password in the backend `DATABASE_URL`.
2. Run `pnpm install --frozen-lockfile`, `pnpm db:generate`, and `pnpm infra:up` (Docker Compose).
3. On an **empty development database**, run `pnpm db:migrate`. On a database already created by Step 1, this applies only `20261011010000_student_dashboard`. The original migration remains unchanged and refuses adoption of an existing, unmanaged users table. For an existing production identity database, follow [the read-only introspection and adoption process](database.md) first; this implementation assumes the checked-in Prisma mapping. No production database was available to inspect.
4. Use existing `Student.externalId` credentials. If you need a local student on an empty database, explicitly provide `DEV_STUDENT_ID`, `DEV_STUDENT_NAME`, and `DEV_STUDENT_PASSWORD` in your private backend `.env`, then run `pnpm dev:student`. Passwords must be at least 12 characters. Existing identities, disabled status and hashes are never overwritten by this script. No registration endpoint or default student password exists.
5. Set optional `DEV_ASSESSMENT_START_AT` to an ISO UTC value ending in `Z`, then run `pnpm db:seed`. Without this setting, the **first** seed uses database time plus one hour. Reruns retain the original schedule and add assignments for newly provisioned active students, preserving revoked assignments. Start time is persisted in PostgreSQL, never defined by the browser.
6. In separate terminals, run `pnpm dev:backend` and `pnpm dev:frontend`. Open `http://localhost:3000/login`. The student app proxies `/api/v1` to `BACKEND_API_URL`; neither Next.js app connects to PostgreSQL.

Seeding requires explicit `NODE_ENV=development` and a database name containing `dev` or `test`. It creates one assessment with 180 minutes, 2 Easy / 1 Medium / 1 Hard, Python / Java / C++, a 30-minute admission window and a disabled fixture-owner identity. Four clearly marked fixture question versions satisfy the existing database publication constraints. Fixture test cases are encrypted with an ephemeral development-only key; the key is discarded, the toolchains are unconfigured, and **these fixtures cannot be used for real execution or grading**. Create reviewed versions with real KMS encryption and configured toolchains in the later question-management step. Seeding performs no allocation, execution or grading.

For production artifact checks:

```powershell
pnpm.cmd --filter @assessment/backend build
pnpm.cmd --filter @assessment/frontend build
# backend/.env must contain your database configuration:
pnpm.cmd --filter @assessment/backend start
# In another terminal; set PORT=3000 and HOSTNAME=127.0.0.1 if needed:
pnpm.cmd --filter @assessment/frontend start
```

The frontend build copies assets into `.next/standalone/frontend`; its start script runs the standalone server. Set `BACKEND_API_URL` **before building** so the Next.js rewrite and server-side session validation use the same upstream. Production uses HTTPS with the cookie and origin settings below. The admin app remains the Step 1 scaffold.

## Authentication implementation

Repository implementations occupy the existing feature `repositories/` folders and preserve their Step 1 contracts. `AuthService` owns session creation/revocation transactions and passes the transaction client into repository writes; repositories do not open nested transactions.

- Login looks up the exact trimmed `Student.externalId` in PostgreSQL. Passwords are never trimmed. Missing IDs, wrong passwords, disabled users and role mismatches return the same sanitized 401 message. Unknown or ineligible users still incur a dummy Argon2 verification. Malformed hashes fail closed. JSON passwords/hashes/tokens are never included in logs or returned to browsers.
- Newly generated hashes use Argon2id with 64 MiB, time cost 3, parallelism 1 by default. Hash work runs at most four operations per API process with a bounded 32-request wait queue; saturation returns 503. Accepted existing Argon2 v19 hashes have exactly `m`, `t`, `p` parameters in any order and bounded memory/time/parallelism. Existing bcrypt `$2a$`, `$2b$`, `$2y$` hashes with cost 8–14 are verified only for passwords of at most 72 UTF-8 bytes, avoiding bcrypt truncation ambiguity.
- After a successful supported legacy verification, rehash to Argon2id in a transaction that locks and rechecks the existing user/hash, active status, role and `authVersion`. No rewrite occurs on a failed login. Rehashing preserves at least the previous Argon2 memory and time budgets, and current Argon2id hashes above policy are retained. Unsupported formats, bcrypt passwords above 72 bytes, excessive-cost hashes and Argon2 versions other than v19 require an institution-approved migration/reset process. There is no plaintext/MD5/SHA fallback or automatic production reset.
- A 256-bit opaque session token exists only in the HttpOnly cookie. PostgreSQL stores its SHA-256 digest, the CSRF digest, the issuing auth version, expiry and revocation. Every protected request checks database time, active status, version, role and profile. No process-local session store or Redis cache can resurrect a revoked session.
- Default sign-in uses a browser-session cookie and a 12-hour absolute database expiry. Remember-device sign-in uses a persistent cookie and a seven-day absolute expiry (configurable, capped at 30 days). There is no sliding extension. Browser restoration may preserve session cookies; the database expiry remains authoritative. Logout revokes the database session and expires cookies. Re-login rotates the incoming session.
- Production requires `SESSION_SECURE=true`, `SESSION_COOKIE_NAME=__Host-assessment_session`, exact HTTPS `APP_ORIGINS`, and a shared random `CSRF_SIGNING_KEY` of at least 32 characters. Cookies use `HttpOnly`, `Secure`, `SameSite=Lax`, `Path=/`, with **no Domain**. Leave `TRUST_PROXY_HOPS=0` for direct access; set it to 1 only behind exactly one trusted proxy that cannot be bypassed. Do not expose a trusted-proxy-configured API directly to the internet.
- `GET /auth/csrf` issues a signed, short-lived pre-auth nonce with an HttpOnly cookie or a session-bound CSRF token. All implemented unsafe requests validate exact Origin and the cookie/session binding. Login and logout rotate/clear the nonce. CSRF tokens are fetched immediately before mutations and kept only in request memory.
- Shared, atomic PostgreSQL rate counters protect the account and client IP across API replicas: default 10 attempts per ID and 1,000 per IP in 15 minutes. Counters use HMAC keys, not raw identifiers/IPs. The NAT-friendly IP budget supports a shared campus address; apply additional edge protection and tune using real login traffic. Production replicas must share the signing key. Missing database state fails closed. Schedule periodic deletion of expired counters and expired/revoked sessions according to retention policy; no cleanup worker is implemented in Step 2.

Permissions are enforced by a default authentication guard. Student controllers additionally require `STUDENT`; admin namespaces require `ADMIN` even if a future controller omits role metadata. Tests register an admin-only probe **inside the test module only** to prove a student receives 403. No admin feature endpoint was added.

## Implemented API routes

All paths below are under `/api/v1`, use the Step 1 `{ data, meta }` / `{ error }` envelopes, and return `Cache-Control: no-store` plus request IDs and UTC server timestamps. OpenAPI and the generated TypeScript are the transport source of truth.

| Route                              | Permission           | Behavior                                                                   |
| ---------------------------------- | -------------------- | -------------------------------------------------------------------------- |
| `GET /auth/csrf`                   | Public               | Signed pre-auth/session CSRF token                                         |
| `POST /auth/login`                 | Public + CSRF        | `{ identifier, password, remember? }`; validate student and rotate session |
| `POST /auth/logout`                | Authenticated + CSRF | Revoke session and clear cookies                                           |
| `GET /auth/me`                     | Authenticated        | Safe user and student projection, absolute expiry                          |
| `GET /auth/session`                | Authenticated        | Preserved Step 1 session alias                                             |
| `GET /student/me`                  | Student              | Own profile only                                                           |
| `GET /assessments`                 | Student              | Assigned dashboard items, category totals, cursor pagination               |
| `GET /assessments/upcoming`        | Student              | Own upcoming assignments                                                   |
| `GET /assessments/:id/eligibility` | Student owner        | Recheck schedule/attempt state with PostgreSQL time                        |
| `GET /student/assessments`         | Student              | Preserved Step 1 summary-list contract                                     |
| `GET /student/assessments/:id`     | Student owner        | Preserved schedule/rules contract                                          |

List query parameters are `limit` (1–100, default 25) and `cursor` (last assignment UUID). Category totals include all visible assigned records, including pages not yet loaded. Draft and revoked assignments are omitted. Other students' assignments return 404. Only explicitly projected schedule/rule/profile/result fields leave the API; question versions, templates, ciphertext, hidden cases and password hashes do not. Scores are exposed only after `resultsReleaseAt` and a complete assessment result.

## Countdown and Step 2 boundary

The displayed timer anchors to response `meta.serverNow` and advances using `performance.now()`, not the client wall clock. Queries refresh every 15 seconds and on focus, reconnect and visibility changes. The clock becomes untrusted after 20 seconds or tab suspension and the button remains disabled until another server response arrives. A local countdown reaching zero never changes a `canStart=false` decision to true. Closed/cancelled/expired/completed assessments remain ineligible. The exact latest-start instant is allowed; later admission is rejected.

Clicking an eligible Start Assessment button performs a **read-only server eligibility check** and opens an accessible availability dialog. It explicitly says the coding workspace is unavailable and no attempt/timer has started. `POST /student/assessments/:id/attempts` remains a reserved Step 1 contract. A genuine start must allocate exactly four immutable versions and establish the deadline atomically; creating an incomplete attempt would violate Step 1 and exceed Step 2. No editor, question allocation, exam page, finalization worker, judge or administration feature is implemented.

## Verification

```powershell
pnpm.cmd config:check
pnpm.cmd contracts:lint
pnpm.cmd db:validate
pnpm.cmd db:generate
pnpm.cmd typecheck
pnpm.cmd lint
pnpm.cmd test
pnpm.cmd test:backend
pnpm.cmd test:frontend
pnpm.cmd --filter @assessment/backend build
pnpm.cmd --filter @assessment/frontend build
pnpm.cmd exec playwright install chromium
pnpm.cmd test:e2e
```

The backend integration suite runs real Prisma/pg SQL and real HTTP requests over an isolated [PGlite socket](https://pglite.dev/docs/pglite-socket), applies both checked-in SQL migrations and creates test-only identities. Browser tests start that database, the compiled NestJS API and production Next.js standalone server; no browser/API response is mocked. Unit tests use explicit test doubles where appropriate. PGlite has single-connection semantics, so it does not establish PostgreSQL 17 concurrency, pool or deployment parity. Docker/native PostgreSQL validation and 500-student load tests remain separate deployment checks. Tests leave production databases untouched.

Changed file inventory and actual results are recorded in [Step 2 validation](step-2-validation.md). The [Step 1 validation](validation.md) remains a historical report.
