# One-command localhost development

From either the Git repository root (`Assignment/`) or `assessment-platform/`:

```powershell
pnpm.cmd local:up
```

On macOS/Linux use `pnpm local:up`. Keep the terminal open. Ctrl+C stops the applications,
maintenance/judge workers, sandbox services and local database/Redis containers. From another terminal:

```powershell
pnpm.cmd local:check
pnpm.cmd local:down
```

`local:down` stops this checkout's local containers without deleting persistent volumes.
There is no automatic database reset, password reset or production connection. The default
provider remains local Docker PostgreSQL; the explicit Railway development mode below reuses
an already provisioned development database and never creates, stops or deletes cloud services.

## Start the core applications without judge setup

If the optional sandbox image build or release gate is unavailable or too expensive for the
development machine, start the real API, student/admin applications, migrations, seeds and
local Redis while explicitly skipping the judge control plane:

```powershell
pnpm.cmd local:up --skip-judge
# With the already provisioned Railway development database:
pnpm.cmd local:up --railway --skip-judge
```

This flag keeps `EXECUTION_ENABLED=false`, starts no judge coordinator, and never calls
the sandbox provisioner or real judge gate, even when `--retry-judge` is also supplied.
Existing testcase keys, pinned toolchain catalog, encrypted questions and historical gate
reports are preserved. Catalog validation and any first-time language-image preparation
required by question seeding still apply. The skip flag is per invocation; repeat it on
subsequent starts when core-only operation is intended.

Login, administration, assessment allocation, Monaco, language drafts, autosave and final
answer snapshots use the actual database. Public runs, hidden evaluations and successful
numeric grading are unavailable until a later start passes the real judge gate. Pending
final evaluations can require review; no successful verdict or pass count is invented.

Plan for **16 GB RAM or more** when building the full local judge/control-plane images
and language toolchains; this is development sizing guidance, not a production capacity
measurement. On a **6 GB machine**, use `--skip-judge` for the core applications and run
validation commands serially. Avoid running Docker image builds, backend/PGlite suites,
Next.js builds and browser tests concurrently. Stop the core stack before browser tests,
which reuse its ports. If available memory is exhausted, stop the owned build/test work
and recover the local Docker engine before retrying; increasing test deadlines does not
fix host memory pressure.

## Explicit Railway development database

Complete the Railway provisioning command described in the repository README first. It must
produce the private **`assessment-platform/.local/railway.json`** profile for the authorized
project, environment and PostgreSQL service. Then start the same applications with:

```powershell
pnpm.cmd local:up --railway
```

The selection is saved in `.local/config.json`, so subsequent `pnpm.cmd local:up` uses that
same approved Railway target. A profile existing on disk does not silently switch a Docker
checkout; the first selection must be explicit. A missing, malformed or mismatched profile
fails before connection settings are changed. An arbitrary remote `DATABASE_URL` is still
rejected by the default Docker mode. Existing credentials, keys, Docker volumes, source and
published questions are preserved when changing providers; account verification is reset
until provisioning and real login checks confirm the new target.

The profile contains a private verified-TLS `postgresql://` URL for exactly `assessment_dev`,
Railway project/environment/service IDs and an endpoint fingerprint. The shared fingerprint
binds the cloud IDs, public proxy hostname, port and database name; it excludes passwords so
an explicitly updated private profile can rotate credentials without changing the approved
target. Startup requires the runtime URL to equal the current profile URL. Public proxy TLS
uses `sslmode=verify-full`; an optional explicit CA file is retained through `sslrootcert`.
No credential URL is printed in startup/status output or the environment classification report.
Keep this ignored profile and any certificate material private; never commit them to GitHub.

Railway mode uses PostgreSQL 17 on the approved cloud development service and **local Docker
Redis**. It starts/stops/checks only Redis in the base Compose services, validates the actual
remote PostgreSQL version/schema, then runs the existing reviewed migrations, missing-account
provisioning and encrypted question/practice seeds. API, admin, maintenance and judge all use
the same approved development database. PostgreSQL sessions persist there; local Redis remains
the queue infrastructure. Docker/toolchains and the independent real gVisor gate are still
required for code execution. Railway PostgreSQL alone is not a replacement judge runtime.

