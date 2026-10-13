# Step 5 deployment and operations

Deployment files are reviewable configuration, not proof that this environment runs them.
This Windows workspace has no Docker/Redis/Linux judge or production host. Image builds,
Compose runtime, TLS issuance, native PostgreSQL pooling, real judge gate, backup restore and
load gates must run on the target infrastructure before production is enabled.

## Application and execution boundaries

There remain exactly three application folders. `backend/Dockerfile` provides API, judge,
maintenance and DBA migration targets from the same backend source. Student code never runs
inside any of those images. The gVisor sandbox broker runs under the independent systemd
templates on a dedicated Linux host without database/Redis/testcase keys. Judge coordinators
reach the broker only over verified TLS 1.3 mTLS; broker certificate fingerprints and pinned
toolchain digests are allowlisted. Keep database and Redis private, deny broker egress to data
networks, and allow only the judge's private IP/workload identity to the broker port. Docker
socket control stays on that dedicated broker host and is never mounted in application images.

Use separate PostgreSQL LOGIN identities inheriting the groups in
`backend/prisma/runtime-grants.sql`: student API, privileged admin control plane, judge,
maintenance, read-only monitoring and DBA migration. Neither browser app has a DB connection.
Admin-authenticated question management is a trusted control-plane operation using a separate
DB pool and private keyring. In a combined API process, process compromise could access that
admin pool/keyring; do not describe route authorization as hardware secret isolation.
The production Compose template deploys the same backend image in separate `api`/`admin-api`
processes, omits admin DB/key settings from the student API, and routes admin origin traffic
to the admin-configured process. Shared authentication still uses the same
server-side session system and identities. Student and admin browser origins have separate
host-only cookies; admin write CSRF additionally checks ADMIN_ORIGINS.

## Build and release

Use Node 24.12+ within major 24 and pnpm 10.34.6. Install from the frozen lockfile and generate
Prisma before building. The Docker build context is `assessment-platform/`, not an individual
application directory. Builders receive no credentials and `.dockerignore` excludes local
envs, keyrings, load fixtures, logs, caches and toolchain catalogs. Override the base image
with a reviewed immutable digest and scan the resulting runtime images before promotion.

```sh
export NODE_IMAGE='node:24.12.0-bookworm-slim@sha256:APPROVED_ACTUAL_DIGEST'
docker build --build-arg NODE_IMAGE="$NODE_IMAGE" --target api -f backend/Dockerfile -t registry/assessment-api:REVIEWED_COMMIT .
docker build --build-arg NODE_IMAGE="$NODE_IMAGE" --target judge -f backend/Dockerfile -t registry/assessment-judge:REVIEWED_COMMIT .
docker build --build-arg NODE_IMAGE="$NODE_IMAGE" --target maintenance -f backend/Dockerfile -t registry/assessment-maintenance:REVIEWED_COMMIT .
docker build --build-arg NODE_IMAGE="$NODE_IMAGE" --target migrate -f backend/Dockerfile -t registry/assessment-migrate:REVIEWED_COMMIT .
docker build --build-arg NODE_IMAGE="$NODE_IMAGE" -f frontend/Dockerfile -t registry/assessment-frontend:REVIEWED_COMMIT .
docker build --build-arg NODE_IMAGE="$NODE_IMAGE" -f admin/Dockerfile -t registry/assessment-admin:REVIEWED_COMMIT .
```

Production runtime targets are nonroot UID/GID 10001, have no installation scripts/compilers
and copy only production dependencies and compiled source/standalone web output. The DBA-only
migration target retains Prisma tooling and must never use an API identity. A Dockerfile
does not pin a base digest itself; the release pipeline must supply the approved digest.
Toolchain images require their separate build/pinning/scanning process and historical catalog
retention described in [sandbox setup](../backend/sandbox/README.md).

The parent Git repository's `.github/workflows/ci.yml` runs install, config/contracts/Prisma,
TypeScript, lint, SQL/backend/frontend/browser tests, all builds, audit and Docker image
builds. It does not deploy automatically. Configure protected branches and require those
checks. The manual `linux-judge-gate.yml` only targets a dedicated labeled self-hosted runner
behind the `judge-release` environment approval. Never expose that privileged runner to
untrusted pull requests. Pin actions to reviewed commit SHAs when adopting this pipeline.
Promotion should attach image digests/SBOM/signatures, review the full dependency report,
require the Linux/load gates, apply migrations once and deploy gradually with rollback.

