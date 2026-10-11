# Complete source structure

Exactly three application packages; root folders hold documentation, contracts, tests, scripts and infrastructure.

Generated dependency caches, build output, environment secrets and the regenerated Prisma client are excluded below.

```text
assessment-platform/
├── admin/
│   ├── app/
│   │   ├── globals.css
│   │   ├── layout.tsx
│   │   └── page.tsx
│   ├── components/
│   │   ├── providers/
│   │   │   └── query-provider.tsx
│   │   └── ui/
│   │       └── button.tsx
│   ├── features/
│   │   ├── assessments/
│   │   │   └── README.md
│   │   ├── audit/
│   │   │   └── README.md
│   │   ├── auth/
│   │   │   └── README.md
│   │   ├── questions/
│   │   │   └── README.md
│   │   ├── results/
│   │   │   └── README.md
│   │   ├── students/
│   │   │   └── README.md
│   │   └── submissions/
│   │       └── README.md
│   ├── hooks/
│   │   └── README.md
│   ├── lib/
│   │   ├── env.ts
│   │   └── utils.ts
│   ├── services/
│   │   └── api-client.contract.ts
│   ├── types/
│   │   └── api.ts
│   ├── .env.example
│   ├── components.json
│   ├── eslint.config.mjs
│   ├── next-env.d.ts
│   ├── next.config.ts
│   ├── package.json
│   ├── postcss.config.mjs
│   └── tsconfig.json
├── backend/
│   ├── prisma/
│   │   ├── migrations/
│   │   │   ├── 20261011000000_new_install_only/
│   │   │   │   └── migration.sql
│   │   │   └── migration_lock.toml
│   │   ├── invariants.sql
│   │   └── schema.prisma
│   ├── src/
│   │   ├── common/
│   │   │   ├── auth/
│   │   │   │   ├── authorization-policy.ts
│   │   │   │   └── request-context.ts
│   │   │   ├── contracts/
│   │   │   │   └── operation-handler.ts
│   │   │   ├── errors/
│   │   │   │   └── api-error.ts
│   │   │   └── guards/
│   │   │       └── session.guard.contract.ts
│   │   ├── config/
│   │   │   ├── environment.ts
│   │   │   └── worker-environment.ts
│   │   ├── database/
│   │   │   └── database.contract.ts
│   │   ├── modules/
│   │   │   ├── admin/
│   │   │   │   ├── dto/
│   │   │   │   │   └── admin.dto.ts
│   │   │   │   ├── policies/
│   │   │   │   │   └── admin.policy.ts
│   │   │   │   ├── repositories/
│   │   │   │   │   └── admin.repository.ts
│   │   │   │   ├── test/
│   │   │   │   │   └── admin.spec.ts
│   │   │   │   ├── admin.controller.ts
│   │   │   │   ├── admin.module.ts
│   │   │   │   └── admin.service.ts
│   │   │   ├── assessments/
│   │   │   │   ├── dto/
│   │   │   │   │   └── assessments.dto.ts
│   │   │   │   ├── policies/
│   │   │   │   │   └── assessments.policy.ts
│   │   │   │   ├── repositories/
│   │   │   │   │   └── assessments.repository.ts
│   │   │   │   ├── test/
│   │   │   │   │   └── assessments.spec.ts
│   │   │   │   ├── assessments.controller.ts
│   │   │   │   ├── assessments.module.ts
│   │   │   │   └── assessments.service.ts
│   │   │   ├── attempts/
│   │   │   │   ├── dto/
│   │   │   │   │   └── attempts.dto.ts
│   │   │   │   ├── policies/
│   │   │   │   │   └── attempts.policy.ts
│   │   │   │   ├── repositories/
│   │   │   │   │   └── attempts.repository.ts
│   │   │   │   ├── test/
│   │   │   │   │   └── attempts.spec.ts
│   │   │   │   ├── attempts.controller.ts
│   │   │   │   ├── attempts.module.ts
│   │   │   │   └── attempts.service.ts
│   │   │   ├── auth/
│   │   │   │   ├── dto/
│   │   │   │   │   └── auth.dto.ts
│   │   │   │   ├── policies/
│   │   │   │   │   └── auth.policy.ts
│   │   │   │   ├── repositories/
│   │   │   │   │   └── auth.repository.ts
│   │   │   │   ├── test/
│   │   │   │   │   └── auth.spec.ts
│   │   │   │   ├── auth.controller.ts
│   │   │   │   ├── auth.module.ts
│   │   │   │   └── auth.service.ts
│   │   │   ├── execution/
│   │   │   │   ├── dto/
│   │   │   │   │   └── execution.dto.ts
│   │   │   │   ├── policies/
│   │   │   │   │   └── execution.policy.ts
│   │   │   │   ├── repositories/
│   │   │   │   │   └── execution.repository.ts
│   │   │   │   ├── test/
│   │   │   │   │   └── execution.spec.ts
│   │   │   │   ├── execution.controller.ts
│   │   │   │   ├── execution.module.ts
│   │   │   │   └── execution.service.ts
│   │   │   ├── questions/
│   │   │   │   ├── dto/
│   │   │   │   │   └── questions.dto.ts
│   │   │   │   ├── policies/
│   │   │   │   │   └── questions.policy.ts
│   │   │   │   ├── repositories/
│   │   │   │   │   └── questions.repository.ts
│   │   │   │   ├── test/
│   │   │   │   │   └── questions.spec.ts
│   │   │   │   ├── questions.controller.ts
│   │   │   │   ├── questions.module.ts
│   │   │   │   └── questions.service.ts
│   │   │   ├── results/
│   │   │   │   ├── dto/
│   │   │   │   │   └── results.dto.ts
│   │   │   │   ├── policies/
│   │   │   │   │   └── results.policy.ts
│   │   │   │   ├── repositories/
│   │   │   │   │   └── results.repository.ts
│   │   │   │   ├── test/
│   │   │   │   │   └── results.spec.ts
│   │   │   │   ├── results.controller.ts
│   │   │   │   ├── results.module.ts
│   │   │   │   └── results.service.ts
│   │   │   ├── students/
│   │   │   │   ├── dto/
│   │   │   │   │   └── students.dto.ts
│   │   │   │   ├── policies/
│   │   │   │   │   └── students.policy.ts
│   │   │   │   ├── repositories/
│   │   │   │   │   └── students.repository.ts
│   │   │   │   ├── test/
│   │   │   │   │   └── students.spec.ts
│   │   │   │   ├── students.controller.ts
│   │   │   │   ├── students.module.ts
│   │   │   │   └── students.service.ts
│   │   │   └── submissions/
│   │   │       ├── dto/
│   │   │       │   └── submissions.dto.ts
│   │   │       ├── policies/
│   │   │       │   └── submissions.policy.ts
│   │   │       ├── repositories/
│   │   │       │   └── submissions.repository.ts
│   │   │       ├── test/
│   │   │       │   └── submissions.spec.ts
│   │   │       ├── submissions.controller.ts
│   │   │       ├── submissions.module.ts
│   │   │       └── submissions.service.ts
│   │   ├── queues/
│   │   │   └── queue.contracts.ts
│   │   ├── workers/
│   │   │   ├── finalization/
│   │   │   │   └── finalization-worker.contract.ts
│   │   │   ├── judge/
│   │   │   │   ├── judge-worker.contract.ts
│   │   │   │   └── sandbox.contract.ts
│   │   │   ├── outbox/
│   │   │   │   └── outbox-worker.contract.ts
│   │   │   └── README.md
│   │   ├── app.module.ts
│   │   └── main.ts
│   ├── test/
│   │   ├── environment.spec.ts
│   │   └── README.md
│   ├── .env.example
│   ├── .env.judge.example
│   ├── .env.maintenance.example
│   ├── eslint.config.mjs
│   ├── jest.config.cjs
│   ├── nest-cli.json
│   ├── package.json
│   ├── prisma.config.ts
│   ├── tsconfig.build.json
│   └── tsconfig.json
├── contracts/
│   ├── generated/
│   │   └── api.d.ts
│   └── openapi.json
├── docs/
│   ├── api.md
│   ├── architecture.md
│   ├── authentication.md
│   ├── database.md
│   ├── execution-security.md
│   ├── folder-structure.md
│   ├── question-allocation.md
│   ├── transactions.md
│   └── validation.md
├── frontend/
│   ├── app/
│   │   ├── layout.tsx
│   │   └── page.tsx
│   ├── components/
│   │   └── ui/
│   │       └── button.tsx
│   ├── features/
│   │   ├── assessments/
│   │   │   └── README.md
│   │   ├── attempts/
│   │   │   └── README.md
│   │   ├── auth/
│   │   │   └── README.md
│   │   ├── dashboard/
│   │   │   └── README.md
│   │   ├── editor/
│   │   │   └── README.md
│   │   ├── results/
│   │   │   └── README.md
│   │   └── submissions/
│   │       └── README.md
│   ├── hooks/
│   │   └── README.md
│   ├── lib/
│   │   ├── env.ts
│   │   └── utils.ts
│   ├── providers/
│   │   └── query-provider.tsx
│   ├── services/
│   │   └── api-client.contract.ts
│   ├── styles/
│   │   └── globals.css
│   ├── types/
│   │   └── api.ts
│   ├── .env.example
│   ├── components.json
│   ├── eslint.config.mjs
│   ├── next-env.d.ts
│   ├── next.config.ts
│   ├── package.json
│   ├── postcss.config.mjs
│   └── tsconfig.json
├── infra/
│   └── nginx/
│       └── dev.conf
├── scripts/
│   ├── build-openapi.mjs
│   ├── check-api-scaffold.mjs
│   ├── validate-scaffold.mjs
│   └── write-structure.mjs
├── test/
│   ├── contracts.test.mjs
│   └── migration.test.mjs
├── .dockerignore
├── .editorconfig
├── .env.example
├── .gitignore
├── .node-version
├── .npmrc
├── .nvmrc
├── .prettierignore
├── .prettierrc.json
├── docker-compose.yml
├── package.json
├── pnpm-lock.yaml
├── pnpm-workspace.yaml
├── README.md
├── redocly.yaml
└── tsconfig.base.json
```

179 source/configuration/documentation files in this inventory.

Backend feature controller/service/repository/policy files are contracts; empty Nest modules register no business endpoints. Each feature has DTO aliases and explicitly deferred tests. Frontend/admin features reserve local components, hooks, schemas and adapters without implementing workflows.