Ctrl+C and `local:down` never stop, delete or reset Railway resources; cloud resource billing
continues according to the Railway project until an operator manages it separately. This mode
is for the explicitly provisioned development target and is not a production deployment path.

## One-time prerequisites

- Node >=24.12.0 <25 and pnpm >=10.34.6 <11 (the repository pins pnpm 10.34.6).
- Docker Desktop with its Linux engine and Docker Compose installed. On Windows, install/enable
  WSL2 and hardware virtualization first; OS installation may require administrator access and
  a restart. See the [official Windows installation guide](https://docs.docker.com/desktop/setup/install/windows-install/).
  Docker documents personal and educational use as free. No paid Docker plan is selected by these scripts.
- Ports 3000, 3001 and 4000 available. Existing processes on these ports are never killed.
- Internet for the first dependency/image download, then local cached dependencies/images.

Docker is looked up on PATH and at the standard all-user and per-user Windows install locations.
`local:up` can start an installed Docker Desktop; `local:check` remains read-only.
The script does not install OS features, accept subscriptions, reboot Windows or provision
Railway resources. Only explicit Railway mode connects to the approved cloud PostgreSQL target.

## What startup does

1. Acquires a per-checkout startup lock and checks Node/pnpm versions.
2. Generates missing development environment files and strong unique secrets. Any existing
   environment file changed by setup is backed up under `.local/backups/` first.
3. Checks the Docker Linux engine, Compose and application ports.
4. Installs the frozen pnpm lockfile.
5. Uses the existing `docker-compose.yml` services and `docker-compose.local.yml` development
   override to start PostgreSQL 17 and Redis 7.4, waiting for both Docker health checks. In
   Railway mode it starts/waits only for local Redis and validates the remote PostgreSQL separately.
6. Validates the Prisma schema, generates the actual client, and deploys reviewed migrations.
7. Builds actual Python 3.13/JDK 21/GCC 14 toolchain images if the local catalog is missing.
   This may take several minutes and disk space on first startup. It prepares real catalog
   metadata for encrypted question authoring; it does **not** certify student-code isolation.
8. Compiles the backend/workers. `backend`'s `build` command itself generates Prisma first,
   so direct backend builds also work from a clean generated-client directory.
9. Uses `dev:student` / `dev:admin-user` only for missing identities, verifies the saved passwords,
   and invokes the existing encrypted `db:seed:judge` seed if its fixtures are missing.
10. Checks that the preserved keyring decrypts those fixtures. Reuses an open local practice round,
    or creates a new one when the previous admission window has ended, without editing historical
    schedules. Assignments are upserted without restoring revoked assignments.
11. Attempts the separate Linux gVisor control plane and real release gate described below.
    Execution is enabled only after that gate passes; optional judge failure leaves the other apps usable.
12. Prepares Monaco and compiled Next.js standalone assets, cached by source/configuration hashes.
    Starts the API, maintenance worker and both compiled frontends on loopback interfaces.
    Restart `local:up` after source changes to rebuild changed frontends; `pnpm dev` remains available for hot reload.
13. Waits for health and runs actual database/Redis, frontend proxy, login/CSRF/role/logout, and
    maintenance-worker checks. It prints ready URLs only after those checks pass.

The Compose project name is isolated per checkout (`assessment-local-<path hash>`). Local PostgreSQL
and Redis use named persistent volumes in that project. Existing deployments/projects are not
adopted or stopped. The infrastructure ports default to 5432/6379; on the first configuration an
available alternative is chosen if occupied, then persisted in `.env`. Both host-run applications
use loopback plus those ports. Container health checks use their own internal ports. No API
container is configured to contact another container via `127.0.0.1`.

The supervisor avoids duplicate starts, writes private process/log status under `.local/`, and
uses authenticated parent-child IPC for graceful Windows shutdown. Children also shut down when
the supervisor's IPC channel disconnects. A forcibly terminated supervisor can leave Docker
containers running; `local:down` stops this checkout's containers on the next invocation.

## URLs and credentials

| Service        | URL                                       |
| -------------- | ----------------------------------------- |
| Student        | http://localhost:3000/login               |
| Administration | http://localhost:3001/login               |
| Backend API    | http://localhost:4000/api/v1              |
| Liveness       | http://localhost:4000/api/v1/health/live  |
| Readiness      | http://localhost:4000/api/v1/health/ready |

Credentials are in **`assessment-platform/.local/credentials.json`**. Passwords are never printed.
`provisioned` and each account's `verified` field describe actual database provisioning; merely
generating the file does not create accounts. Existing identities/passwords are preserved. If an
existing account has a different password, the report flags it instead of resetting it.

Use separate browser profiles (or a private window) for student and admin: cookies are shared
between localhost ports in the existing authentication architecture. Both retain real authentication
and CSRF checks. Browser API calls stay same-origin through Next's `/api/v1` rewrite.

## Environment classification

`.local/environment-report.json` lists configured names and categories without values. Local `.env`
files, backups, credentials, logs, private keyrings and generated catalogs are Git-ignored; `.local/`
is also excluded from Docker build contexts and formatting. `local:configure` generates configuration
without Docker or any database access, which is useful while installing the prerequisites.

| Category                             | Settings and actual requirements                                                                                                                                                                                                                                                                                                                                                  |
| ------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Automatically generated              | `POSTGRES_PASSWORD`, unique student/admin passwords, persistent `CSRF_SIGNING_KEY`, AES-256 PUBLIC/HIDDEN/DIAGNOSTICS keys, checkout queue prefix. Key IDs are metadata derived from real preserved keys, not cloud KMS credentials.                                                                                                                                              |
| Database and local Redis connections | Default Docker mode generates consistent loopback PostgreSQL and Redis settings. Explicit Railway mode uses its approved private profile for `DATABASE_URL`, `ADMIN_DATABASE_URL` and `DATABASE_MAINTENANCE_URL`; Redis queue/session databases remain local DB 0/1. Local PostgreSQL settings and volumes remain preserved.                                                      |
| Existing preserved values            | Valid local database password, development account settings, CSRF secret, log/pool/rate/hash limits, unrelated settings, existing private keyrings/catalogs. Settings that prevent local operation (remote DB URLs, secure-only cookies, execution enabled without evidence) are backed up and replaced for this local mode.                                                      |
| Railway-provided                     | Default Docker mode requires none. Explicit Railway mode reads the private provisioned development profile and uses its verified PostgreSQL URL; local startup does not create or delete Railway services.                                                                                                                                                                        |
| External service credentials         | None required. No paid external judge or fake API key is configured.                                                                                                                                                                                                                                                                                                              |
| Optional development settings        | `LOG_LEVEL`, `DATABASE_POOL_MAX`, `ADMIN_DATABASE_POOL_MAX`, `SESSION_TTL_SECONDS`, `SESSION_REMEMBER_TTL_SECONDS`, `LOGIN_ACCOUNT_LIMIT`, `LOGIN_IP_LIMIT`, `LOGIN_WINDOW_SECONDS`, `TRUST_PROXY_HOPS`, `ARGON2_MEMORY_KIB`, `ARGON2_TIME_COST`, `ARGON2_PARALLELISM`, `EXECUTION_MAX_PENDING_PUBLIC`, `EXECUTION_MAX_PENDING_HIDDEN`. Existing supported defaults are retained. |
| Infrastructure/secret requirements   | Real execution requires Linux, Docker/cgroups v2, a reviewed `runsc` binary/hash/runtime, pinned toolchains, mTLS certificates/CA/client fingerprints and the real judge gate. Missing historical encryption keys must be restored, never regenerated over encrypted data.                                                                                                        |

The API validator requires database/Redis URLs, browser origins, `JUDGE_QUEUE_PREFIX`, and
`PUBLIC_TESTCASE_KMS_KEY_ID`, even when execution is off. `ADMIN_DATABASE_URL` is optional in
development (the service otherwise falls back to `DATABASE_URL`); local setup explicitly uses
the same isolated database. `CSRF_SIGNING_KEY` is optional in development but generated persistently
to keep authentication stable across restarts. `NODE_ENV=development`, `HOST=127.0.0.1`, `PORT=4000`,
local student/admin origins, nonsecure development cookies and `EXECUTION_ENABLED=false` are the
managed operating-mode settings. The two browser `.env.local` files use:

```dotenv
NEXT_PUBLIC_API_BASE_URL=/api/v1
BACKEND_API_URL=http://127.0.0.1:4000
```

The maintenance worker receives its separate environment and no testcase/broker keys.
Sessions are persisted in PostgreSQL in this architecture; the separately configured Redis session
database is checked for connectivity but is not claimed to implement session storage.

## Judge availability and honest results

Configuration starts with execution disabled. The launcher attempts to provision the existing broker
and judge architecture in a separate Linux Docker-in-Docker daemon using
`docker-compose.judge.local.yml`. It installs the official pinned gVisor 20261005.0 archive,
verifies its published SHA-512 checksum, records the actual binary SHA-256, transfers the exact
toolchain image IDs, generates a private development CA/server/client certificate set, and runs
the repository's mandatory real gVisor/mTLS/Redis gate. There is no Judge0 adapter or host runner.

Only a passing gate enables the API and starts the judge coordinator plus independent sandbox
reaper. Unavailable runtimes or failed gates keep execution disabled while the other apps start.
Gate evidence is in `.local/judge/gate-report.json` and `gate.log`. A failed unchanged gate is
not repeated on every start. After addressing its blocker, stop the app and use `pnpm local:up --retry-judge`
to retry; `local:up` will use a passing record only with matching source, catalog, runtime and kernel configuration.
The broker still verifies the real runtime and toolchain versions on every start.

The daemon and broker are trusted local infrastructure; the daemon needs privileged Docker
permissions inside Docker Desktop's Linux VM. They never execute student code directly.
Every compiler/test guest uses the existing mandatory runsc flags, no network, nonroot UID,
read-only root, dropped capabilities and bounded resources. No main Docker socket enters the
broker, coordinator, gate or student guests. Only a temporary trusted image-copy helper mounts
the main socket to export the immutable toolchain images, then exits. The broker receives no
database URL, Redis URL or testcase keyring. This local profile is not a production deployment;
the dedicated-host [sandbox instructions](../backend/sandbox/README.md) remain unchanged.

With execution disabled, login, administration, question authoring with actual toolchains/keys,
assessment allocation, Monaco, language switching, draft persistence and final-answer snapshots
can be tested. Successful public runs, hidden pass counts and numeric grading cannot be demonstrated.
Final evaluations remain pending and may later require review; no successful verdict is fabricated.

## Verification and troubleshooting

`local:check` writes `.local/check-report.json` and returns a nonzero exit code if any required
service/authentication/worker check fails. A disabled judge is reported explicitly as DISABLED.
Failure details are retained privately in `.local/check-errors.json`.
Service output is in `.local/logs/{backend,frontend,admin,maintenance,judge}.log`; secrets are not printed
by the launcher. Preserve `.local/credentials.json`, `.env` files and sandbox secret files along
with database volumes. Do not delete private keyrings to solve startup errors.

The repository's separate `pnpm test:e2e` suite uses its existing disposable PGlite test database
and transport-test toolchain metadata. It verifies real browser/API/SQL behavior with execution
disabled, **not** native PostgreSQL 17, Redis, Docker, sandbox isolation or production capacity.
Stop `local:up` before running it because both use the same application ports.

If Docker is unavailable, `local:up` fails with an actionable prerequisite message after safely
generating configuration. It does not silently fall back to an in-memory database or claim that
the application is running. Once Docker is ready, the same command resumes setup using preserved files.

First setup downloads/builds several gigabytes of language and judge images; reserve at least
15 GiB on Docker's storage drive. Cached restarts reuse them. On the inspected 6 GB Windows
machine, Docker's data disk was moved intact to `D:\DockerDesktopData\disk` through a junction
at Docker's original path; the copy passed SHA-256 verification and all volumes were retained.
`C:\Users\NEW USER\.wslconfig` was created with a 2 GB WSL memory limit, 2 GB swap and
`autoMemoryReclaim=dropCache` after memory pressure stalled initial builds. No existing WSL
configuration was replaced. See [Microsoft's configuration documentation](https://learn.microsoft.com/windows/wsl/wsl-config).
Machine changes are recorded in `.local/docker-storage-relocation.json` and `.local/wsl-memory-settings.json`.
