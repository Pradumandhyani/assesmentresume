# Verification boundaries

Steps 2–4 have unit tests and real NestJS HTTP/Prisma integration tests against an ephemeral
PostgreSQL engine (PGlite/pg-wire). `execution.integration.spec.ts` labels its sandbox transport
double explicitly; it tests durable orchestration and confidentiality, not actual code execution.
`test/judge/` is a separate opt-in real Linux/gVisor/mTLS/Redis gate, excluded from ordinary Jest.
Missing prerequisites fail that gate. See [gate instructions](../../docs/judge-test-gate.md).
Historical TODOs remain for later, unrelated features and do not demonstrate readiness.

All tests and smoke/browser fixtures that need the current database schema use
`test/support/migrations.cjs` to apply every checked-in Prisma migration in timestamp order.
Do not copy migration names into a test: that leaves older fixtures behind when schema changes.
`test/migration.test.mjs` intentionally tests the original new-install migration by itself.
