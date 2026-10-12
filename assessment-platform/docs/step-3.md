# Step 3 — coding workspace and durable attempts

The implementation extends the existing Step 1 architecture and Step 2 authentication/dashboard. Exactly three application folders remain. PostgreSQL owns deadlines, allocations, language selection, drafts and source snapshots. No judge, sandbox, queue dispatcher, grading or admin management was implemented.

## Running

Follow the root README to install, copy private environment files, start development PostgreSQL, generate Prisma and deploy migrations. Run `pnpm db:seed` only against the guarded development database. Existing schedules are preserved. On a fresh seed, set `DEV_ASSESSMENT_START_AT` to the current UTC time or shortly before it to test starting immediately; the admission window is 30 minutes. Start `pnpm dev:backend` and `pnpm dev:frontend`, sign in with real provisioned credentials, then choose Active → Start Assessment → Begin assessment. `pnpm dev:frontend` and the production build prepare Monaco assets automatically.

## Implemented API routes

All paths below are prefixed `/api/v1`. Student session, active identity, role and ownership checks apply to every route. All mutations require a bound CSRF token and matching Origin. No route returns unrestricted ORM rows.

| Method | Canonical route                                                | Response                                                                  |
| ------ | -------------------------------------------------------------- | ------------------------------------------------------------------------- |
| POST   | `/assessments/{assessmentId}/start`                            | Attempt, 200; required Idempotency-Key                                    |
| GET    | `/attempts/{attemptId}`                                        | Persisted deadline, fixed questions, drafts, capabilities                 |
| GET    | `/attempts/{attemptId}/questions/{attemptQuestionId}`          | Allocated public content, examples and three templates                    |
| GET    | `/attempts/{attemptId}/drafts`                                 | Owned per-question/per-language drafts                                    |
| PUT    | `/attempts/{attemptId}/drafts/{attemptQuestionId}/{language}`  | Confirmed source, revision and savedAt                                    |
| PATCH  | `/attempts/{attemptId}/questions/{attemptQuestionId}/language` | Persisted selection and incremented stateVersion                          |
| POST   | `/attempts/{attemptId}/finalization`                           | Frozen attempt, 202; required Idempotency-Key                             |
| GET    | `/attempts/{attemptId}/history`                                | Up to 200 owned source snapshots, newest first; no results or diagnostics |

The original `/student/assessments/{assessmentId}/attempts`, `/student/attempts/{attemptId}`, question, draft, language and finalization contracts remain supported. The original draft URL is `/student/attempts/{attemptId}/questions/{attemptQuestionId}/drafts/{language}`. Languages are exactly `PYTHON`, `JAVA`, `CPP`. Save body: `{ sourceCode, expectedRevision }`; language body: `{ language, expectedStateVersion }`; finalization body: `{ expectedStateVersion }`. Revision zero means a missing draft. Start has no input parameters beyond the resource and idempotency header.

Responses use the existing `{ data, meta: { requestId, serverNow } }` envelope, UTC timestamps, string decimal scores and no-store headers. Ownership failures are 404; session/CSRF failures 401/403; stale revisions and incompatible idempotency requests 409; expired or noneditable attempts 410; incomplete pools 422. Execution endpoints remain reserved, returning the existing sanitized 404. `capabilities.executionAvailable` is false and the controls explain availability; no successful execution response is synthesized.

## Transactions and allocation

Start uses SERIALIZABLE isolation, bounded database statement/lock/transaction timeouts and bounded retries. It acquires assessment/assignment locks before attempt locks, verifies timing after locking, selects two Easy, one Medium and one Hard using cryptographic Fisher–Yates shuffling, and freezes navigation order. Attempt creation, four assignments, rule/manifest snapshots, audit, idempotency reference and expiry outbox are one transaction. PostgreSQL's deferred allocation trigger still requires the exact four-question mix. Parallel requests with different keys also return the same attempt through durable assignment uniqueness. Existing attempts are returned before checking the admission window, without restarting their timer.

Draft and language mutations lock the same assessment/attempt as finalization. PostgreSQL `clock_timestamp()` is checked after lock acquisition. A draft write stores a SHA-256 source digest and increments its revision. Identical lost-response retries at the preceding revision return the committed draft; other stale writes fail without overwriting code. UTF-8 source length is capped at 65,536 bytes. Language changes use the attempt stateVersion; selecting the already active language is a harmless replay.

