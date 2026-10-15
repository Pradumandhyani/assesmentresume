# DSA Assessment Platform — setup, run, seeds, and verification

This is the main run guide for the existing three applications:

| Application      | Folder    | Local URL                    | Purpose                                                                         |
| ---------------- | --------- | ---------------------------- | ------------------------------------------------------------------------------- |
| Student frontend | frontend/ | http://localhost:3000/login  | Login, dashboard, coding workspace, drafts, submissions, permitted results      |
| Backend API      | backend/  | http://localhost:4000/api/v1 | Authentication, PostgreSQL, administration, attempts, queues, grading           |
| Admin frontend   | admin/    | http://localhost:3001/login  | Students, assessments, question bank, monitoring, results, CSV, audit, settings |

The browser applications call the backend; they never connect to PostgreSQL. The initial assessment defaults to **180 minutes, four questions, two Easy / one Medium / one Hard, Python / Java / C++**. Published assessments can use bounded configurations; existing attempts retain their frozen rules, deadlines, and question versions.

**Execution is disabled by default.** Student/admin authentication and database workflows can run locally. Real Python/Java/C++ execution requires the dedicated Linux sandbox setup below. A passing local test suite does not certify sandbox isolation or capacity for 500 students.

## VS Code on Windows: start here

1. In VS Code choose **File → Open Folder** and open **D:\myProjects\redResumes\Assignment\assessment-platform**.
2. Choose **Terminal → New Terminal**. From the terminal profile dropdown, choose **PowerShell**. These commands use VS Code's integrated terminal; no separate command window is needed.
3. Run the following in every new terminal if it opens in a different folder:

```powershell
cd "D:\myProjects\redResumes\Assignment\assessment-platform"
```

### First-time setup in VS Code

Install dependencies, create/configure the environment files in section 2, and choose your private database password before starting infrastructure:

```powershell
node --version
npm.cmd install --global pnpm@10.34.6
pnpm.cmd install --frozen-lockfile
```

If pnpm.cmd is not found immediately after installation, close the integrated terminal and open a new one; restart VS Code if necessary so it picks up the updated PATH.

If VS Code still reports **pnpm.cmd is not recognized**, run this in its PowerShell terminal. The PATH change applies to the current terminal:

```powershell
npm.cmd install --global pnpm@10.34.6
$pnpmInstallDirectory = (npm.cmd config get prefix).Trim()
$env:Path = "$pnpmInstallDirectory;$env:Path"
pnpm.cmd --version
```

Then run **pnpm.cmd dev**. You can also invoke the installed launcher directly with **& "$pnpmInstallDirectory\pnpm.cmd" dev**. This avoids changing PowerShell's execution policy.

With Docker Desktop installed, running, and configured for Linux containers, and the environment files configured:

```powershell
pnpm.cmd infra:up
pnpm.cmd db:generate
pnpm.cmd db:migrate
```

If you use an existing PostgreSQL/Redis installation, configure its URLs instead of running infra:up. Do not skip database configuration: the backend needs PostgreSQL to start.

For a new development database, set DEV_STUDENT_ID, DEV_STUDENT_NAME, DEV_STUDENT_PASSWORD, DEV_ADMIN_EMAIL, DEV_ADMIN_NAME, and DEV_ADMIN_PASSWORD in backend/.env, then run:

```powershell
pnpm.cmd dev:student
pnpm.cmd dev:admin-user
pnpm.cmd db:seed
```

### Daily start: one terminal

After initial setup, this starts the backend, student frontend, and admin together:

```powershell
pnpm.cmd dev
```

### Daily start: three terminals

Use the **+** button in VS Code's terminal panel to open three PowerShell terminals. Run the cd command above in each terminal, then:

| VS Code terminal     | Command               | URL                          |
| -------------------- | --------------------- | ---------------------------- |
| Terminal 1 — backend | pnpm.cmd dev:backend  | http://localhost:4000/api/v1 |
| Terminal 2 — student | pnpm.cmd dev:frontend | http://localhost:3000/login  |
| Terminal 3 — admin   | pnpm.cmd dev:admin    | http://localhost:3001/login  |

Use either the one-terminal command or the three-terminal method, rather than starting both at once. Keep the terminals running while you use the applications. Press **Ctrl+C** in each terminal to stop its process. Docker services can be stopped separately with **pnpm.cmd infra:stop**; this preserves database volumes.

