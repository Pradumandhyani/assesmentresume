# Step 4 real judge release gate

**Not run in this workspace.** The Windows host has no Docker, Linux runtime, Redis server or
available remote judge host. The user explicitly requested implementation and documentation
of this gate. Unit/HTTP/PostgreSQL tests use an explicit sandbox transport double and do not
prove isolation, compiler compatibility, native Redis recovery or 500-student capacity.

Keep `EXECUTION_ENABLED=false` until this gate and deployment review succeed. This is a separate
opt-in suite, excluded from ordinary backend tests. Missing prerequisites fail the suite;
there is no successful mock fallback or silent skip.

1. Provision a disposable **dedicated Linux sandbox node**, cgroups v2, Docker and reviewed
   runsc/toolchains using [sandbox instructions](../backend/sandbox/README.md). Start the real
   mTLS broker locally; enable supervision and independent cleanup. No other assessment jobs
   should run on this gate node, because cleanup assertions inspect all labelled sandboxes.
2. Provision a disposable Redis service/database; never point the gate at production Redis.
   Each run uses a random BullMQ prefix and deletes only that prefix on completion. Use AOF,
   noeviction and authenticated/TLS transport in deployed queues. Native PostgreSQL 17 tests
   must use a separate disposable database; this suite uses ephemeral PGlite for its API data.
3. Create private `backend/.env.judge.local` from `.env.judge.example`, merging the settings in
   `.env.judge-gate.example`. Set `JUDGE_GATE_ACK=DEDICATED_DISPOSABLE_LINUX`, the separate
   `JUDGE_GATE_REDIS_URL`, reviewed runsc path/hash, actual toolchain catalog, and mTLS client
   secrets. Generate a development keyring with `pnpm sandbox:dev-keys` or provide test-only
   workload secrets. Do not rotate away keys used by existing published development fixtures.
4. From repository root run:

   ```sh
   pnpm db:generate
   pnpm typecheck
   pnpm test:judge
   ```

The suite verifies real Python/Java/C++ compilation and execution, bounded compilation errors,
runtime errors, CPU/wall termination, memory/output limits, guest fork limits, nonroot execution,
read-only root/artifacts, missing secrets/socket, denied outbound networking and complete cleanup.
All eight Python reference solutions exercise their question-specific I/O adapters. Actual
JudgeService execution persists private results through the API test database, including malicious
hidden-input echo. A public run traverses real HTTP → transactional outbox → Redis → actual judge
and mTLS sandbox → persisted result polling. Real Redis also checks deterministic IDs, three attempts and recovery after a
trusted worker helper process dies while holding a BullMQ lock.

Before enabling production, additionally record:

- Native PostgreSQL 17 concurrent starts, duplicate submissions, row-lock timing, serializable
  retries and finalization/deadline races across API replicas. PGlite's single pg-wire connection
  proves SQL behavior but cannot prove independent-session concurrency.
- Database role tests using reviewed `backend/prisma/runtime-grants.sql`: API must fail to SELECT
  `test_cases` and private diagnostics. Runtime users cannot be table owners or inherited
  migration/superuser members. Review existing PUBLIC grants; group revokes cannot remove
  privileges inherited from another role. No production identity/schema reset is authorized.
- Independent security review: malicious compilation/includes, symlinks, IPv6/DNS/metadata,
  cross-job residue, TLS rejection, cancellation, broker kill/restart, and cleanup after node
  failures. A passing regression suite is not a sandbox escape proof.
- A 500-student load run with realistic public/hidden rates and a simultaneous 2,000-final-job
  burst. Measure API p95/p99, database pool/lock waits, queue age, sandbox CPU/RAM and completion
  before `evaluationGraceSeconds`. Tune workers/nodes and admission budgets from measurements.
- Preserve a gate report with kernel/Docker/runsc hashes, image digests/patch versions, policies,
  test outcomes and cleanup evidence. Re-run for every runtime/image/security-policy update.

Runtime resource interpretation follows [gVisor's resource model](https://gvisor.dev/docs/architecture_guide/resources/).
Queue recovery follows [BullMQ stalled jobs](https://docs.bullmq.io/guide/jobs/stalled) and
[retry configuration](https://docs.bullmq.io/guide/retrying-failing-jobs).
