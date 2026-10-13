# Step 4 — execution, grading and finalization

The existing three applications, student authentication/dashboard, coding workspace, immutable
versions, timers and language drafts are preserved. Step 4 adds execution questions, durable
submissions, BullMQ orchestration, a dedicated gVisor broker, scoring and result polling. Admin
management remains reserved. See [verification](step-4-validation.md) and the [Linux gate](judge-test-gate.md).

## Question bank and allocation

The additive `20261012010000_execution_lifecycle` migration adds frozen topics/tags, trusted I/O
adapters, comparison/process policies, grading/probing limits, worker heartbeats, grading deadlines
and write-once result protections. Earlier migrations, identities, credentials, published content,
drafts and schedules are untouched. Existing snapshots retain the legacy FINAL_SNAPSHOT default.
Original Step 2 fixtures retain unconfigured toolchains and cannot execute.

`db:seed:judge` requires an explicitly named development/test database, preserved private keyring
and actual toolchain catalog. It publishes eight new questions (4 Easy, 2 Medium, 2 Hard), each
with two public and four hidden cases, and a separate execution-round assessment. Easy/Medium/Hard
marks are 10/20/30; its policy is BEST_VALID with weighted partial credit and delayed hidden
feedback. Reruns preserve versions, schedules and revoked assignments; missing historical keys
fail without replacing ciphertext. Reference solutions are development test data, not production
secret questions.

Start filters the frozen allowed pool to PUBLISHED versions of active questions and any configured
allowed version topic. Crypto-random Fisher–Yates selection assigns exactly 2/1/1 without
replacement. Assessment → assignment → attempt locks, serializable retries and unique constraints
protect concurrent/idempotent starts. Four version IDs and a manifest hash commit together.
An insufficient bucket returns `422 POOL_INSUFFICIENT` with no attempt and no difficulty substitution.
Assignments survive refresh or later archival. Distinct students may receive the same set.

## Student API

All routes require the existing session and STUDENT guard. Mutations require CSRF/origin checks.
Source is limited to 64 KiB UTF-8 and Python/Java/C++; execution flags, paths, limits and network
options are rejected. Foreign resources return 404. Full schemas/error contracts are in [OpenAPI](../contracts/openapi.json).

| Endpoint                                    | Contract                                                                              |
| ------------------------------------------- | ------------------------------------------------------------------------------------- |
| `POST /api/v1/attempts/:id/run`             | `{attemptQuestionId, language, sourceCode}` + Idempotency-Key; 202 durable PUBLIC run |
| `POST /api/v1/attempts/:id/submit-solution` | Same input/key; 202 durable HIDDEN evaluation                                         |
| `GET /api/v1/submissions/:id`               | Own status, timestamps and permitted result projection                                |
| `POST /api/v1/attempts/:id/finalize`        | `{expectedStateVersion}` + Idempotency-Key; 202 freeze/replay                         |
| `GET /api/v1/results/:attemptId`            | Own completion/release status and permitted score breakdown                           |

Original `/runs`, `/submissions`, `/finalization` and nested result routes remain aliases. Keys
are 16–128 alphanumeric/underscore/hyphen characters; changed payload/key reuse returns 409.
Successful replay remains available after expiry. Unavailable/unapproved workers return
`503 EXECUTION_UNAVAILABLE`, full admission budgets return 503, and probing/concurrency limits
return 429. Defaults: four pending requests per attempt, 100 public runs/question with two-second
cooldown, 20 hidden submissions/question with 15-second cooldown. Hidden limits freeze at start.

## Acceptance, dispatch and recovery

The authoritative admission point is database `clock_timestamp()` after acquiring the attempt
lock: the request must observe IN_PROGRESS before expiresAt. Validation, admission, immutable
source, idempotency identity, audit and outbox commit together. A failed transaction accepts
nothing. The lock serializes acceptance with freezing. A commit just after expiry retains its
earlier admitted timestamp; browser time and request arrival alone never constitute acceptance.

The API has no testcase keys and does not wait for Redis or code execution. Maintenance publishes
identifier-only outbox events into separate public/hidden queues and an expiry queue. Deterministic
`judge-<uuid>-g<generation>` IDs make publish-before-ack recovery safe; Redis failure leaves the
outbox PENDING. Producer commands are bounded. A full queue defers only its own events five seconds,
so public overload cannot block hidden dispatch. FINAL jobs have higher priority and bypass
interactive admission limits while remaining subject to dispatch and grading cutoffs.

