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
│   │   │   ├── 20261011010000_student_dashboard/
│   │   │   │   └── migration.sql
│   │   │   ├── 20261012000000_public_question_examples/
│   │   │   │   └── migration.sql
│   │   │   └── migration_lock.toml
│   │   ├── dev-seed.ts
│   │   ├── development-database.ts
│   │   ├── invariants.sql
│   │   ├── provision-student.ts
│   │   ├── schema.prisma
│   │   └── seed.ts
│   ├── src/
│   │   ├── common/
│   │   │   ├── auth/
│   │   │   │   ├── authorization-policy.ts
│   │   │   │   └── request-context.ts
│   │   │   ├── contracts/
│   │   │   │   └── operation-handler.ts
│   │   │   ├── errors/
│   │   │   │   └── api-error.ts
│   │   │   ├── guards/
│   │   │   │   ├── session.guard.contract.ts
│   │   │   │   └── session.guard.ts
│   │   │   └── http/
│   │   │       ├── api-error.ts
│   │   │       └── api-response.ts
│   │   ├── config/
│   │   │   ├── environment.ts
│   │   │   └── worker-environment.ts
│   │   ├── database/
│   │   │   ├── database.contract.ts
│   │   │   ├── database.module.ts
│   │   │   └── prisma.service.ts
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
│   │   │   │   │   ├── assessments.dto.ts
│   │   │   │   │   └── list-assessments.dto.ts
│   │   │   │   ├── policies/
│   │   │   │   │   └── assessments.policy.ts
│   │   │   │   ├── repositories/
│   │   │   │   │   └── assessments.repository.ts
│   │   │   │   ├── test/
│   │   │   │   │   └── assessments.spec.ts
│   │   │   │   ├── assessment-eligibility.spec.ts
│   │   │   │   ├── assessment-eligibility.ts
│   │   │   │   ├── assessments.controller.ts
│   │   │   │   ├── assessments.module.ts
│   │   │   │   └── assessments.service.ts
│   │   │   ├── attempts/
│   │   │   │   ├── dto/
│   │   │   │   │   ├── attempt-input.dto.ts
│   │   │   │   │   └── attempts.dto.ts
│   │   │   │   ├── policies/
│   │   │   │   │   └── attempts.policy.ts
│   │   │   │   ├── repositories/
│   │   │   │   │   └── attempts.repository.ts
│   │   │   │   ├── test/
│   │   │   │   │   └── attempts.spec.ts
│   │   │   │   ├── allocation.spec.ts
│   │   │   │   ├── allocation.ts
│   │   │   │   ├── attempt-expiry.reconciler.ts
│   │   │   │   ├── attempts.controller.ts
│   │   │   │   ├── attempts.module.ts
│   │   │   │   └── attempts.service.ts
│   │   │   ├── auth/
│   │   │   │   ├── dto/
│   │   │   │   │   ├── auth.dto.ts
│   │   │   │   │   └── login.dto.ts
│   │   │   │   ├── policies/
│   │   │   │   │   └── auth.policy.ts
│   │   │   │   ├── repositories/
│   │   │   │   │   └── auth.repository.ts
│   │   │   │   ├── test/
│   │   │   │   │   ├── auth.spec.ts
│   │   │   │   │   └── password.spec.ts
│   │   │   │   ├── auth.controller.ts
│   │   │   │   ├── auth.module.ts
│   │   │   │   ├── auth.security.ts
│   │   │   │   ├── auth.service.ts
│   │   │   │   ├── auth.types.ts
│   │   │   │   └── password.service.ts
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
│   │   ├── attempts.integration.spec.ts
│   │   ├── environment.spec.ts
│   │   ├── README.md
│   │   └── student.integration.spec.ts
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
│   ├── step-1-readme.md
│   ├── step-2-validation.md
│   ├── step-2.md
│   ├── step-3-validation.md
│   ├── step-3.md
│   ├── transactions.md
│   └── validation.md
├── frontend/
│   ├── components/
│   │   ├── ui/
│   │   │   ├── button.tsx
│   │   │   └── modal.tsx
│   │   └── platform-logo.tsx
│   ├── features/
│   │   ├── assessments/
│   │   │   ├── assessment-card.tsx
│   │   │   ├── assessment-countdown.tsx
│   │   │   ├── countdown.ts
│   │   │   ├── README.md
│   │   │   └── use-assessments.ts
│   │   ├── attempts/
│   │   │   ├── assessment-workspace.tsx
│   │   │   ├── code-editor.tsx
│   │   │   ├── draft-store.ts
│   │   │   ├── exam-timer.tsx
│   │   │   ├── execution-panel.tsx
│   │   │   ├── problem-content.tsx
│   │   │   ├── README.md
│   │   │   ├── resizable-panels.tsx
│   │   │   └── use-draft-autosave.ts
│   │   ├── auth/
│   │   │   ├── login-form.tsx
│   │   │   ├── login-schema.ts
│   │   │   ├── README.md
│   │   │   └── use-auth.ts
│   │   ├── dashboard/
│   │   │   ├── dashboard-skeleton.tsx
│   │   │   ├── README.md
│   │   │   └── student-dashboard.tsx
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
│   ├── public/
│   ├── services/
│   │   ├── api-client.contract.ts
│   │   ├── api-client.ts
│   │   ├── attempt-api.ts
│   │   └── server-session.ts
│   ├── src/
│   │   └── app/
│   │       ├── (auth)/
│   │       │   └── login/
│   │       │       └── page.tsx
│   │       ├── (student)/
│   │       │   ├── attempts/
│   │       │   │   └── [id]/
│   │       │   │       ├── error.tsx
│   │       │   │       ├── loading.tsx
│   │       │   │       └── page.tsx
│   │       │   ├── dashboard/
│   │       │   │   ├── loading.tsx
│   │       │   │   └── page.tsx
│   │       │   └── layout.tsx
│   │       ├── error.tsx
│   │       ├── layout.tsx
│   │       └── page.tsx
│   ├── styles/
│   │   ├── globals.css
│   │   └── workspace.css
│   ├── test/
│   │   ├── assessment-card.test.tsx
│   │   ├── countdown.test.tsx
│   │   ├── draft-store.test.ts
│   │   ├── exam-workspace.test.tsx
│   │   ├── login-form.test.tsx
│   │   └── setup.ts
│   ├── types/
│   │   └── api.ts
│   ├── .env.example
│   ├── components.json
│   ├── eslint.config.mjs
│   ├── next-env.d.ts
│   ├── next.config.ts
│   ├── package.json
│   ├── postcss.config.mjs
│   ├── tsconfig.json
│   └── vitest.config.mts
├── infra/
│   └── nginx/
│       └── dev.conf
├── scripts/
│   ├── build-openapi.mjs
│   ├── check-api-scaffold.mjs
│   ├── prepare-monaco.mjs
│   ├── prepare-student-standalone.mjs
│   ├── validate-scaffold.mjs
│   └── write-structure.mjs
├── test/
│   ├── e2e/
│   │   ├── attempt.spec.ts
│   │   └── student.spec.ts
│   ├── support/
│   │   └── start-step2.mjs
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
├── playwright.config.ts
├── pnpm-lock.yaml
├── pnpm-workspace.yaml
├── README.md
├── redocly.yaml
├── tsconfig.base.json
└── tsconfig.test.json
```

254 source/configuration/documentation files in this inventory.

Steps 2–3 implement student authentication, dashboard, coding workspace, durable attempts and drafts. Judge, grading and admin management remain reserved contracts. The student App Router lives in frontend/src/app; components/features/services retain their original locations.
