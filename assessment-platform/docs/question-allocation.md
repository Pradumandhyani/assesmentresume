# Question publication and allocation

## Publish and schedule

Questions have stable identities and explicit topic mappings. Each `QuestionVersion` owns its
statement, difficulty, constraints, scoring ceiling, resource limits, three language templates
and encrypted public/hidden test cases. Published versions and their children cannot be updated,
inserted into or deleted from. Changes create a new draft and version number. `contentHash` covers
canonical statement, limits, templates/toolchain references and case integrity digests.

Publication validates case ordinals, nonzero weights, public and hidden coverage, matching
sample outputs, toolchain availability, bounded CPU/wall/memory/output limits and language-specific
resource requirements. Reference solutions are private validation artifacts, never response fields.
The repository's `Questions/question_bank.json` has **417 records**. `pnpm db:import:questions`
imports them into the configured development/test database, and `local:up` runs it automatically.
The importer validates all records before writing, preserves explicit test visibility, treats
unlabelled edge cases as hidden, encrypts cases and keeps reference solutions out of student
templates. Reruns preserve unchanged or deleted questions and version changed content. Structural
validation does not establish reference-solution correctness or validate isolated execution.
The raw records and Excel files are separate source inventories and are not imported.

An admin schedules an assessment only after its version pool meets **at least 2 Easy, 1 Medium,
1 Hard**, with one published version per question identity and all three languages supported.
Pool entries reference `[versionId, questionId]`, preventing mismatched identities. Publication
freezes schedule, rule and pool. `latestStartAt + 3 hours <= closesAt` guarantees every admitted
student receives the full duration. Reject incomplete schedules or insufficient pools atomically.
The admin can configure 1 to 20 questions and 900 to 21,600 seconds within SQL-enforced bounds.
New admin assessments default to the full compatible published bank, resolved on save across
all pages by marks, topics and languages, with one latest published version per active question.
Manual pools are also supported. Pool contents are frozen at publication; adding or deleting
bank questions does not rewrite a saved scheduled assessment or a student's attempt.

## Atomic start

1. Validate session role, assignment ownership and active eligibility.
2. Begin a SERIALIZABLE transaction; lock assessment (shared with other starters, conflicting
   with schedule/cancellation updates), assignment and any existing attempt in consistent order.
3. If an attempt exists, return it unchanged, including an expired/finalized one. Check replay
   before admission timing so retries after the start window never allocate again.
4. After acquiring locks, obtain `clock_timestamp()` from PostgreSQL. Require
   `opensAt <= now <= latestStartAt`, an eligible noncancelled status and frozen published pool.
5. Use Node's cryptographic random generator for unbiased partial Fisher–Yates selection within
   each difficulty bucket: two distinct Easy, one Medium, one Hard. Version eligibility is fixed;
   do not run an expensive `ORDER BY RANDOM()` scan for every student.
6. Shuffle selected question navigation order with the same unbiased technique. Students may
   share questions; global exclusivity is not required and would exhaust a modest question bank.
7. Insert one attempt, four `AttemptQuestion` rows, frozen rule/manifest hashes, idempotency
   record and a scheduled finalization outbox event in one transaction. `expiresAt = startedAt +
interval '3 hours'`. A deferred database trigger validates exactly the required question mix.
8. Commit. Only then return the attempt. Roll back entirely on any allocation/rule failure.

Uniqueness on assignment and `[assessmentId, studentId]` protects concurrent starts even when
different idempotency keys are used. Retry serialization/unique races a bounded number of times
and load the committed winner. Never expose a random seed or resample after a refresh.

## Resume and navigation

`GET /student/attempts/{attemptId}` returns persisted status, absolute UTC start/deadline, server
time, ordered question IDs, selected languages and saved drafts/revisions. A separate question
endpoint returns only allocated public content and public examples. No hidden ORM relation is
included. Client navigation changes display state; it cannot select another question or version.
Switching language preserves separate per-language drafts and persists the active language under
an attempt state-version check. Source limits, ownership and time checks apply to every mutation.

Cache immutable published public projections on the server by version hash; cache assignment and
session authorization separately. Never cache personalized exam responses in a shared CDN.
