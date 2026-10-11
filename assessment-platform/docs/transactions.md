# Transactions, deadlines and recovery

## Authority and lock order

PostgreSQL controls schedules, ownership, attempt state, versions and time. Use `timestamptz(3)`
for all persisted dates and UTC for database/server serialization. Browser timestamps and
remaining-seconds values are display-only. `CURRENT_TIMESTAMP` is fixed at transaction start;
use **`clock_timestamp()` after lock acquisition** for deadline acceptance so a request waiting
on a lock does not gain extra time.

Use this lock order: assessment → assignment when starting → attempt → attempt questions by
position → drafts → submissions. Concurrent student mutations and finalization lock the same
attempt row. Lock deadlines and set SQL statement/lock timeouts; retry deadlocks/serialization
failures with bounded jitter. Never perform Redis, KMS, sandbox or network calls while holding a
transaction lock. Ordinary immutable reads use READ COMMITTED; starts/publication/cancellation
use SERIALIZABLE plus explicit row locks. DB constraints remain the last line of integrity.

## Transaction boundaries

| Operation         | Atomic writes / acceptance condition                                                                                                                 |
| ----------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------- |
| Login/rehash      | Credential compare-and-swap if needed, new hashed session, revocation and audit; no default user creation                                            |
| Publish version   | Lock version, validate/freeze its children, content hash and audit                                                                                   |
| Schedule          | Lock assessment, validate rule and frozen pool, save full-duration schedule and audit                                                                |
| Start             | Lock assessment/assignment, deduplicate, exact four-version allocation, rule snapshot, deadline, expiry outbox and durable response                  |
| Save draft        | Lock assessment/attempt, require IN_PROGRESS and DB now < expiresAt, compare draft revision, save source/hash/revision                               |
| Select language   | Same time/state/ownership checks, compare attempt stateVersion, update active language and increment stateVersion                                    |
| Run/public submit | Same time/state checks, source snapshot, dedup key/request hash, submission and judge outbox; submit also updates matching draft and active language |
| Finalize          | Freeze active-language sources, four FINAL submissions and pointers, FINALIZING transition, judge events, idempotency record and audit               |
| Judge claim       | Claim eligible submission with generation/lease token; release DB connection before execution                                                        |
| Judge complete    | Compare lease token/generation, insert unique result, terminal status and aggregation outbox in one transaction                                      |
| Aggregate result  | Lock attempt, require all four final results, compute frozen-policy aggregate, save unique AssessmentResult and FINALIZED status                     |
| Cancel            | Lock assessment, close admission, transition attempts to VOIDED with audit and cancellation outbox; reject future writes                             |

Draft revision 0 means no draft exists; a successful first save returns 1. Identical lost-response
retries at the preceding revision return the committed version without incrementing it. A stale
different source returns `REVISION_CONFLICT`; retain the unsent buffer so a reconnect cannot silently
overwrite another tab. The later UI saves on a bounded debounce/interval and before intentional
finalization. PostgreSQL's last acknowledged draft is the only recoverable source after a crash.

`IdempotencyRecord` is keyed by user, operation/resource and client key with a canonical request
hash; submission also has durable `[attemptId,idempotencyKey]` uniqueness. Same key/same payload
returns the recorded resource; same key/different payload returns 409. A retry never produces a
second job/submission/source snapshot. Store dedup rows for at least the assessment plus retry
window (initially seven days); source submissions and start uniqueness remain durable afterwards.
Do not store login passwords, cookies or sensitive results as idempotency payloads.

## Server-authoritative expiry and final source policy

Initial scoring policy is **final active-language draft snapshot**, not best historical submission.
An accepted explicit submission updates that language's draft and selection atomically; autosaves
may supersede it before finalization. `RUN_PUBLIC` does not update the saved draft. If no draft is
saved, freeze the allocated starter template for the active language. Thus all four questions have
an explicit immutable FINAL source snapshot; unsaved/offline code is never silently claimed as saved.
Scoring policy and toolchain versions are pinned. Detailed grading implementation is deferred.

Every student mutation rejects `clock_timestamp() >= expiresAt`, even if a delayed expiry job has
not run. At expiry, both the scheduled BullMQ job and a periodic database reconciler attempt the
same locked transition. Start writes an expiry outbox event; queue delay does not extend time.
The reconciler scans indexed `[status,expiresAt]` every five seconds and can recover missing jobs.
Repeated explicit or automatic finalization returns the existing frozen snapshots/state.

Finalization first takes the attempt lock, then transitions IN_PROGRESS → FINALIZING and snapshots
four sources in one commit. A save racing with expiry either committed strictly before the deadline
and participates, or loses the lock/time check and is rejected. No saves/submits are accepted in
FINALIZING. Queue work continues after expiry; no new browser source is accepted. FINALIZED occurs
only after all final jobs have definitive results. Infrastructure failures keep result state PENDING
or REQUIRES_REVIEW and trigger retry/operator recovery; they do not penalize the student's score.
Cancellation transitions to VOIDED, freezes writes and excludes the attempt from scoring.

The client estimates DB clock offset using `meta.serverNow` and request round trip, renders using
a monotonic clock, resyncs approximately every 30 seconds and on visibility/reconnect. Reaching zero
can trigger a best-effort finalization request; the backend still finalizes if the browser is closed.

## Outbox and worker delivery

Domain changes write `OutboxEvent` in the same SQL transaction; no database/Redis dual-write gap.
Dispatchers claim batches with `FOR UPDATE SKIP LOCKED`, enqueue identifier-only jobs, and mark
dispatched only after Redis acknowledges. A crash between enqueue and marking causes a replay.
Use deterministic IDs such as `judge-<submissionId>-g<generation>` and
`expire-<attemptId>-<deadlineEpochMs>`. BullMQ IDs must not contain colons. Queue deduplication is
temporary after job retention; PostgreSQL durable uniqueness/claims enforce final correctness.

Workers have bounded concurrency and a lease token plus monotonically increasing generation.
Only the current lease can commit a result. A stale worker's late response cannot replace a newer
result. Recover stalled jobs and expired leases using the database, increment generation and create
a new outbox event. Reconciliation also finds PENDING/QUEUED submissions stranded after Redis loss.
Retry sandbox infrastructure failures with bounded exponential backoff; do not retry deterministic
student compilation errors as infrastructure problems.

Final jobs and public runs use separate admission budgets, with final snapshots prioritized and
per-student fairness. Initial admission policy: one executing and two pending interactive jobs per
student, at most 10 new interactive jobs/minute, bounded global queue age/depth. Configure before
load testing. Respond 429/503 with Retry-After before accepting when over capacity; do not acknowledge
a submission then discard it. Final snapshots bypass interactive rejection and remain durable in
the outbox for eventual dispatch.

See [BullMQ job IDs](https://docs.bullmq.io/guide/jobs/job-ids) and
[idempotent jobs](https://docs.bullmq.io/patterns/idempotent-jobs) for queue semantics.