The Windows/local commands below can also run in this same VS Code PowerShell terminal. Sections explicitly labelled Linux must run through a VS Code Remote SSH/WSL terminal connected to a suitably configured Linux host; running them in ordinary Windows PowerShell does not provide a gVisor sandbox.

## 1. Prerequisites

- Node.js **24.12.0 or later in major 24**; Node 25 is outside the supported range.
- pnpm **10.34.6**.
- PostgreSQL **17**, plus Redis for queues and automatic expiry/grade reconciliation. Docker Compose can provide the development database and Redis.
- A Chromium browser installation for Playwright tests.
- For real code execution: a dedicated Linux host, Docker, cgroups v2, reviewed gVisor/runsc, pinned toolchain images, mTLS certificates, and private testcase keys.

On Windows, use the **.cmd** command launchers if PowerShell blocks .ps1 scripts.

```powershell
Set-Location 'D:\myProjects\redResumes\Assignment\assessment-platform'
node --version
npm.cmd install --global pnpm@10.34.6
pnpm.cmd --version
pnpm.cmd install --frozen-lockfile
```

All commands in this README run from **assessment-platform/** unless a different directory is stated. On Linux/macOS, use pnpm instead of pnpm.cmd.

## 2. Configure the environment

Create local files only when they do not already exist. This preserves an existing database connection and credentials.

```powershell
if (!(Test-Path '.env')) { Copy-Item '.env.example' '.env' }
if (!(Test-Path 'backend/.env')) { Copy-Item 'backend/.env.example' 'backend/.env' }
if (!(Test-Path 'frontend/.env.local')) { Copy-Item 'frontend/.env.example' 'frontend/.env.local' }
if (!(Test-Path 'admin/.env.local')) { Copy-Item 'admin/.env.example' 'admin/.env.local' }
```

Edit these files:

| File                | Required local configuration                                                                                  |
| ------------------- | ------------------------------------------------------------------------------------------------------------- |
| .env                | POSTGRES_DB, POSTGRES_USER, POSTGRES_PASSWORD, POSTGRES_PORT, REDIS_PORT                                      |
| backend/.env        | NODE_ENV, DATABASE_URL, Redis URLs, student/admin origins, cookies, optional explicit development credentials |
| frontend/.env.local | BACKEND_API_URL; keep NEXT_PUBLIC_API_BASE_URL=/api/v1                                                        |
| admin/.env.local    | BACKEND_API_URL; keep NEXT_PUBLIC_API_BASE_URL=/api/v1                                                        |

Use a database named **assessment_dev** or another name containing dev/test for the development seed commands. Choose your own PostgreSQL password. The password in DATABASE_URL must match POSTGRES_PASSWORD and must be URL-encoded if it contains special characters.

The relevant backend values are:

```dotenv
NODE_ENV=development
PORT=4000
DATABASE_URL=postgresql://assessment_dev:YOUR_URL_ENCODED_PASSWORD@127.0.0.1:5432/assessment_dev?schema=public
DATABASE_POOL_MAX=20
REDIS_QUEUE_URL=redis://127.0.0.1:6379/0
REDIS_SESSION_URL=redis://127.0.0.1:6379/1
APP_ORIGINS=http://localhost:3000,http://127.0.0.1:3000
ADMIN_ORIGINS=http://localhost:3001,http://127.0.0.1:3001
SESSION_COOKIE_NAME=assessment_session_dev
SESSION_SECURE=false
EXECUTION_ENABLED=false
```

Retain the other fields from backend/.env.example. Both Next.js environment files should use:

```dotenv
NEXT_PUBLIC_API_BASE_URL=/api/v1
BACKEND_API_URL=http://127.0.0.1:4000
```

Do not put database URLs, passwords, Redis credentials, testcase keys, or server secrets in NEXT_PUBLIC variables. Local environment files and generated secret files are ignored by Git.

## 3. Start PostgreSQL and Redis, then apply migrations

With Docker installed and running:

```powershell
pnpm.cmd infra:config
pnpm.cmd infra:up
pnpm.cmd db:validate
pnpm.cmd db:generate
pnpm.cmd db:migrate
```

The development Compose file starts PostgreSQL and Redis on loopback ports 5432 and 6379. Its optional nginx gateway is not needed to use ports 3000 and 3001.

If you already run PostgreSQL/Redis elsewhere, skip infra:up and configure the actual connection URLs. Backend readiness does not require Redis while execution is disabled, but maintenance and judge workers require it.

**Existing database:** read docs/database.md before applying migrations to an unmanaged existing users table. The initial migration deliberately refuses to replace existing identities. There is no reset step in this guide. Use db:migrate to deploy reviewed migrations; do not use migrate reset or remove database volumes to solve configuration problems.

## 4. Create development login accounts

Existing active student and ADMIN credentials can be used directly. For a new development database, add your chosen private values to backend/.env:

```dotenv
DEV_STUDENT_ID=YOUR_STUDENT_ID
DEV_STUDENT_NAME=YOUR_STUDENT_NAME
DEV_STUDENT_PASSWORD=YOUR_PRIVATE_PASSWORD_WITH_AT_LEAST_12_CHARACTERS
DEV_ADMIN_EMAIL=YOUR_ADMIN_EMAIL
DEV_ADMIN_NAME=YOUR_ADMIN_NAME
DEV_ADMIN_PASSWORD=YOUR_DIFFERENT_PRIVATE_PASSWORD_WITH_AT_LEAST_12_CHARACTERS
```

Then run:

```powershell
pnpm.cmd dev:student
pnpm.cmd dev:admin-user
```

These commands persist real accounts with Argon2id hashes. Reruns preserve existing passwords, names, active states, and roles. They require NODE_ENV=development and a dev/test database; they are not production account reset commands.

- Student login uses **DEV_STUDENT_ID** and its password.
- Admin login uses **DEV_ADMIN_EMAIL** and its password.
- Creating a question owner through a seed does not create a usable administrator login; seed owners are disabled.

## 5. Run the seed files

### Dashboard and coding-workspace development seed

```powershell
pnpm.cmd db:seed
```

This runs **backend/prisma/seed.ts**, which calls **dev-seed.ts**. It creates the Round 1 assessment, four immutable question fixtures, templates/public examples, and assignments for active students.

The first seed defaults to a start one hour after the database clock. To open it immediately, set a recent UTC timestamp **before the first seed**:

```powershell
$env:DEV_ASSESSMENT_START_AT = (Get-Date).ToUniversalTime().AddMinutes(-1).ToString('yyyy-MM-ddTHH:mm:ss.fffZ')
pnpm.cmd db:seed
Remove-Item Env:DEV_ASSESSMENT_START_AT
```

A rerun does **not** move an existing start time or restore revoked assignments. Use the admin application to create a new assessment with a different schedule; published schedules cannot be edited.

**Fixture limitation:** this basic seed supports dashboard/editor/draft testing. Its placeholder toolchains and intentionally discarded testcase encryption key cannot power the real judge or confidential testcase authoring. Use the execution seed for a usable encrypted execution bank.

### Execution-enabled question-bank seed

After provisioning actual supported toolchains and preserving the private keyring:

```powershell
$env:TESTCASE_KEYRING_FILE = 'ABSOLUTE_PATH_TO_PRIVATE_KEYRING_JSON'
$env:SANDBOX_TOOLCHAIN_CATALOG = 'ABSOLUTE_PATH_TO_ACTUAL_TOOLCHAIN_CATALOG_JSON'
$env:DEV_EXECUTION_START_AT = (Get-Date).ToUniversalTime().AddMinutes(-1).ToString('yyyy-MM-ddTHH:mm:ss.fffZ')
pnpm.cmd db:seed:judge
```

This runs **backend/prisma/seed-judge.ts**, which calls **judge-seed.ts** and uses **judge-fixtures.ts**. It creates eight encrypted, versioned questions and a separate execution round whose default four-question selection has a 70-mark policy. It assigns active students and preserves existing schedules/versions on rerun.

Keep historical keys and catalog entries. Regenerating keys or rebinding a toolchain ID breaks published data and is deliberately rejected. Seed helpers such as dev-seed.ts and judge-seed.ts are imported modules; run their entry commands above rather than executing helpers individually.

### Seed and provisioning command reference

| Command             | Entry file                             | Requirements                                                                             |
| ------------------- | -------------------------------------- | ---------------------------------------------------------------------------------------- |
| pnpm dev:student    | backend/prisma/provision-student.ts    | Explicit student credentials; development database                                       |
| pnpm dev:admin-user | backend/prisma/provision-admin.ts      | Explicit admin credentials; development database                                         |
| pnpm db:seed        | backend/prisma/seed.ts                 | Migrated development database                                                            |
| pnpm db:seed:judge  | backend/prisma/seed-judge.ts           | Migrated development database, private keys, actual reviewed catalog                     |
| pnpm load:prepare   | backend/prisma/prepare-load-fixture.ts | Explicit isolated-load acknowledgment, published assessment, private fixture destination |

No seed resets or replaces production data.

## 6. Run backend, frontend, and admin

### One command for all three applications

```powershell
pnpm.cmd dev
```

### Or use three separate terminals

**Terminal 1 — backend**

```powershell
pnpm.cmd dev:backend
```

**Terminal 2 — student frontend**

```powershell
pnpm.cmd dev:frontend
```

**Terminal 3 — admin frontend**

```powershell
pnpm.cmd dev:admin
```

Open the URLs in the application table at the top. Backend endpoints use the **/api/v1** prefix.
The API base URL is not a webpage. Use **http://localhost:4000/api/v1/health/live** to check whether the backend is running.

