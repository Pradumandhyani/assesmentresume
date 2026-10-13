# Step 4 verification and changed files

Validated on 2026-10-12 with Node 24.12.0 and pnpm 10.34.6 on Windows. Earlier application structure,
authentication, workspace and migrations remain preserved; no production database was contacted.

## Results

| Check                                   | Outcome                                                                                                         |
| --------------------------------------- | --------------------------------------------------------------------------------------------------------------- |
| Configuration                           | Exactly three application packages; strict TypeScript and pinned dependencies                                   |
| OpenAPI generation/lint                 | 51 operations; implemented/reserved routes distinguished                                                        |
| Prisma validation/generation            | Valid additive schema; regenerated client                                                                       |
| TypeScript / ESLint                     | All three applications and test configuration pass                                                              |
| Root SQL/contract checks                | 15 pass, including Step 4 migration and data-class database grants                                              |
| Backend Jest                            | 90 distinct tests pass, including 17 Step 4 HTTP/SQL lifecycle cases; 15 historical TODOs excluded              |
| Frontend Vitest                         | 56 pass, including submission states, unconfirmed retries, refresh/language separation and feedback projections |
| Production builds                       | NestJS backend, student Next.js standalone and unchanged admin scaffold pass                                    |
| Playwright                              | 8 pass on desktop and iPhone-emulated Chromium, using real API/draft persistence                                |
| Compiled API smoke                      | Protected routes reject unauthenticated access (401); login validates input (400)                               |
| Real Linux judge / Redis / image builds | **Not run**; implemented opt-in release gate, no available Linux/Docker/Redis host                              |
| Native PostgreSQL 17 / 500 students     | **Not run**; deployment concurrency/load gates remain required                                                  |

Backend and browser tests use PostgreSQL 18.3 via PGlite/pg-wire with real Prisma persistence,
all four migrations, real NestJS HTTP, cookies and CSRF. PGlite serializes a single database
connection; concurrent HTTP assertions do not prove native cross-session lock behavior.
Step 4 judge tests explicitly use `ContractBroker`, a test-only transport double. It is never
imported by application entrypoints and never substitutes for the real broker. Mock transport
results verify scoring/orchestration/confidentiality, not compilation or isolation.

Coverage includes exact difficulty allocation, insufficient topic pool, duplicate accepts and
changed-key conflicts, ownership, unsupported options, hidden-input echo projection, cooldowns,
expired leases, bounded infrastructure retries, compiler verdict handling, concurrent claims,
outbox rollback/retry, full-queue isolation, weighted best/latest scoring, accepted pre-freeze jobs,
finalization races, grading cutoff review and late-worker fencing. Role tests deny API access to
test cases/diagnostics and worker access to hashes; permitted API endpoints also run under the
constrained database role.

Browser coverage preserves earlier login/dashboard/editor workflows, separate Python/Java drafts,
Q1 → Q4 → Q1 navigation, refresh, network interruption, acknowledged saves and immutable final
snapshots. Execution is deliberately disabled in this environment; these eight browser tests do
not claim real judge execution. The finalization transport interception now targets `/finalize`.
Snapshots/screenshots are available under ignored `artifacts/`.

Known non-failing test-runtime notices are Node's experimental VM modules, pg/PGlite's query
serialization deprecation notice, and temporary proxy connection refusals while local test
servers start. Production builds and final assertions pass. Do not treat these test notices as
native PostgreSQL deployment validation.

## Files created

- `backend/prisma/migrations/20261012010000_execution_lifecycle/migration.sql`, `runtime-grants.sql`
- `backend/prisma/judge-fixtures.ts`, `judge-seed.ts`, `seed-judge.ts`
- `backend/src/modules/execution/grading.ts`, `execution-availability.ts`
- `backend/src/modules/submissions/dto/create-submission.dto.ts`
- `backend/src/queues/execution-queues.ts`
- `backend/src/workers/worker-context.ts`
- `backend/src/workers/judge/main.ts`, `judge-service.ts`, `testcase-crypto.ts`, `source-adapter.ts`, `security.spec.ts`
- `backend/src/workers/outbox/main.ts`, `outbox-dispatcher.ts`, `grading-cutoff.ts`
- `backend/src/workers/sandbox/broker.ts`, `broker-client.ts`, `docker-engine.ts`, `protocol.ts`, `toolchain-catalog.ts`, `reaper.ts`
- `backend/sandbox/README.md`, `toolchains/Dockerfile`, `toolchains/catalog.example.json`
- `backend/.env.sandbox.example`, `.env.judge-gate.example`, `jest.judge.config.cjs`
- `backend/test/execution.integration.spec.ts`, `support/step4-context.ts`, `support/contract-broker.ts`
- `backend/test/judge/real-judge.spec.ts`, `crash-worker.cjs`
- `frontend/features/attempts/use-execution.ts`, `frontend/test/execution.test.tsx`
- `scripts/build-toolchains.mjs`, `create-development-judge-keyring.mjs`
- `infra/systemd/assessment-sandbox.service`, `assessment-sandbox-reaper.service`, `assessment-sandbox-reaper.timer`
- `test/step4-permissions.test.mjs`, `docs/step-4.md`, `step-4-validation.md`, `judge-test-gate.md`

## Files updated

- `backend/prisma/schema.prisma`: additive policies, version metadata, deadlines and heartbeats
- Attempts controller/service/module: topic filtering, frozen policy, canonical finalize alias and capability checks
- Submissions controller/service/repository/module: durable acceptance, ownership, limits and safe status projections
- Results controller/service/repository/module: write-once grading, release/ownership projections and compatibility aliases
- Execution/submissions/results feature specs: replace their deferred criteria with focused working tests
- Backend environment/worker-environment configuration, queue contracts and worker/test README files
- Frontend workspace, editor, execution panel, typed API adapter and logout storage cleanup
- Backend/root package scripts, Jest configuration and `.gitignore`; dependency versions/lockfile retained
- OpenAPI generator, JSON and generated TypeScript contracts; root response allowlist checks
- Existing integration/browser bootstrap and API smoke migration lists; browser canonical finalize interception
- README, architecture/database/security documents and generated source inventory

Admin management, authentication business logic and original assessment pages were not redesigned.
The sibling original question/spreadsheet assets were not imported or changed.

## Run verification

```sh
pnpm contracts:generate
pnpm validate
pnpm test:backend
pnpm test:frontend
pnpm build
pnpm test:e2e
pnpm scaffold:smoke
```

The separate `pnpm test:judge` requires the [dedicated Linux gate configuration](judge-test-gate.md).
Docker Compose validation, systemd-unit activation, runtime/image execution and real Redis recovery
cannot be executed on this Windows host. Execution remains disabled until these gates succeed.
Review-result remediation and cloud KMS integration require future audited deployment work;
immutable results are not silently overwritten and no complete admin portal is included.
