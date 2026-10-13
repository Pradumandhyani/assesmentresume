# Step 5 capacity test gate

No 500-student load test has been executed in this Windows workspace. Docker, native Redis,
native PostgreSQL, k6 and a dedicated Linux judge host are unavailable. There is no capacity
claim. The delivered workload rejects missing runtime/credentials and never substitutes
generated successful responses or sandbox doubles.

## Provision an isolated target

Use the same reviewed image digests, database schema, DB-role grants, TLS, Redis persistence,
toolchain catalog, private key versions and gVisor policies intended for production. Use a
**separate disposable test database and Redis namespace**, with no production student data.
Run the [real judge gate](judge-test-gate.md) first. Record kernel/runsc/Docker versions,
machine CPU/RAM/storage, database service tier/IOPS, API replica count/pools, Redis memory and
worker/broker count/concurrency. `LOAD_INFRASTRUCTURE_DESCRIPTION` is written to the evidence
inventory; an unspecified value prohibits a capacity conclusion.

Create and publish a real assessment through the admin UI with the default four questions,
2/1/1 allocation and 180-minute duration. Use the execution seed's eight reviewed questions
or provide reviewed reference solutions for every published pool version. Set its start a
few minutes in the future and the close sufficiently late for three hours of work. Published
schedules/versions are never modified by load preparation. Revoke no existing assignments.

From repository root on the target, provision credentials with the **DBA test identity**:

```sh
export NODE_ENV=development
export DATABASE_URL='postgresql://TEST_DBA:PRIVATE_PASSWORD@PRIVATE_HOST/assessment_load_test'
export LOAD_TEST_ACK=DEDICATED_DISPOSABLE_TEST_DATABASE
export LOAD_ASSESSMENT_ID=ACTUAL_PUBLISHED_ASSESSMENT_UUID
export LOAD_FIXTURE_FILE=/private/load-fixture.local.json
export LOAD_STUDENT_COUNT=500
# Optional LOAD_SOURCE_FILE=/private/reference-solutions.json (version UUID -> language -> source).
pnpm load:prepare
```

The utility generates 500 distinct private random passwords and hashes them with Argon2id.
It writes mode-0600 credentials before provisioning so an interrupted run can resume. Reruns
verify those hashes and preserve users, active states, schedules, attempts and revoked
assignments. It refuses a production NODE_ENV or a database name without `dev`/`test`.
Use a fresh assessment/fixture file for each measured run. Do not commit, upload as a CI
artifact, or paste the credential/reference fixture.

## Execute and collect measurements

Install a reviewed native k6 version on a separate load generator. The workload uses real
cookie sessions and CSRF, spreads login across 50 seconds to respect bounded Argon2 admission,
then aligns 500 authenticated starts at the scheduled opening or a common 70-second barrier.
Set `LOAD_LOGIN_SPIKE=true` separately to test login admission and recovery under overload.

```sh
export LOAD_TEST_ACK=DEDICATED_ISOLATED_LOAD_ENVIRONMENT
export LOAD_BASE_URL=https://isolated-load-students.example.org
export LOAD_BROWSER_ORIGIN=https://isolated-load-students.example.org
export LOAD_INFRASTRUCTURE_DESCRIPTION='Record CPU/RAM/IOPS, replicas, pools, runtime and digests here'
export LOAD_WORK_SECONDS=900
export LOAD_SUBMISSION_TIMEOUT_SECONDS=600
pnpm load:run
# Second full-duration run: 20% of students remain until the persisted deadline.
export LOAD_EXPIRY_MODE=true
pnpm load:run
```