For simultaneous student/admin use on localhost, use separate browser profiles: HTTP cookies are shared across ports. Production uses distinct student/admin hostnames with host-only cookies.

Useful checks:

```powershell
Invoke-RestMethod 'http://localhost:4000/api/v1/health/live'
Invoke-RestMethod 'http://localhost:4000/api/v1/health/ready'
```

Ready returns HTTP 503 when a required dependency is unavailable. With EXECUTION_ENABLED=false, execution/queue readiness is explicitly DISABLED.

### Admin workflow

1. Log in as a real active ADMIN.
2. Review students, eligibility, assignments, and account status.
3. Configure private question-authoring keys/catalog before editing confidential cases.
4. Create/validate/publish suitable immutable question versions.
5. Create an assessment, select versions matching the difficulty/topics/marks, set its UTC schedule, assign students/cohorts, and publish.
6. Monitor attempts and evaluation states; a stale heartbeat indicates inactivity/connectivity, not cheating.
7. View real scores/analytics, export filtered CSV, and inspect audit events.

Questions/settings authoring requires backend QUESTION_KEYRING_FILE and SANDBOX_TOOLCHAIN_CATALOG. Publish validation checks structure, encryption, examples, limits, and pinned toolchains. **It does not claim compilation/reference execution.** Runtime validation requires the real Linux gate.

