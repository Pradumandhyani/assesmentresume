# Local implementation and verification - 2026-10-16

The native stack runs on this Windows machine: PostgreSQL 17, Redis, API, both compiled Next.js
frontends, maintenance/judge workers and the mTLS gVisor sandbox. The mandatory real judge gate
passed all 16 checks before execution was enabled. No Railway service, production database,
public website, DNS, subscription or payment was changed.

## Commands and addresses

From `Assignment/` or `assessment-platform/`, keep this command running:

```powershell
pnpm.cmd local:up
```

Use `pnpm local:up` on macOS/Linux. `pnpm.cmd local:check` verifies services and authentication;
`pnpm.cmd local:down` stops this checkout without deleting volumes. See the
[local guide](local-development.md) for prerequisites and environment classification.

| Service       | Address / status                                                                   |
| ------------- | ---------------------------------------------------------------------------------- |
| Student       | http://localhost:3000/login - running                                              |
| Administrator | http://localhost:3001/login - running                                              |
| Backend       | http://localhost:4000/api/v1 - running                                             |
| Liveness      | http://localhost:4000/api/v1/health/live - healthy                                 |
| Readiness     | http://localhost:4000/api/v1/health/ready - healthy                                |
| PostgreSQL    | Native version 17, 5 migrations applied, persistent Docker volume                  |
| Redis         | Queue DB 0 and configured session DB 1 both return PONG                            |
| Maintenance   | Actual BullMQ worker available                                                     |
| Judge         | Coordinator heartbeat and authenticated broker health available; execution enabled |

Login credentials are in **`assessment-platform/.local/credentials.json`**. Both demonstration
accounts are provisioned and their passwords verified without resetting existing accounts.
Use separate browser profiles/private windows for simultaneous student/admin sessions because
localhost ports share cookies. Sessions use PostgreSQL; Redis DB 1 is configured and checked
but is not claimed to store sessions.

## Exact verification record

| Command / check                       | Result                                                                                                                                                                                    |
| ------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Frozen installation                   | Passed; lockfile unchanged                                                                                                                                                                |
| Prisma validate/generate/migrate      | Passed against native PG17; actual generated client matches imports; no reset                                                                                                             |
| Backend build                         | Passed on Windows and inside Linux control image; generation precedes Nest compilation                                                                                                    |
| Student/admin production builds       | Both passed, including actual Monaco and standalone assets                                                                                                                                |
| Typecheck and application lint        | Passed across all packages in the implementation run                                                                                                                                      |
| Configuration check                   | Passed: three applications, 69 API contracts                                                                                                                                              |
| `pnpm.cmd test`                       | 36 passed, including 9 local configuration/cancellation/shutdown/output-parsing tests                                                                                                     |
| Backend full suite                    | Earlier run: 24 suites, 132 passed, 15 pre-existing TODOs                                                                                                                                 |
| New local-seed integration            | Passed with existing PGlite harness: idempotence, encrypted fixture/schedule/assignment preservation, lost-key rejection                                                                  |
| Judge security unit suite after fixes | 8 passed, including nonzero HotSpot stdout OOM classification; targeted ESLint passed                                                                                                     |
| Student unit tests                    | 56 passed across 6 files                                                                                                                                                                  |
| Admin unit tests                      | 15 passed across 3 files                                                                                                                                                                  |
| Existing Playwright                   | 12 desktop/mobile Chromium tests passed using disposable PGlite and execution-disabled test transport                                                                                     |
| Mandatory real judge gate             | **16 passed, 0 failed**, 285.469 seconds; PASS at 2026-10-16T08:39:46.374Z                                                                                                                |
| Native `local:check`                  | **14 passed, 0 failed**, including real CSRF/login/role/dashboard/logout through both Next proxies                                                                                        |
| Duplicate `local:up`                  | Passed: exits successfully without duplicate process launches                                                                                                                             |
| Native browser workflow               | Admin suite 2/2 passed (3.4 minutes); separate workspace suite 1/1 passed (22.8 seconds), both on the native stack                                                                        |
| Complete stop/restart persistence     | PASS: all five app/worker processes and five infrastructure containers stopped; all 16 table counts, password hashes, credentials, keyrings and immutable catalog preserved after restart |

