# Step 3 validation and changed files

Validated on 2026-10-12 with Node 24.12.0 and pnpm 10.34.6. The original three applications and earlier migrations are preserved.

## Validation results

| Check                         | Result                                                                                                                                 |
| ----------------------------- | -------------------------------------------------------------------------------------------------------------------------------------- |
| Workspace/configuration check | Exactly three applications, strict TypeScript and pinned dependencies                                                                  |
| OpenAPI generation/lint       | 46 operations; implemented and reserved routes distinguished                                                                           |
| Prisma validation/generation  | Valid schema; generated client includes additive public examples                                                                       |
| TypeScript and ESLint         | All applications and test configuration pass                                                                                           |
| Root schema/contract tests    | 14 passed                                                                                                                              |
| Backend Jest tests            | 53 passed, including 27 real HTTP/SQL integration cases; 24 historical TODO markers excluded from pass counts                          |
| Frontend Vitest               | 46 passed, including ordered autosave, continuous typing, separate language buffers, conflict handling, reconnect and timer boundaries |
| Production builds             | Backend and student Next.js standalone build pass                                                                                      |
| Playwright                    | 8 passed: desktop and iPhone-emulated Chromium login/dashboard regression plus full attempt workflow                                   |
| Compiled API smoke check      | Protected assessments/start 401; invalid login input 400                                                                               |

Integration/browser tests apply all three migrations to isolated PostgreSQL 18.3 through PGlite/pg-wire, with real Prisma persistence and real Nest HTTP. They never access production data or invent successful execution responses. Duplicate requests, ownership, immutable public examples, draft revision replay/conflicts, invalid states, expiry, four final snapshots and the browser's actual acknowledged drafts are asserted.

The browser workflow types into Monaco, switches Python/Java, moves Q1 → Q4 → Q1, refreshes, interrupts network connectivity, retries saving, verifies real stored drafts and finalizes. Source snapshots remain PENDING with no grading result. It checks viewport fit and unexpected page errors; the Safari clipboard defect is corrected in asset preparation rather than filtered out of assertions. Screenshots are generated in `artifacts/attempt-chromium.png` and `artifacts/attempt-mobile.png`.

## Files created

- `backend/prisma/migrations/20261012000000_public_question_examples/migration.sql`
- `backend/src/modules/attempts/allocation.ts` and `allocation.spec.ts`
- `backend/src/modules/attempts/attempt-expiry.reconciler.ts`
- `backend/src/modules/attempts/dto/attempt-input.dto.ts`
- `backend/test/attempts.integration.spec.ts`
- `frontend/src/app/(student)/attempts/[id]/page.tsx`, `loading.tsx`, `error.tsx`
- `frontend/features/attempts/assessment-workspace.tsx`, `code-editor.tsx`, `draft-store.ts`, `exam-timer.tsx`, `execution-panel.tsx`, `problem-content.tsx`, `resizable-panels.tsx`, `use-draft-autosave.ts`
- `frontend/services/attempt-api.ts`
- `frontend/styles/workspace.css`
- `frontend/test/draft-store.test.ts`, `exam-workspace.test.tsx`
- `scripts/prepare-monaco.mjs`
- `test/e2e/attempt.spec.ts`
- `docs/step-3.md`, `docs/step-3-validation.md`

## Files updated

- `backend/prisma/schema.prisma`, `dev-seed.ts`: additive public projection; fresh fixture topics/examples/explanation, preserving published data
- `backend/src/modules/attempts/attempts.controller.ts`, `attempts.service.ts`, `attempts.module.ts`, `repositories/attempts.repository.ts`, `test/attempts.spec.ts`: registered lifecycle APIs, persistence and real input checks
- `backend/package.json`, `backend/test/student.integration.spec.ts`: integration test inclusion and additive migration coverage
- `frontend/package.json`, `eslint.config.mjs`: pinned Monaco dependencies, local asset preparation and generated-asset exclusion
- `frontend/services/api-client.ts`: shared CSRF mutation helper
- `frontend/components/ui/modal.tsx`: parent-controlled Escape dismissal respects in-flight finalization
- `frontend/features/assessments/assessment-card.tsx`, `assessment-countdown.tsx`: real start/resume/review and measured server clock support
- `frontend/features/auth/use-auth.ts`: clear per-tab recovery code on logout
- `frontend/features/attempts/README.md`, `frontend/styles/globals.css`, `frontend/test/assessment-card.test.tsx`
- `.gitignore`, `.prettierignore`, `pnpm-lock.yaml`
- `scripts/build-openapi.mjs`, `contracts/openapi.json`, `contracts/generated/api.d.ts`: actual public response fields and canonical/legacy routes
- `scripts/check-api-scaffold.mjs`, `scripts/write-structure.mjs`, `test/support/start-step2.mjs`: smoke tests, source inventory and independent real coding fixtures
- `README.md`, `docs/api.md`, `docs/folder-structure.md`: setup, implementation status and file inventory

## Reproduce

```powershell
pnpm.cmd install --frozen-lockfile
pnpm.cmd validate
pnpm.cmd test:backend
pnpm.cmd test:frontend
pnpm.cmd scaffold:smoke
pnpm.cmd exec playwright install chromium
pnpm.cmd test:e2e
pnpm.cmd format:check
```

For the running application, configure the private environment files and PostgreSQL as described in the root README, then `pnpm db:generate`, `pnpm db:migrate`, optionally `pnpm db:seed`, and start `pnpm dev:backend` / `pnpm dev:frontend` in separate terminals. Seed schedules are immutable on rerun; there is no data reset command.

## Remaining deployment checks

Native PostgreSQL 17, multi-process database races, real Safari/Android devices and 500-user load testing were not available in this environment. PGlite uses one SQL connection; concurrent HTTP tests prove durable behavior through that configuration, not production throughput. Docker itself was unavailable; its existing configuration is preserved.

Existing Step 2 published fixtures may lack public examples because their original encryption keys were discarded. They are not backfilled. Fresh seeds include public statement examples, but those fixtures still require reviewed executable versions, actual toolchains and managed keys for the Step 4 judge. Execution/queue dispatch/grades/admin management remain deliberately unimplemented.

The test runtime reports Node VM-module and pg adapter deprecation notices; these did not fail tests. Keep the pinned pg/Prisma combination under review before upgrading pg to major 9. Dependency patch and native-mobile limits are documented in `step-3.md`.
