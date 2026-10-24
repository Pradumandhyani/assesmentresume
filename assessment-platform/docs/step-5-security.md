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

## Dependency review executed 2026-10-24

The GitHub Actions failure was reproduced with the real npm registry: **3 critical, 5 high,
2 moderate and 3 low** advisories. The gate correctly rejected that dependency tree.
The audit script and high/critical rejection policy were not weakened.

| Package / path                                         | Previous version | Reviewed replacement | Advisory references                                                                                                                                                                                                                                                                                   |
| ------------------------------------------------------ | ---------------- | -------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Student/admin Next.js and matching Next ESLint plugins | 16.4.0           | 16.4.3               | [Image API RCE](https://github.com/advisories/GHSA-2464-fhr4-w9xw), [cache RCE](https://github.com/advisories/GHSA-673q-mjm6-r5xr), [Server Actions DoS](https://github.com/advisories/GHSA-p3m5-59mp-jv5r)                                                                                           |
| All three applications' Zod                            | 4.6.5            | 4.6.7                | [Collection validation resource exhaustion](https://github.com/advisories/GHSA-mrhx-c7xc-m3w5)                                                                                                                                                                                                        |
| `monaco-editor > dompurify`                            | 3.4.16           | 3.4.17               | [Template/shadow content bypass](https://github.com/advisories/GHSA-cg2g-xh64-v4q7), [detached subtree handlers](https://github.com/advisories/GHSA-mrv2-3pqr-j5jr), [SMIL attribute guard](https://github.com/advisories/GHSA-c6gr-qvv4-5v3f)                                                        |
| `express > body-parser`                                | 2.3.0            | 2.4.0                | [Compressed request-body DoS](https://github.com/advisories/GHSA-27r3-jxmh-p828)                                                                                                                                                                                                                      |
| `@nestjs/platform-express > multer`                    | 2.4.0            | 2.5.0                | [Asynchronous file-filter DoS](https://github.com/advisories/GHSA-q7qp-rjg7-q26m)                                                                                                                                                                                                                     |
| `ajv > fast-uri`                                       | 3.1.8            | 3.1.9                | [Scheme decoding](https://github.com/advisories/GHSA-w74x-v6f9-j3xg), [path equivalence](https://github.com/advisories/GHSA-xhq7-xmqj-769h), [host canonicalization](https://github.com/advisories/GHSA-wjr9-j795-jxcr), [suffix scheme injection](https://github.com/advisories/GHSA-333x-w4r6-6crp) |

Direct dependencies remain pinned; scoped overrides update the transitive paths without a
framework-major upgrade. The lockfile was regenerated and an offline frozen installation
passed. Both `node scripts/audit-dependencies.mjs` and its `--prod` variant returned **zero
advisories in every severity**, `deployGatePassed: true`, and exit code 0. Raw reports remain
in ignored `artifacts/security/`. This is dated npm evidence, not a permanent audit guarantee.

### Browser bundle verification

Monaco 0.57.0 additionally embeds DOMPurify **3.4.15** in its precompiled AMD editor bundle.
Updating only pnpm's resolved DOMPurify package leaves those served bytes unchanged.
`scripts/monaco-security.mjs` therefore verifies the original editor bundle's independent
SHA-256, removes its old sanitizer factory and adds an AMD dependency on the resolved
DOMPurify 3.4.17 distribution. `prepare-monaco.mjs` copies that distribution into the same-origin
public assets. It retains the existing guarded Safari clipboard fix.

Tests prepare the real assets, verify the AMD dependency/factory wiring, load the actual
patched sanitizer against a DOM, check unsafe script/event-handler removal and reject altered
or already patched upstream artifacts. A dependency upgrade that changes the reviewed bundle
must be reviewed explicitly; preparation fails closed. The security audit now runs immediately
after the frozen CI installation so a newly vulnerable tree fails before expensive builds.
Deploy the rebuilt student assets with the application release. If a separate CDN caches
`/monaco/`, invalidate that cache and require a page reload so old open clients do not retain
the previous editor bundle.

## Earlier dependency review: 2026-10-15

Actual `pnpm audit --json` queried the npm advisory registry. Initial result was two low,
one moderate and one high advisory. The reviewed
[DOMPurify 3.4.16 release](https://github.com/cure53/DOMPurify/releases/tag/3.4.16) fixes the
two low advisories; a targeted `monaco-editor>dompurify` override and lockfile update were
installed. That initial full audit returned **0 low, 1 moderate, 1 high, 0 critical**, exit 1.
The current remediation removes the moderate dependency and applies a local patch for the
high advisory because the registry lists no patched upstream release.

| Finding                                                                                                      | Actual installed path                                                           | Status                                                                                                                                                                |
| ------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [GHSA-vfj7-8cjw-p6xm](https://github.com/advisories/GHSA-vfj7-8cjw-p6xm), braces stack exhaustion, high      | Next ESLint and Jest → micromatch → braces 3.0.3                                | Remediated locally by `patches/braces@3.0.3.patch`. Parsing and recursive AST walkers enforce a depth limit of 128. The registry finding remains in the full report.  |
| [GHSA-hp3w-g68c-fv3c](https://github.com/advisories/GHSA-hp3w-g68c-fv3c), sprintf-js precision DoS, moderate | Jest transform → Istanbul config loader → js-yaml → argparse → sprintf-js 1.0.3 | Removed by a scoped `@istanbuljs/load-nyc-config>js-yaml` override to 4.3.2, which uses argparse 2 without sprintf-js. The loader's YAML configuration API is tested. |

`node scripts/audit-dependencies.mjs` now exits 0 with **0 unresolved advisories**. Its
unmodified registry report still contains **1 high** finding for braces 3.0.3; the review
records that finding separately from the verified local remediation. Before crediting this
one exact advisory/version, the gate verifies the patch SHA-256 against an independent pin,
workspace configuration, every braces lockfile snapshot, and installed code reached through
all three applications. Behavioral checks reject deeply nested braces, parentheses, and
caller-supplied ASTs while preserving normal glob compilation and expansion. A changed or
missing patch, failed behavioral check, another affected version, or any other high/critical
advisory still blocks deployment. The patch uses LF line endings for reproducible hashes.

Actual `node scripts/audit-dependencies.mjs --prod` returned **0 advisories**, exit 0.
Raw/review artifacts are written under ignored `artifacts/security/`; `--prod` records a
separate report. Re-run on every release and replace the local patch with an official fix
when available, removing its corresponding verifier only after a clean full audit. Do not
use `audit fix --force` or blanket advisory suppression. Runtime image SBOM/scanning and
base/toolchain image CVEs are separate required checks and were not executed without Docker.

## Deployment release requirements

- Run all builds, TypeScript, lint, SQL/HTTP/browser tests and real Linux judge gate; review
  actual native PostgreSQL concurrency/restricted-role results.
- Maintain and verify the local braces patch until an upstream fix replaces it; preserve
  complete scan evidence and pin trusted CI actions/images. No blanket advisory suppression.
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