Default concurrency is 2 public and 4 hidden jobs per judge. A job claims a 35-second DB lease,
heartbeats every five seconds, and has a 120-second execution budget. Result commits check
lease/generation, lock assessment → attempt → submission and cannot overwrite terminal rows.
Three attempts with exponential backoff are allowed; exhausted jobs become INFRASTRUCTURE_FAILED
and enter an identifier-only dead-letter queue. Broker capacity delays without consuming retries.
BullMQ stall detection and periodic DB/queue reconciliation repair expired leases/missing jobs.

`EXECUTION_ENABLED` defaults false. Even when enabled, capabilities require a worker heartbeat
younger than 30 seconds matching every pinned toolchain. Workers advertise only digest-matched
broker health. Accepted snapshots remain durable when health fails.

## Isolation and private data

API, maintenance, judge orchestrator and sandbox broker are separate backend processes. The broker
alone invokes fixed Docker control commands; student source is data, never a host shell command.
Mandatory runsc sandboxes use UID/GID 10001, disabled networking, read-only root, no capabilities
or new privileges, bounded CPU/wall/memory/process/output/filesystem profiles and independent cleanup.
Compilation containers are destroyed before tests receive read-only artifacts. Each test gets
one stdin input; expected output stays in trusted worker memory. Publication-owned source wrappers
support distinct I/O contracts, including a JSON-array function example. Actual patch versions and
content-addressed images are mandatory. Missing prerequisites fail closed. See [node setup](../backend/sandbox/README.md).

AES-256-GCM envelopes authenticate version, ordinal, visibility and input/expected field. Public,
hidden and diagnostic classes use distinct random keys. The implemented provider reads a private
workload-provisioned keyring file, **not a cloud KMS API client**. Historical keys remain available
for immutable ciphertext. Existing `*_KMS_KEY_ID` names identify active keys and are checked at
judge startup; production secret-manager integration/rotation needs deployment review.

Run Code reads PUBLIC rows only and returns real input, expected/actual output, diagnostics and
available timings. SUBMIT/FINAL read HIDDEN rows only; bounded per-case logs/verdicts/timings are
encrypted in protected storage. Hidden stdout/stderr can echo stdin and are never returned, even
after release. Before release, result is null; after release (or explicit immediate policy), only
aggregate verdict/counts/score/resource totals are permitted. API repositories omit diagnostic
fields and serializers use explicit allowlists. No duplicated hidden plaintext is stored in logs.
Optional DBA-reviewed [runtime grants](../backend/prisma/runtime-grants.sql) separate identities;
they are never applied silently or treated as protection for a development superuser connection.

## Scoring and finalization

Weights/marks use exact integer cents. Partial credit floors to two decimals; all-or-nothing
requires every hidden case. Public runs contribute no marks.

| Frozen policy  | Selected result per question                                                          |
| -------------- | ------------------------------------------------------------------------------------- |
| FINAL_SNAPSHOT | The immutable final source snapshot (legacy default)                                  |
| BEST_VALID     | Highest graded explicit submission or final snapshot; latest timestamp/ID breaks ties |
| LATEST_VALID   | Latest graded explicit SUBMIT; final snapshot is fallback when none exists            |

Compilation/wrong-answer/runtime/resource verdicts are valid graded results with zero/partial
credit. Infrastructure failure is not a student wrong answer. All accepted hidden jobs must settle,
including unselected ones; uncertain infrastructure yields REQUIRES_REVIEW with null total.

Manual submission/expiry freeze four selected-language draft/starter snapshots exactly once,
set FINALIZING and block new saves/runs/submissions. Pre-freeze accepted jobs continue. The immutable
grading deadline is database freeze time plus evaluationGraceSeconds (default 1,800, configurable
30–3,600). Grace never extends student editing time. Late result commits are rejected; maintenance
marks unresolved hidden jobs failed and creates a review result. Stale workers cannot overwrite it.

A locked transaction creates one immutable AssessmentResult, selected submission IDs, exact score
breakdown and one attempt.graded audit, then sets FINALIZED. The existing UI polls real execution
and result status and displays completed/expired/review/withheld feedback. An audited workflow to
review/replace immutable review results is future work; no admin grading portal was added.

## Operations

Use [README](../README.md) for infrastructure, migration and local UI commands. Build once and run
`worker:judge`, `worker:maintenance` and `sandbox:broker` as separate supervised processes with
their own private env files. Broker/real tests require a dedicated Linux node; Windows auth/drafts
continue with execution disabled. Never put judge keys, Docker control or DB access into Next.js.

Stateless API replicas, fixed DB pools, independent bounded queues and horizontal judge nodes
support the capacity design. **500-student capacity is not certified here.** Load-test interactive
rates and the 2,000-final-job burst against the frozen processing grace before enabling production.
