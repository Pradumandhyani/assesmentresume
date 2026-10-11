# Step 1 validation report

Validation date: 11 October 2026 (Asia/Calcutta). Host: Windows, Node 24.12.0, pnpm 10.34.6.

No live database, production credentials, migrations against an existing system, question-bank
import or actual code-execution process is used by the validation suite.

## Created artifacts

- Exactly three application packages: `frontend`, `backend`, `admin`.
- [Complete source inventory](folder-structure.md): 179 source/configuration/documentation files.
- Nine backend feature boundaries, each with module, controller/service/repository contracts,
  DTO aliases, policy contract and deferred acceptance tests.
- Strict TypeScript, Next.js App Router shells, Tailwind/shadcn configuration and Button primitives,
  TanStack Query providers, frontend React Hook Form/Zod dependency configuration.
- Prisma schema with all 18 requested models and four supporting models: pinned assessment pool,
  durable sessions, transactional outbox and operation idempotency.
- Reviewed-design new-install migration SQL and custom integrity triggers/checks/public-case view.
- OpenAPI 3.1 contract for 34 operations, generated shared TypeScript definitions and API/role docs.
- Architecture, capacity assumptions, identity adoption, authentication/CSRF, allocation, timer/race
  handling, finalization/recovery and sandbox security documentation.
- Docker Compose PostgreSQL/Redis infrastructure and optional two-origin NGINX gateway; separate
  API/judge/maintenance environment examples without real credentials.
- Exact dependency pins, frozen pnpm lockfile, targeted security overrides, validation scripts and
  repeatable compiled-API smoke check.

## Executed checks

| Check                                                                  | Result                                                                                                          |
| ---------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------- |
| `pnpm install --frozen-lockfile --offline` after dependency resolution | Passed; lockfile matches all three apps                                                                         |
| `pnpm config:check`                                                    | Passed: exactly three apps, required paths, strict TS, exact pins, loopback development ports, queue noeviction |
| `pnpm contracts:generate`                                              | Passed: 34 documented operations and browser-safe TypeScript generated                                          |
| `pnpm contracts:lint`                                                  | Passed with no warnings                                                                                         |
| `pnpm db:validate`                                                     | Passed with Prisma 7.10.0                                                                                       |
| `pnpm db:generate`                                                     | Passed; generated client into backend only; no database connection                                              |
| Prisma empty-schema migration diff                                     | Passed; SQL generated without a live connection                                                                 |
| `pnpm typecheck`                                                       | Passed for frontend, backend and admin                                                                          |
| `pnpm lint`                                                            | Passed with zero warnings for all three applications                                                            |
| `pnpm format:check`                                                    | Passed                                                                                                          |
| `pnpm test`                                                            | 14 passed: contract graph/CSRF/idempotency/rule tests plus migration tests                                      |
| `pnpm test:backend`                                                    | 6 configuration security tests passed; 27 feature tests remain `todo`                                           |
| `pnpm build`                                                           | All three production builds passed; both Next.js apps expose only the root shell and framework not-found page   |
| Repeated backend build + `pnpm scaffold:smoke`                         | Passed: compiled API starts; sampled login and student assessment routes return 404                             |
| `pnpm audit --prod`                                                    | No known vulnerabilities reported by npm at validation time                                                     |
| Original `Questions/` inventory SHA-256 comparison                     | All 20 files unchanged                                                                                          |

The custom migration runs inside **PGlite 0.5.8, PostgreSQL 18.3/WASM**, entirely in memory.
Tests verified: the existing-users guard preserves a legacy table; published parents/children are
immutable; the public-case view excludes hidden cases; invalid exam durations are refused; frozen
rules/pool/schedule cannot change; partial allocation cannot commit; a full allocation commits
once; allocation order and deadlines cannot change; source snapshots/final-submission ownership
are protected; audit history cannot be rewritten. This is not a multi-connection concurrency test.

Production build configuration disables incremental compilation while Nest clears its output
directory, preventing unchanged modules from being omitted on repeated builds. The compiled
startup smoke check exercised that fix.

The initial production dependency audit identified two high and two moderate transitive advisories.
Targeted workspace overrides select patched deepmerge-ts 8.0.0, mysql2 3.23.1 and js-yaml 5.4.1.
Prisma validate/generate, the complete TypeScript/build checks and a subsequent clean production
audit passed with those overrides. Retest before removing or updating them. Upstream references:
[deepmerge-ts release](https://github.com/RebeccaStevens/deepmerge-ts/releases/tag/v8.0.0),
[mysql2 release](https://github.com/sidorares/node-mysql2/releases/tag/v3.23.1),
[js-yaml release](https://github.com/nodeca/js-yaml/releases/tag/5.4.1).

## Unresolved verification and later-step gates

1. **Docker is not installed on this host.** YAML and semantic development-infrastructure checks
   passed; `docker compose config`, image pulls, PostgreSQL 17.11/Redis 7.4.8/NGINX 1.30.5 startup
   and NGINX runtime syntax were not executed. Run the README Docker checks on a Docker-equipped
   host. Image tags follow official image sources; production must pin reviewed digests.
2. **No existing identity schema was available.** Existing-user authentication compatibility
   requires read-only introspection, exact mappings and reviewed additive adoption migrations.
   The create-users migration is for empty installations only; no production data was altered.
3. **Native PostgreSQL 17 and concurrency remain unverified.** Repeat SQL tests on the selected
   production major, using independent connections and row-lock/serialization races. PGlite
   validates actual SQL/trigger behavior but does not establish production concurrency semantics.
4. **500 concurrent students is a designed target, not a measured claim.** Three-hour load,
   synchronized admission/expiry, autosave, reconnect, queue recovery and capacity tests depend
   on later implementation. Dedicated sandbox capacity must be benchmarked separately.
5. **Business behavior is intentionally deferred.** No working login, dashboard, assessment page,
   Monaco editor, judge, grading or admin workflow exists. Runtime DTO validators, auth/CSRF guards,
   central error filter, least-privilege SQL grants, KMS/mTLS integration and sandbox security tests
   must be implemented before deployment. The 27 todo tests are requirements, not passed features.

Installation may report deprecated upstream development/queue subdependencies (`glob`, `inflight`,
`cron-parser`) and skipped telemetry/optional accelerator install scripts. They were not enabled
to produce fake functionality; the audited production dependency graph is clean as recorded above.