## 7. Start expiry/queue maintenance and the real judge

The development applications do not start worker processes automatically.

### Maintenance worker

Copy backend/.env.maintenance.example to **backend/.env.maintenance.local** and configure DATABASE_MAINTENANCE_URL, Redis, and the same JUDGE_QUEUE_PREFIX used by the API.

```powershell
pnpm.cmd --filter @assessment/backend build
pnpm.cmd worker:maintenance
```

Use a separate terminal. This process dispatches the durable outbox, reconciles expiry, recovers accepted evaluations, enforces the grading cutoff, and settles results. It needs Redis but no sandbox connection or testcase keys.

Without this worker, an API request can still enforce an expired attempt; unattended expiry/recovery requires the running maintenance process. With no judge, accepted final evaluations cannot produce successful scores and eventually require review.

### Linux sandbox and judge setup

Real execution is supported through the separate mTLS gVisor broker, not unrestricted student child processes.

On a dedicated Linux sandbox node, provision Docker/cgroups v2/runsc, reviewed binary hashes, certificates, client fingerprints, and actual toolchain images. See backend/sandbox/README.md for the security-critical host/service instructions.

From the project root on that host:

```sh
pnpm --filter @assessment/backend build
pnpm sandbox:build
pnpm sandbox:dev-keys
# Configure backend/.env.sandbox.local from backend/.env.sandbox.example.
pnpm sandbox:broker
```

The toolchain builder writes **backend/sandbox/toolchains/catalog.local.json**. Development keys are created once at **backend/sandbox/secrets/keyring.local.json**; an existing keyring is never overwritten. Do not regenerate a keyring already used by published questions.

Configure **backend/.env.judge.local** from **backend/.env.judge.example** on the trusted judge coordinator:

- DATABASE_JUDGE_URL and its bounded pool.
- REDIS_QUEUE_URL and the same JUDGE_QUEUE_PREFIX.
- TESTCASE_KEYRING_FILE and SANDBOX_TOOLCHAIN_CATALOG.
- SANDBOX_BROKER_URL, SANDBOX_CA_FILE, SANDBOX_CERT_FILE, SANDBOX_KEY_FILE.
- PUBLIC_TESTCASE_KMS_KEY_ID, HIDDEN_TESTCASE_KMS_KEY_ID, JUDGE_DIAGNOSTICS_KMS_KEY_ID matching the loaded key IDs.
- Bounded public/hidden worker concurrency.

The current key provider is a private secret file, not a cloud KMS client. Keep admin authoring keys limited to PUBLIC/HIDDEN; diagnostic keys belong to judge workloads.

```sh
pnpm worker:judge
```

Run the maintenance worker separately. Broker, judge, and maintenance commands load their own explicit environment files and must not inherit a student API's privileged secrets.

Before enabling execution:

```sh
# Merge backend/.env.judge-gate.example into the private judge gate environment.
# Use dedicated disposable Redis and the actual Linux broker/images.
pnpm test:judge
```

The gate fails on missing prerequisites; it never substitutes fake successful execution. After the real gate and deployment review pass, set **EXECUTION_ENABLED=true**, restart the API, and verify matching healthy worker heartbeats. See docs/judge-test-gate.md.

## 8. Build and run compiled applications

Build all three:

```powershell
pnpm.cmd build
```

Then use separate terminals:

```powershell
pnpm.cmd --filter @assessment/backend start
```

```powershell
pnpm.cmd --filter @assessment/frontend start
```

```powershell
pnpm.cmd --filter @assessment/admin start
```

The frontend/admin builds prepare the standalone assets; the admin start defaults to port 3001. Local backend settings still come from backend/.env. A compiled local build is not a secure production deployment by itself.