Manual or expiry finalization takes the same lock, snapshots each active-language draft (or its pinned starter when no draft exists), links four immutable FINAL submissions, writes identifier-only judge outbox events, audits the transition and sets FINALIZING. No grading result is created. Replays return the persisted state without creating additional snapshots. Only a future judge/aggregator can transition to FINALIZED. Rejection of an expired mutation occurs after finalization commits, so the rejected request cannot roll it back.

An API lifecycle reconciler scans at most 50 indexed expired attempts every five seconds, skips busy attempt locks and applies the same idempotent transition. Reads and rejected late writes also reconcile expiry. The browser may be closed. Shutdown stops the interval; no code execution occurs in this process. Expiry and judge outbox events remain pending for the Step 4 dispatcher.

## Editor, autosave and resume

Monaco 0.57.0 is loaded through @monaco-editor/react 4.7.0 from same-origin `/monaco/vs` assets copied during dev/build. No CDN or language server is required. Python, Java and C++ have highlighting, indentation, bracket handling, line numbers, document word suggestions and language snippets. Semantic compiler diagnostics require the future judge; the editor accepts typed real diagnostic markers without inventing them. Themes, a 12–24 px font slider, Ctrl/Cmd+S and keyboard navigation are supported. Desktop panels resize by dragging or arrow keys; mobile provides Problem, Code and Results tabs.

The asset preparation script includes a narrowly guarded fix for the [upstream Safari clipboard cancellation defect](https://github.com/microsoft/monaco-editor/issues/5458): it observes the workaround's own deferred promise, retains the original ClipboardItem promise and reports other failures. It does not suppress window errors. A changed vendor filename/fragment makes preparation fail for review. Vendor license and third-party notices are copied too. [Monaco officially excludes mobile browsers from support](https://microsoft.github.io/monaco-editor/); the tabbed workflow is verified in Chromium with iPhone emulation, and real Safari/Android devices still require verification before an assessment rollout.

Buffers are independent for every question/language. The autosave store debounces 800 ms, flushes at least every five seconds during continuous typing while editable, serializes writes within each buffer, carries forward acknowledged revisions, retries transient failures up to three requests, flushes on switching/finalization and retains conflicting code. Only a backend acknowledgment shows Saved to server. Polls never overwrite a dirty buffer with another tab's version. Conflict recovery fetches the latest server revision and requires an explicit choice before replacing either source.

Unacknowledged edits are additionally retained in **per-tab sessionStorage**, namespaced by student and attempt, for refresh/network recovery. This is browser recovery storage, not proof of database persistence. Sources may be readable by scripts from the same origin, like Monaco's own editor buffer; no credentials, hidden tests or session secrets are stored there. Storage failures are visible. Logout clears this recovery data. A recovered stale revision triggers conflict review. Acknowledged drafts restore from PostgreSQL; closing the tab or clearing browser storage can lose unsent code. The leave action and browser beforeunload protect unsaved changes.

The exam clock derives from `expiresAt`, PostgreSQL `meta.serverNow` and monotonic performance time. It includes measured request transit conservatively so a delayed response cannot extend editing. Attempt polls every ten seconds, visibility/focus and reconnect resynchronize, and clock trust expires after twenty seconds. Unsynchronized/expired/frozen attempts are read-only. Local Date.now changes do not unlock editing or reset the persisted three-hour deadline. The interface warns at 15, 5 and 1 minute and requests server reconciliation at zero; server checks remain decisive for every mutation.

## Additive database migration and public examples

`20261012000000_public_question_examples` adds nullable, bounded JSON `QuestionVersion.publicExamples`. These are explicitly public statement examples, containing ordinal/input/expectedOutput; they are never derived from hidden cases. Actual TestCase ciphertext, encryption IDs and diagnostics never enter browser queries. The existing publication trigger makes this field immutable along with the version. Future question publication must validate these examples against its PUBLIC cases before publication and include them in the content digest.

Fresh development fixtures create this public projection before publication, with topics and explanations. **Existing published Step 2 fixtures are not edited or backfilled.** Their original seed encryption keys were deliberately discarded, so their examples may be unavailable and their ciphertext is unsuitable for a future judge. The workspace reports that state. Future executable assessments need new reviewed immutable question versions, configured toolchains and managed encryption keys. Existing assessment pools, schedules and attempts cannot be replaced to retrofit this data. No production data was reset or migrated destructively.

Native PostgreSQL 17 concurrency, load at 500 active students, multiple API replicas and the Step 4 delivery path still need deployment verification. Isolated SQL/browser tests establish functional behavior, not a capacity claim.