Existing application SQL/API/browser suites use disposable PGlite (PostgreSQL 18.3/WASM) and
test-only transport metadata where applicable. The real judge gate uses actual Redis, mTLS,
broker and gVisor guests with its existing disposable PGlite SQL context. Separate native browser
checks use running PostgreSQL 17/Redis/API/frontends/judge without substituted execution results.
Native browser checks verified Python/Java/C++ public runs as ACCEPTED (1/1 each),
aggregate hidden feedback 1/1 without private-input disclosure, and real final grading COMPLETE
with 70/70 points. Admin question publishing, assessment creation/assignment, monitoring,
student/question/submission/result APIs and CSV reports passed. Student Monaco, language/question
switching, saved drafts, refresh/offline recovery, timer updates and locked final snapshots passed.
Two earlier native authoring attempts failed because the generated test typed before a language
switch finished and then asserted visibility of Monaco's deliberately hidden accessibility element.
The corrected test waits for the selected editor and verifies the exact persisted source before execution.
These results do not measure production capacity.

Native browser commands executed against the running local stack:

```powershell
pnpm.cmd exec playwright test --config .local/native-e2e/playwright.config.mjs admin.spec.ts
pnpm.cmd exec playwright test --config .local/native-e2e/workspace.config.mjs
```

These private generated tests reuse the existing browser workflows with separate strong-password
verification accounts. A finalized workspace account needs a new assigned attempt before replaying
that workflow; the demonstration accounts were not consumed or reset. Private evidence includes
`.local/native-browser-report.json`, `native-workspace-browser-report.json`,
`native-execution-report.json`, `restart-report.json` and `check-report.json`.

An intermediate cached restart returned 13/14 checks because its Docker status probe failed while
DB/Redis/API/auth/worker checks passed. Startup stopped instead of claiming readiness. The status
probe now separates stdout JSON from stderr, waits for actual healthy container status within a
bounded interval and retains errors privately. Subsequent full restarts passed 14/14; the new
stdout/log separation test passes. Actual container health requirements were retained.

## Real judge and isolation

The profile reuses the existing broker, coordinator, toolchain catalog, encryption and queues.
A separate privileged Linux Docker-in-Docker control daemon runs inside Docker Desktop's WSL2
VM. gVisor is explicitly installed; Docker Desktop alone was not treated as gVisor.
Official gVisor 20261005.0's complete archive passed its published SHA-512 verification.
Actual runsc SHA-256:
`210b437a9cfae51e8f8c9074ed19b8b5e59477178e2e391a18117d8d6b924f7a`.
Real immutable images report Python 3.13.16, JDK 21.0.12 and GCC 14.3.0.

Each compiler/test guest retains mandatory runsc, no network, nonroot execution, read-only root,
dropped capabilities, no-new-privileges and CPU/memory/process/output bounds. No submitted code
runs on the Windows/backend host. The broker receives neither DB/Redis credentials nor testcase
keys and uses only the inner daemon socket. A temporary trusted image-copy helper alone mounts
the main Docker socket to transfer exact immutable images, then exits. An independent reaper
runs separately. No Judge0 adapter or paid external provider was introduced.

The real gate covers languages, public/hidden evaluation, grading, compilation/runtime errors,
timeouts, memory limits, malicious workload confinement and authenticated broker boundaries.
Evidence is private at `.local/judge/gate-report.json` and `gate.log`. Matching passing evidence
is reused only after source/catalog/runtime/kernel checks; the broker validates actual runtime
and toolchains every start. Retry a failed unchanged gate with `pnpm.cmd local:up --retry-judge`
after stopping the application.

Two confirmed defects were fixed without loosening limits: an initial all-zero pre-start Docker
stats sample permits one immediate fresh sample after confirming Running; other monitoring failures
remain fail-closed. Nonzero HotSpot termination with its anchored stdout OOM message is classified
as memory-limit failure. Earlier gate attempts failed; the final full rerun passed 16/16. A transport
stall coincided with an observed Windows sleep/lid event. Keep the machine awake during assessments.

## Machine changes

Initial image builds exhausted C: and exposed memory pressure on this approximately 6 GB host.
With Docker stopped, its disk was copied intact to `D:\DockerDesktopData\disk\docker_data.vhdx`.
SHA-256 equality was verified before replacing the original disk directory with a junction to D:.
Existing Docker volumes/data were retained; no reset or global prune was run. Record:
`.local/docker-storage-relocation.json`.

The previously absent `C:\Users\NEW USER\.wslconfig` was created with memory 2 GB, swap 2 GB,
and `autoMemoryReclaim=dropCache`; Docker/WSL were restarted. No existing WSL config was replaced.
Record: `.local/wsl-memory-settings.json`. Only the labelled disposable gVisor probe was removed.

