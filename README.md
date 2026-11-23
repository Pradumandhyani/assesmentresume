# DSA Assessment Platform

The applications are in `assessment-platform/frontend`, `assessment-platform/backend` and
`assessment-platform/admin`.

Read the [complete Windows / VS Code setup, seed and Railway guide](assessment-platform/README.md).

Read [praduman.md](praduman.md) for the project flow, database access, private credential locations,
environment key origins, Monaco, Redis, repository cleanup and production deployment.

Local and live question banks use different databases. To add `Questions/question_bank.json`
to the Railway production bank, preview with `pnpm.cmd db:import:questions:production`, then
apply with `pnpm.cmd db:import:questions:production --apply`. This adds drafts; see
[the production question import guide](production.md#add-the-json-question-bank-to-the-live-admin)
for the required private profile and publishing prerequisites.

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

See [production.md](production.md) for the live Railway/Vercel deployment, database access,
private secret locations and remaining judge requirements. The production question bank has
417 drafts with pinned Python/Java/C++ templates. In the admin, select draft checkboxes and
choose **Publish selected**; every selected draft is validated before publication.