## Environment and secrets

Use the app env examples for development and `infra/deploy/.env.example` for deployment
paths/digests. The examples contain no real secrets and deliberately fail deployment checks.
Provision private files outside the checkout; root-owned 0600 environment files and key files
owned/readable only by container UID 10001 through your secret manager. Compose bind mounts do not automatically
correct file ownership/modes. Do not place passwords in Docker ARG, image layers, shell
history, CI artifacts or the load report. Production processes get explicit environment
variables; judge/maintenance do not auto-load the student API `.env`.

| Process                 | Required settings                                                                                                                                                                                                                                                                                                                                                                                                       |
| ----------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Student API             | `NODE_ENV=production`, `PORT`, restricted `DATABASE_URL`, `DATABASE_POOL_MAX`, `REDIS_QUEUE_URL`, `REDIS_SESSION_URL`, exact HTTPS `APP_ORIGINS`, `SESSION_SECURE=true`, `SESSION_COOKIE_NAME=__Host-assessment_session`, shared random `CSRF_SIGNING_KEY`, bounded login/hash settings, `TRUST_PROXY_HOPS` for the actual ingress topology, queue prefix/admission budgets, `EXECUTION_ENABLED=false` until gates pass |
| Admin API/control plane | Shared auth settings plus exact HTTPS `ADMIN_ORIGINS`, least-privilege `ADMIN_DATABASE_URL`, `ADMIN_DATABASE_POOL_MAX`, `QUESTION_KEYRING_FILE`, approved `SANDBOX_TOOLCHAIN_CATALOG`; mount admin question secrets only here                                                                                                                                                                                           |
| Maintenance             | `DATABASE_MAINTENANCE_URL`, its pool maximum, authenticated/TLS Redis URL, same queue prefix, outbox batch/queue ceiling and expiry reconcile interval; no testcase/broker keys                                                                                                                                                                                                                                         |
| Judge coordinator       | `DATABASE_JUDGE_URL`, small pool, bounded public/hidden concurrency, queue URL/prefix, approved toolchain catalog, verified HTTPS broker URL, CA/client cert/private key, secret-file testcase keyring, matching active public/hidden/diagnostic key IDs                                                                                                                                                                |
| Sandbox broker          | Dedicated node env example: reviewed runsc binary/hash, fixed Docker path, cgroup/seccomp, approved catalog, own server key/CA/cert, client fingerprint allowlist, bounded slot limit/private listen address                                                                                                                                                                                                            |
| Migration               | DBA-only `DATABASE_URL` with migration privileges; never use runtime credentials                                                                                                                                                                                                                                                                                                                                        |
| Browser apps            | No DB/Redis/key variables; server-only `BACKEND_API_URL` is a build-time rewrite target and runtime SSR session target (`http://api:4000` student, `http://admin-api:4000` admin); production ingress handles same-origin browser `/api/v1` routing                                                                                                                                                                     |

The implemented key provider uses a private AES keyring file, not a cloud KMS API despite
historical `*_KMS_KEY_ID` names. Keep all historical key versions backed up separately and
test decryption during restore. Rotate through the secret manager without modifying published
case ciphertext or pinned toolchains. Compromise response must rotate auth/DB/TLS secrets,
revoke sessions, investigate audit records, and preserve evidence before resuming assessments.

## Database migration and release order

Read [database adoption](database.md) before touching an existing users table. Never run
`migrate reset`, `db push --accept-data-loss`, destructive SQL or development seeds in production.
Take and verify a backup, rehearsal-restore it into a new test database, apply migrations there
using native PostgreSQL 17, review lock duration, then deploy additive migrations with the DBA
identity during an agreed window. Run the reviewed grants script and assign the NOLOGIN groups
to provisioned workload LOGIN identities without passwords in source. Existing published
versions/results remain immutable; new publication creates a distinct version.