Official references: [gVisor installation](https://gvisor.dev/docs/user_guide/install/),
[execution platforms](https://gvisor.dev/docs/user_guide/platforms/),
[Docker data backup](https://docs.docker.com/desktop/settings-and-maintenance/backup-and-restore/),
[WSL configuration](https://learn.microsoft.com/windows/wsl/wsl-config).

## All source files created or modified

Paths relative to `Assignment/`. No changes committed.

| File                                                               | Purpose                                                             |
| ------------------------------------------------------------------ | ------------------------------------------------------------------- |
| `package.json`                                                     | Root local command proxies                                          |
| `assessment-platform/package.json`                                 | Local commands and local seed                                       |
| `assessment-platform/backend/package.json`                         | Prisma generation before compilation                                |
| `assessment-platform/backend/Dockerfile`                           | Separate local sandbox-control build target                         |
| `assessment-platform/backend/src/config/environment.ts`            | Validated optional bind host                                        |
| `assessment-platform/backend/src/main.ts`                          | Uses validated host; local binds loopback                           |
| `assessment-platform/backend/src/workers/sandbox/docker-engine.ts` | Initial Docker stats and JVM OOM fixes                              |
| `assessment-platform/backend/src/workers/judge/security.spec.ts`   | OOM regression test                                                 |
| `assessment-platform/scripts/local.mjs`                            | Startup, provisioning, locks, health, shutdown                      |
| `assessment-platform/scripts/local/environment.mjs`                | Environment generation, backups, key preservation, DB guards        |
| `assessment-platform/scripts/local/runtime.mjs`                    | Tool discovery/Desktop start, disk guard, cancellation, supervision |
| `assessment-platform/scripts/local/service.mjs`                    | Graceful authenticated IPC shutdown                                 |
| `assessment-platform/scripts/local/check.mjs`                      | Real infrastructure/auth/worker/broker checks                       |
| `assessment-platform/scripts/local/assets.mjs`                     | Compiled frontend/Monaco cache                                      |
| `assessment-platform/scripts/local/judge.mjs`                      | Runtime, images, mTLS, gate and scoped cleanup                      |
| `assessment-platform/docker-compose.local.yml`                     | Reused PostgreSQL/Redis service overrides                           |
| `assessment-platform/docker-compose.judge.local.yml`               | Local daemon/broker/gate/reaper                                     |
| `assessment-platform/backend/sandbox/local/Dockerfile`             | Checksum-verified official gVisor archive                           |
| `assessment-platform/backend/prisma/seed-local.ts`                 | Safe idempotent practice rounds and assignment seed                 |
| `assessment-platform/test/local-startup.test.mjs`                  | Secrets/config/DB guards/IPC/cancellation tests                     |
| `assessment-platform/backend/test/local-seed.integration.spec.ts`  | Seed SQL preservation and lost-key test                             |
| `assessment-platform/frontend/next-env.d.ts`                       | Production Next build regenerated route type reference              |
| `assessment-platform/admin/next-env.d.ts`                          | Production Next build regenerated route type reference              |
| `assessment-platform/.gitignore`                                   | Private local state exclusion                                       |
| `assessment-platform/.dockerignore`                                | Private build-context exclusion                                     |
| `assessment-platform/.prettierignore`                              | Generated private file exclusion                                    |
| `assessment-platform/README.md`                                    | One-command workflow                                                |
| `assessment-platform/docs/local-development.md`                    | Usage, environment classification, limitations                      |
| `assessment-platform/docs/local-verification.md`                   | This complete verification record                                   |

Generated private Git-ignored files include `.env`, `backend/.env`, maintenance/judge worker envs,
frontend/admin `.env.local`, sandbox keyrings/catalog, and `.local/` credentials, certificates,
backups, process state, logs and verification reports. Existing encryption keys were retained.
Builds also regenerate ignored Prisma/dist/Next/Monaco outputs and browser artifacts. Temporary
Next development agent-rule files were removed after reading their guidance.

## Remaining limits

This is a localhost demonstration profile. The 6 GB host runs one public and one hidden judge
job concurrently. Docker Desktop/WSL2 and the trusted privileged inner daemon must be available.
Authentication, CSRF, immutable assessments and result-release policy remain enforced. Full
student scores stay withheld until the configured results-release time; immediate hidden aggregate
feedback requires the administrator's existing assessment option. No production capacity claim is made.