Run `pnpm load:metrics` concurrently
with `DATABASE_METRICS_URL`, `REDIS_METRICS_URL`, `LOAD_ASSESSMENT_ID`, `JUDGE_QUEUE_PREFIX`,
`LOAD_METRICS_SINCE` (UTC ISO), `LOAD_SERVER_METRICS_FILE` and the isolated-target acknowledgment.
Grant the DB monitoring identity only SELECT on the listed aggregate source columns and
`pg_read_all_stats`; it needs no hashes, sessions, source, testcases or diagnostics. Grant
Redis only `LLEN`/`ZCARD` on the test queue prefixes plus connection commands; no queue writes.
The collector exits on failed probes instead of manufacturing zeroes. Protect the JSONL
evidence because aggregate operational data is private. Server metrics can also be supplied
by approved managed PostgreSQL/Redis exporters and the templates in `infra/monitoring/`.

Capture judge coordinator and broker host CPU/RAM using node_exporter/cAdvisor/managed agent;
the workload cannot measure remote machine usage. Capture all API/worker pool connections,
DB lock waits/query percentiles, disk and Redis utilization, TCP/TLS errors, restarts and
outbox lag. Client-observed queue wait ends when polling first sees RUNNING/COMPLETED, so it
is an **upper bound including poll delay**, not exact dispatch-to-worker latency. The SQL
collector measures actual accepted-to-completed percentiles and oldest pending job age.

The workload covers real dashboards/upcoming/eligibility, duplicate starts, pinned question
navigation, revisioned autosaves/refresh, concurrent public runs and hidden submissions,
idempotent submission replay, asynchronous completion, synchronized finalization, release
policy, logout, and optional full 180-minute expiry/rejected late submissions. It observes
hidden aggregate privacy without retrieving hidden cases. All final snapshots use confirmed
drafts. Browser switching/language/reconnection remain covered by the separate browser suite.

## Failure drills and interpretation

After acceptance, stop/restart a trusted judge coordinator on the **dedicated test deployment**
using its supervisor; record the exact outage time. Keep the broker/reaper independent.
Assert persisted submission IDs survive, leases recover, results are unique and outbox
recovery drains the same Redis namespace. Restart Redis with AOF retained; separately test
Redis data loss with the DB outbox recovery mechanism. These are real deployment drills;
the ordinary SQL tests' broker doubles do not establish sandbox/crash safety.

Raw k6 metrics, summary JSON, infrastructure inventory and process result are saved under
ignored `artifacts/load/<run>/`. Initial thresholds are API p95 <1 s, p99 <2.5 s, workflow
error <1%, zero hidden leaks and observed submission p95 <600 s. These are proposed acceptance
targets, not measured performance. Report p50/p95/p99 and throughput for each operation;
include accepted, rate-limited and backpressure-rejected counts separately. A passing client
threshold without machine specifications, all 500 authenticated users, server resource
measurements and a full expiry/finalization run does not certify capacity.

The workload uses [k6 Trend metrics](https://grafana.com/docs/k6/latest/javascript-api/k6-metrics/trend/)
and [thresholds](https://grafana.com/docs/k6/latest/using-k6/thresholds/) to produce measured
percentiles and fail the process on unmet criteria; syntax checks here do not execute k6.

## Pooling, concurrency and scaling

Budget `API replicas * DATABASE_POOL_MAX + ADMIN replicas/pools + judge replicas *
DATABASE_JUDGE_POOL_MAX + maintenance replicas * DATABASE_MAINTENANCE_POOL_MAX + monitoring,
migration and recovery headroom` below the DB's usable maximum connections. The admin pool
is in the API process and must be counted separately. Start from 20 student +5 admin per API,
4 per judge and 4 per maintenance; tune only from measurements. Transaction pooling/PgBouncer
must pass native PostgreSQL tests for Prisma, transaction-local timeouts and advisory locks.
Never use session locks or rely on a sticky API process.

API Argon2 work is bounded; start transactions lock server schedules/assignments. Admission
limits 4 pending evaluations per attempt, configured global public/hidden budgets, and bounded
Redis queues. Scale judge coordinators independently from brokers; total configured worker
parallelism must respect each broker's CPU/memory/slot ceiling. Keep reserved capacity for
final snapshots and graceful shutdown longer than the job budget. Scale on oldest queued
age plus CPU/memory, with a floor before scheduled exams, and never scale down active work
without draining. The full-duration run and finalization spike determine the required floor.