```sh
node scripts/check-deployment.mjs /etc/assessment/deployment.env
docker compose --env-file /etc/assessment/deployment.env -f infra/deploy/docker-compose.prod.yml --profile migration run --rm migrate
docker compose --env-file /etc/assessment/deployment.env -f infra/deploy/docker-compose.prod.yml up -d --wait
```

Use `docker-compose.judge.yml` on a separate trusted worker host after its gate passes:

```sh
node scripts/check-deployment.mjs /etc/assessment/deployment.env --judge
docker compose --env-file /etc/assessment/deployment.env -f infra/deploy/docker-compose.judge.yml up -d
```

The production application Compose file does not include a judge service. Supply private
DB/Redis network routes/ACLs; Compose network names alone are not a
production firewall. Compose is an initial deployment template rather than HA orchestration.
For rolling deployment, wait on GET `/api/v1/health/ready`, drain connections, then stop old
instances. GET `/api/v1/health/live` proves process liveness; readiness probes DB and, when
enabled, Redis/fresh judge availability. Disabled execution is explicitly identified as
disabled and must not be read as a healthy execution fleet.

## HTTPS and browser deployment

`infra/deploy/Caddyfile` provides separate student/admin HTTPS origins, ACME certificate
provisioning, HSTS/security headers and same-origin API routing. Review hostname/DNS/ACME
reachability and back up Caddy's private certificate storage. Set exact origins without
paths/trailing slashes and correctly configure proxy hops; do not trust arbitrary forwarded
headers. Deny direct public API/data/Redis/broker access. Add enterprise network restrictions
or MFA/SSO at the admin ingress according to deployment policy; the current app's shared
password/session login is not an MFA implementation.

## Monitoring, backup and recovery

Use private PostgreSQL/Redis/node/container exporters plus TLS-validating readiness probes.
Prometheus/blackbox/alert templates are in `infra/monitoring/`; replace deliberate example
hostnames and provision actual exporter credentials/auth. Configure Alertmanager routing to
your operations team. Alert on readiness, API error/p95, DB connection/lock saturation,
Redis noeviction memory, old pending outbox/jobs, stale worker heartbeats, DLQ growth,
REQUIRES_REVIEW results, runtime orphan cleanup failures, TLS expiry and backup age. A missing
student heartbeat signals stale connectivity, not cheating.

Enable/review the [PostgreSQL settings collector](https://github.com/prometheus-community/postgres_exporter)
for max-connection metrics and the [Redis exporter's memory ceiling metric](https://github.com/oliver006/redis_exporter)
for bounded queue-memory alerts. Validate rules with `promtool check rules` and test actual
scrape labels/metric availability before relying on them. Exporters/Prometheus were not run here.

SQL/load metrics collector evidence is described in [load testing](step-5-load-testing.md).
Initial external infrastructure alerts include DB connections >80%, Redis memory >80%,
judge memory >85% and CPU >90% over sustained windows. Tune from measured baseline; queue
age and finalization deadlines are the decisive service signals, not CPU alone. Structured
JSON logs use request/event/entity IDs and redact credentials/cookies/code/test data; ship
over TLS to retained access-controlled storage and alert on safe error codes.

Use managed PostgreSQL continuous WAL/PITR with encrypted offsite retention. Suggested initial
objectives are RPO 5 minutes/RTO 1 hour, requiring rehearsal measurements rather than a claim.
`infra/backup/backup.sh` creates a protected logical custom-format dump/checksum using private
libpq service/pass files. It does not replace WAL backups. `restore-test.sh` creates only a
new `_restore_test` database, refuses replacing existing databases, verifies the checksum,
restores and checks aggregate row counts. Restore encrypted backups and historical keyring
versions separately; reapply runtime role grants, rebuild approved images/catalog and test
login/resume/pinned assignments/CAS drafts/accepted queues/exactly-once scoring. Restore Redis
AOF where available and reconcile outbox/leases without deleting accepted source snapshots.
Document recovery timestamps, RPO/RTO and evidence. No backup or restore has run here.

Autoscaling/pool budget guidance and the required 500-student report are in the load document.
Keep a pre-exam capacity floor and drain workers gracefully before scale-down; do not shrink
brokers while their slots are executing. Maintain independent broker supervision/reaper.
