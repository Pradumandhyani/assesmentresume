# Administration application

The separate Next.js console uses the shared NestJS session/CSRF system. The backend enforces the ADMIN role on every administration endpoint; browser checks and navigation are additional access controls.

Run from the repository root:

```sh
pnpm dev:admin
pnpm --filter @assessment/admin typecheck
pnpm --filter @assessment/admin lint
pnpm --filter @assessment/admin test
pnpm --filter @assessment/admin build
```

Set `BACKEND_API_URL` in `admin/.env.local` to the private API origin. Browser requests remain same-origin at `/api/v1`. Add the externally visible admin origin to backend `ADMIN_ORIGINS`. Provision an administrator using the documented backend operator command; no default administrator password is shipped.

Routes include `/login`, `/dashboard`, `/students`, `/assessments`, `/assessments/create`, `/assessments/[id]`, `/questions`, `/questions/create`, `/questions/[id]/edit`, `/submissions`, `/results`, `/settings`, and `/audit-logs`.

Question authoring requires a backend-mounted private keyring and reviewed toolchain catalog. Hidden inputs/outputs are accessible only through audited administration APIs and remain in browser memory while editing; previews show public content only. Published versions are immutable. Creating a new draft preserves existing students’ allocated versions. Structural validation explicitly reports that it has not executed code.

Critical mutations carry stable idempotency keys through unchanged-body retries and use revisions to protect against concurrent edits. The console never reports persistence before the API confirms it. Effective system settings are read-only deployment values and never include secrets.

The repository Playwright suite runs desktop and mobile browsers against actual API persistence in an ephemeral PostgreSQL-compatible database. Its generated keyring and image catalog are test-only authoring fixtures. Execution stays disabled there; real runtime and Redis tests belong to the isolated Linux judge gate.