For production, review **docs/step-5-deployment.md** and **infra/deploy/**:

- Three app Dockerfiles; backend image targets API, judge, maintenance, and DBA migration.
- Separate student API/admin API processes from the same backend source, keeping question keys/admin DB permissions off the student API.
- Dedicated judge coordinator/broker hosts, private networks, mTLS, restricted database identities.
- HTTPS ingress, Secure host-only cookies, explicit HTTPS origins, shared random CSRF key.
- Reviewed immutable image digests, database migration/adoption plan, monitoring/alerts, tested backup restoration.
- Optional DBA-reviewed **backend/prisma/runtime-grants.sql**, which is not run automatically by migrations.
- CI workflows at the repository parent **.github/workflows/**.

## 9. Run automated checks

```powershell
pnpm.cmd contracts:generate
pnpm.cmd validate
pnpm.cmd test:backend
pnpm.cmd test:frontend
pnpm.cmd test:admin
pnpm.cmd build
pnpm.cmd exec playwright install chromium
pnpm.cmd test:e2e
pnpm.cmd scaffold:smoke
```

- **validate:** workspace configuration, OpenAPI lint, Prisma schema/client generation, all TypeScript/lint checks, root SQL/contract/deployment tests.
- **test:backend:** unit and real HTTP/database integration tests, including admin, authentication, attempts, encrypted question publication, drafts, scoring, recovery, and seed behavior.
- **test:frontend / test:admin:** component/client/state tests.
- **test:e2e:** builds all three apps and runs actual desktop/mobile Chromium browser workflows with an isolated database. Keep ports 3000, 3001, 4000 free.
- **scaffold:smoke:** checks the compiled API's validation/authentication behavior using temporary test infrastructure.
- **test:judge:** separate Linux/Redis/runtime gate; normal tests do not run it.

Local SQL/browser tests use PostgreSQL via PGlite, not an external production database. Explicit sandbox transport doubles in normal tests validate orchestration/scoring/privacy; they do not prove Linux execution or native PostgreSQL concurrency.

Dependency review:

```powershell
pnpm.cmd security:audit
pnpm.cmd security:audit --prod
```

The full audit is a release gate. Development-only findings are reported rather than silently excluded. Base/toolchain Docker image scans are separate.

## 10. Capacity and production gates

The project includes a real 500-student k6 workload, private credential preparation, server metrics collection, and a full-duration expiry mode. See **docs/step-5-load-testing.md** for isolated target configuration and evidence requirements.

```sh
# Configure the documented private test environment and acknowledgments first.
pnpm load:prepare
pnpm load:metrics
pnpm load:run
```

Run metrics collection in a separate process. Record infrastructure specifications, API p50/p95/p99, errors, database connections, queue depth/age, worker CPU/memory, throughput, completion time, and the final submission spike.

**No support for 500 concurrent students is claimed without an executed workload and measured infrastructure evidence.** Real sandbox isolation, native Redis crash recovery, native PostgreSQL cross-session concurrency, Docker deployment/TLS, backup restore, and load gates require the target environment.

## 11. Troubleshooting

| Symptom                                | Check                                                                                                                         |
| -------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------- |
| Backend cannot connect                 | PostgreSQL running; matching URL/password/database; migrations applied                                                        |
| Student/admin login fails              | Correct identifier kind, real provisioned account, active flag, matching backend URL                                          |
| Admin writes return 403                | ADMIN role, ADMIN_ORIGINS exact port/host, fresh session-bound CSRF token                                                     |
| Switching between apps changes login   | Use separate browser profiles on localhost because cookies share the host                                                     |
| Dashboard has no assessment            | Provision the student before db:seed, rerun seed to assign active students, check assignment/status                           |
| Start is disabled                      | Server schedule, latest admission, account/assignment, full-duration window; changing a browser clock does not unlock an exam |
| Seed schedule does not change          | Published schedules are immutable; reruns preserve them; create a new assessment                                              |
| Question authoring returns unavailable | Real preserved encryption keys and reviewed catalog paths; basic dashboard fixtures cannot be decrypted with a new keyring    |
| Run/Submit is unavailable              | Real Linux gate, API execution flag, Redis/worker/broker configuration, fresh matching toolchain heartbeat                    |
| Final result remains pending           | Maintenance/judge availability and queue/lease health; no success is fabricated                                               |
| Admin compiled UI lacks styles         | Run the updated admin build, which copies its standalone static assets                                                        |
| E2E cannot start                       | Free ports 3000/3001/4000, install Chromium, run build; tests create their own database                                       |
| PowerShell blocks pnpm                 | Use pnpm.cmd                                                                                                                  |
| Full security audit fails              | Review the recorded advisories and upstream fixes; do not blindly force dependency upgrades                                   |

## 12. Latest verification

Final review completed on **2026-10-15**; individual check evidence was recorded on 2026-10-14 and 2026-10-15.

| Executed check                                       | Result                                                                                                 |
| ---------------------------------------------------- | ------------------------------------------------------------------------------------------------------ |
| pnpm validate                                        | Passed: configuration, OpenAPI, Prisma, TypeScript, lint, and 20 root SQL/contract/configuration tests |
| pnpm test:backend                                    | 132 passed across 24 suites; 15 historical TODOs excluded from the passing count                       |
| pnpm test:frontend                                   | 56 passed                                                                                              |
| pnpm test:admin                                      | 15 passed                                                                                              |
| pnpm build                                           | Backend, student frontend, and admin builds passed                                                     |
| Actual development provisioning/seed CLI integration | Passed; reruns preserve credentials, identities, versions, and schedules                               |
| Compiled API smoke                                   | Passed: startup, protected-route 401s, and invalid-login validation 400                                |
| Desktop/mobile Playwright workflows                  | 12 passed using the actual API and isolated database                                                   |
| Production dependency audit                          | Passed; zero advisories reported                                                                       |

The review fixed obsolete contract type references, missing execution language checks, admin standalone asset/start configuration, and a missing direct Express dependency that prevented the compiled backend from starting. It also updated outdated test fixtures to exercise the current origin and publication policies without weakening security checks.

The production dependency audit on 2026-10-15 found no advisories. The full audit gate now passes: the moderate development-tool dependency was removed, and the remaining registry finding is covered by a pinned, verified local depth-limit patch for `braces`. The raw advisory remains visible; see [the dependency review](docs/step-5-security.md) for patch verification and maintenance requirements. The current Windows workspace has no Docker, Redis server, native PostgreSQL, k6, or dedicated Linux judge host. Actual sandbox execution, native concurrency/recovery, and 500-student load are unverified.

Detailed design/history remains in docs/architecture.md, docs/database.md, docs/authentication.md, docs/execution-security.md, docs/step-4.md, and docs/step-5-security.md. API contracts are in **contracts/openapi.json**; the source inventory is **docs/folder-structure.md**.
