# DSA Assessment Platform

The applications are in `assessment-platform/frontend`, `assessment-platform/backend` and
`assessment-platform/admin`.

Read the [complete Windows / VS Code setup, seed and Railway guide](assessment-platform/README.md).

Read [praduman.md](praduman.md) for the project flow, database access, private credential locations,
environment key origins, Monaco, Redis, repository cleanup and production deployment.

After installing Node 24.12+ within major 24, pnpm 10.34.6 and Docker Desktop's Linux engine,
run this from the repository root in the VS Code PowerShell terminal:

```powershell
pnpm.cmd local:up
```

This runs migrations, development seeds and all three applications. Private verified login
details are saved in `assessment-platform/.local/credentials.json`. Stop with Ctrl+C or
`pnpm.cmd local:down`; check with `pnpm.cmd local:check`.

For a separate Railway development database, run `pnpm.cmd railway:login` once and then
`pnpm.cmd railway:up`. Railway provisioning was blocked by its active API/build outage on
2026-10-21; the full guide states what has and has not been verified.

See [production.md](production.md) for the current Railway/Vercel preparation status, verified
Vercel project dashboards, private secret locations and the remaining deployment steps.
Railway resource creation is deferred under the explicit no-new-charges requirement.
