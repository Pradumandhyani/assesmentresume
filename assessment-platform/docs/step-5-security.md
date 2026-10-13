# Step 5 security review and release checklist

Security features are implemented across server guards, database constraints, encrypted
question data and the existing isolated judge. Local HTTP/SQL/browser tests validate code
paths. They do not establish that a real gVisor host, native Redis/PostgreSQL, TLS ingress,
cloud IAM/network policies or 500-student deployment is safe; those target gates remain
required. This report contains no production secrets or student data.

## Authentication and permissions

Student/admin share Argon2id/password migration/session logic with an explicit login role.
Existing account passwords/status are preserved; there is no permissive fallback login.
Bounded password verification, account/IP database rate limits, generic invalid credentials,
server session hashes, HTTP-only secure host cookies, session rotation/revocation, exact
origin CORS and session-bound CSRF defend login/logout/admin/draft/execution writes. Admin
mutations require ADMIN_ORIGINS in addition to a genuine ADMIN identity; students cannot gain
authorization by navigating to an admin page or changing request body fields.

The student API validates ownership and deadlines on every attempt/draft/submission/result
operation. Admin routes use backend role guards and server validation; privileged reads/writes
are audited with safe metadata. Database revision checks/idempotency protect duplicate critical
writes. Disabled users have sessions revoked/version invalidated. Platform ADMIN is currently
the administrative role: there is no invented finer-grained permission UI or organization
boundary; adopt additional scoped roles before delegating partial administrative authority.

Published question text/templates/cases/limits and allocated version IDs are immutable.
Editing creates a draft/version and never mutates a student's pinned question. Hidden tests
are encrypted and accessible only to privileged question-management DB/key identities and
trusted judge logic. Hidden expected outputs never enter student sandboxes; browser responses
release aggregates only. Student DB roles cannot SELECT hidden testcase ciphertext or private
diagnostics. Admin browser hidden-case editing is deliberately privileged; treat that device
and session as sensitive, never cache/export raw hidden tests or ship them in a public preview.

## Dependency review executed 2026-10-13

Actual `pnpm audit --json` queried the npm advisory registry. Initial result was two low,
one moderate and one high advisory. The reviewed
[DOMPurify 3.4.16 release](https://github.com/cure53/DOMPurify/releases/tag/3.4.16) fixes the
two low advisories; a targeted `monaco-editor>dompurify` override and lockfile update were
installed. Post-fix full audit returned **0 low, 1 moderate, 1 high, 0 critical**, exit 1.
Actual `pnpm audit --json --prod` returned **0 advisories**, exit 0. This difference means
the remaining findings are development tooling; it is not permission to hide them or declare
the entire dependency graph secure.

| Finding                                                                                                      | Actual installed path                                                           | Status                                                                                                                                                                                                                                                        |
| ------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [GHSA-vfj7-8cjw-p6xm](https://github.com/advisories/GHSA-vfj7-8cjw-p6xm), braces stack exhaustion, high      | Next ESLint plugin → fast-glob → micromatch → braces 3.0.3                      | Official advisory affects <=3.0.3 and lists no patched version. Restrict CI to reviewed source/config and isolated runners; dependency replacement/update or formally approved scoped exception is a release requirement. Full security gate currently fails. |
| [GHSA-hp3w-g68c-fv3c](https://github.com/advisories/GHSA-hp3w-g68c-fv3c), sprintf-js precision DoS, moderate | Jest transform → Istanbul config loader → js-yaml → argparse → sprintf-js 1.0.3 | Registry lists no patched release. Treat test format/config as trusted, limit runner resources; track upstream remediation.                                                                                                                                   |

`node scripts/audit-dependencies.mjs` fails high/critical or invalid registry responses and
writes ignored raw/review artifacts under `artifacts/security/`. `--prod` records a separate
report without overwriting the full review. CI retains the full failing gate. Re-run on every
release; advisories change. Do not use `audit fix --force` or override an incompatible major
without rebuilding/testing. Runtime image SBOM/scanning and base/toolchain image CVEs are
separate required checks and were not executed without Docker.

## Deployment release requirements

- Run all builds, TypeScript, lint, SQL/HTTP/browser tests and real Linux judge gate; review
  actual native PostgreSQL concurrency/restricted-role results.
- Resolve or formally review the unpatched high developer-tool advisory; preserve complete
  scan evidence and pin trusted CI actions/images. No automatic blanket advisory suppression.
- Run the isolated 500-student and full-expiry load workloads; publish hardware/replicas/pools,
  p50/p95/p99/error/backpressure/queue/throughput/CPU/RAM evidence. Capacity remains unverified.
- Provision separate least-privilege DB/Redis/workload identities; do not reuse DBA credentials
  in runtime envs. Restrict admin key/database settings to the admin control plane process.
- Provision historical encrypted-case keys and TLS through a private secret manager, verify
  file permissions, and retain recoverable key versions separately from encrypted DB backups.
- Enforce HTTPS/secure host-only cookies, exact origin CORS/CSRF, HSTS and reviewed browser
  security headers/CSP on the actual ingress; validate proxy-hop topology and admin origin.
- Isolate broker host/no data-plane egress; mandatory runsc, no network/root/socket/secrets in
  student containers, bounded CPU/wall/memory/process/output/filesystem, independent reaper.
- Verify crash/stall/outbox/DLQ/cutoff recovery with real Redis and workers; accepted jobs and
  immutable result rows survive restart. Infrastructure uncertainty produces review, not fake
  zero scores or successful grading.
- Validate monitoring/alerts/log redaction and test encrypted backup/WAL recovery into a new
  database. Measure RPO/RTO and session/reconnect/pinned-version integrity before cutover.
- Confirm operator access review, TLS/key rotations, incident runbooks and data retention.
  Application password/session auth is not MFA/SSO; deploy those controls if policy requires.

See [deployment](step-5-deployment.md), [load gate](step-5-load-testing.md),
[execution security](execution-security.md) and [database adoption](database.md).
