# DSA Coding Assessment Platform — Step 1

Architecture and configuration scaffold for a target of **500 concurrently active students**.
Exactly three applications: `frontend/`, `backend/`, `admin/`. This step does not implement
login, dashboards, assessment screens, editing, execution, grading or administration workflows.
The Next.js root pages identify the scaffold; the API has **no business controllers registered**.
All documented business endpoints currently return the framework's ordinary 404 response.
Worker files are contracts and cannot execute submitted code.

## Start locally

Requirements: Node **24.12+ within major 24**, pnpm **10.34.6**, Docker Engine/Desktop with
Compose v2. Use `npm.cmd` / `pnpm.cmd` on Windows if PowerShell blocks `.ps1` launchers.

```powershell
cd assessment-platform
npm.cmd install --global pnpm@10.34.6
Copy-Item .env.example .env
Copy-Item backend/.env.example backend/.env
Copy-Item frontend/.env.example frontend/.env.local
Copy-Item admin/.env.example admin/.env.local
```

Choose a local development password in `.env`, then put the **same URL-encoded password** in
`backend/.env`'s `DATABASE_URL`. These examples contain no real credentials. Database services
are development-only, bind to loopback and use dedicated persistent volumes.

```powershell
pnpm.cmd install --frozen-lockfile
pnpm.cmd contracts:generate
pnpm.cmd validate
pnpm.cmd build
pnpm.cmd scaffold:smoke
pnpm.cmd infra:config
pnpm.cmd infra:up
pnpm.cmd dev
```

Application shells: student `http://localhost:3000`, admin `http://localhost:3001`, API
`http://localhost:4000`. No schema is applied during installation, generation, validation, build
or API startup. The API currently validates environment configuration but opens no DB/Redis
connection. To test future cookie authentication through the gateway, run in another terminal:

```powershell
docker compose --env-file .env --profile gateway up -d gateway
```

Then use student `http://localhost:8080` and admin `http://localhost:8081`. `/api/v1` is proxied
to NestJS on each origin. Port 3000/3001 direct access displays the shells but does not proxy
future API requests. Production uses HTTPS and a trusted reverse proxy with the same topology.
`pnpm infra:stop` preserves volumes. No reset command is provided.

## Database setup is a deliberate separate operation

Read [database and adoption strategy](docs/database.md) **before pointing this project at a
database**. The checked-in initial migration targets an empty installation and includes a guard
against an existing `users` table. No production credentials or live schema were available.

For a confirmed, empty, disposable development database only:

```powershell
pnpm.cmd --filter @assessment/backend exec prisma migrate deploy
```

Do not run this initial migration against an existing identity database. Adoption requires an
introspected mapping and reviewed additive migrations. No seed users, default admins or
question imports are included. `../Questions/` remains unchanged.

## Documents and contracts

- [Architecture and capacity](docs/architecture.md): processes, trust boundaries, 500-user plan.
- [Folder structure](docs/folder-structure.md): complete source inventory and feature conventions.
- [Database](docs/database.md): ER design, immutable versions, keys, migration/adoption workflow.
- [Authentication](docs/authentication.md): existing credentials, Argon2id, cookies, CSRF, roles.
- [Allocation](docs/question-allocation.md): 2 Easy / 1 Medium / 1 Hard, publication and resume.
- [Transactions and recovery](docs/transactions.md): deadlines, races, outbox and finalization.
- [Execution security](docs/execution-security.md): sandbox isolation, hidden cases, toolchains.
- [API specification](docs/api.md): error contract, permissions and endpoint index.
- [Validation report](docs/validation.md): checks actually performed and remaining gates.
- [Prisma schema](backend/prisma/schema.prisma).
- [OpenAPI 3.1 document](contracts/openapi.json), [source](scripts/build-openapi.mjs) and
  [generated TypeScript](contracts/generated/api.d.ts).

Run `pnpm contracts:generate` after changing the OpenAPI builder and check in both generated
artifacts. DTO aliases and both Next.js apps share these transport contracts, never Prisma models.
Runtime DTO validators, exception filters and session guards remain later-step work.

`pnpm test` runs architectural contract and isolated migration checks. `pnpm test:backend` runs
configuration security tests and reports deferred feature acceptance cases with `it.todo`; those
pending cases do not claim working business features. API, judge and maintenance environment
examples are separate; no judge or maintenance entrypoint exists in Step 1.

This scaffold is a production-oriented design, **not a production-ready running assessment
service**. Capacity and sandbox security require implementation, load tests and security testing
before deployment. See the validation report for exact limits.
