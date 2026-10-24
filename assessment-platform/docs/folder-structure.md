# Complete source structure

Exactly three application packages; root folders hold documentation, contracts, tests, scripts and infrastructure.

Generated dependency caches, build output, private local state, installed assistant references, environment secrets and the regenerated Prisma client are excluded below.

```text
assessment-platform/
├── .github/
│   └── workflows/
├── admin/
│   ├── app/
│   │   ├── (console)/
│   │   │   ├── assessments/
│   │   │   │   ├── [id]/
│   │   │   │   │   └── page.tsx
│   │   │   │   ├── create/
│   │   │   │   │   └── page.tsx
│   │   │   │   └── page.tsx
│   │   │   ├── audit-logs/
│   │   │   │   └── page.tsx
│   │   │   ├── dashboard/
│   │   │   │   └── page.tsx
│   │   │   ├── questions/
│   │   │   │   ├── [id]/
│   │   │   │   │   └── edit/
│   │   │   │   │       └── page.tsx
│   │   │   │   ├── create/
│   │   │   │   │   └── page.tsx
│   │   │   │   └── page.tsx
│   │   │   ├── results/
│   │   │   │   └── page.tsx
│   │   │   ├── settings/
│   │   │   │   └── page.tsx
│   │   │   ├── students/
│   │   │   │   └── page.tsx
│   │   │   ├── submissions/
│   │   │   │   └── page.tsx
│   │   │   ├── error.tsx
│   │   │   ├── layout.tsx
│   │   │   └── loading.tsx
│   │   ├── login/
│   │   │   └── page.tsx
│   │   ├── error.tsx
│   │   ├── globals.css
│   │   ├── layout.tsx
│   │   └── page.tsx
│   ├── components/
│   │   ├── providers/
│   │   │   └── query-provider.tsx
│   │   ├── ui/
│   │   │   ├── button.tsx
│   │   │   └── management.tsx
│   │   ├── admin-shell.tsx
│   │   └── assessment-filter.tsx
│   ├── features/
│   │   ├── assessments/
│   │   │   ├── assessment-detail.tsx
│   │   │   ├── assessment-form.tsx
│   │   │   ├── assessment-list.tsx
│   │   │   └── README.md
│   │   ├── audit/
│   │   │   ├── audit-list.tsx
│   │   │   └── README.md
│   │   ├── auth/
│   │   │   ├── admin-login.tsx
│   │   │   └── README.md
│   │   ├── dashboard/
│   │   │   └── admin-dashboard.tsx
│   │   ├── questions/
│   │   │   ├── question-detail.tsx
│   │   │   ├── question-form.tsx
│   │   │   ├── question-list.tsx
│   │   │   └── README.md
│   │   ├── results/
│   │   │   ├── README.md
│   │   │   └── result-list.tsx
│   │   ├── settings/
│   │   │   └── settings-view.tsx
│   │   ├── students/
│   │   │   ├── README.md
│   │   │   └── student-list.tsx
│   │   └── submissions/
│   │       ├── README.md
│   │       └── submission-list.tsx
│   ├── hooks/
│   │   ├── README.md
│   │   └── use-admin.ts
│   ├── lib/
│   │   ├── env.ts
│   │   └── utils.ts
│   ├── services/
│   │   ├── api-client.contract.ts
│   │   ├── api-client.ts
│   │   └── server-session.ts
│   ├── test/
│   │   ├── admin-forms.test.tsx
│   │   ├── api-client.test.ts
│   │   ├── mutation-ordering.test.tsx
│   │   └── setup.ts
│   ├── types/
│   │   ├── admin.ts
│   │   ├── api.ts
│   │   └── questions.ts
│   ├── .env.example
│   ├── components.json
│   ├── Dockerfile
│   ├── eslint.config.mjs
│   ├── next-env.d.ts
│   ├── next.config.ts
│   ├── package.json
│   ├── postcss.config.mjs
│   ├── README.md
│   ├── tsconfig.json
│   └── vitest.config.mts
├── backend/
│   ├── .windsurf/
│   │   └── skills/
│   │       ├── prisma-cli
│   │       ├── prisma-client-api
│   │       ├── prisma-compute
│   │       ├── prisma-database-setup
│   │       ├── prisma-driver-adapter-implementation
│   │       ├── prisma-mongodb-upgrade
│   │       ├── prisma-orm-setup
│   │       ├── prisma-postgres
│   │       ├── prisma-postgres-setup
│   │       └── prisma-upgrade-v7
│   ├── prisma/
│   │   ├── migrations/
│   │   │   ├── 20261011000000_new_install_only/
│   │   │   │   └── migration.sql
│   │   │   ├── 20261011010000_student_dashboard/
│   │   │   │   └── migration.sql
│   │   │   ├── 20261012000000_public_question_examples/
│   │   │   │   └── migration.sql
│   │   │   ├── 20261012010000_execution_lifecycle/
│   │   │   │   └── migration.sql
│   │   │   ├── 20261013000000_admin_management/
│   │   │   │   └── migration.sql
│   │   │   └── migration_lock.toml
│   │   ├── collect-load-metrics.ts
│   │   ├── dev-seed.ts
│   │   ├── development-database.ts
│   │   ├── invariants.sql
│   │   ├── judge-fixtures.ts
│   │   ├── judge-seed.ts
│   │   ├── prepare-load-fixture.ts
│   │   ├── provision-admin.ts
│   │   ├── provision-student.ts
│   │   ├── runtime-grants.sql
│   │   ├── schema.prisma
│   │   ├── seed-judge.ts
│   │   ├── seed-local.ts
│   │   └── seed.ts
│   ├── sandbox/
│   │   ├── local/
│   │   │   └── Dockerfile
│   │   ├── toolchains/
│   │   │   ├── catalog.example.json
│   │   │   └── Dockerfile
│   │   └── README.md
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
│   │   │       ├── admin-body-parser.ts
│   │   │       ├── api-error.ts
│   │   │       └── api-response.ts
│   │   ├── config/
│   │   │   ├── environment.ts
│   │   │   └── worker-environment.ts
│   │   ├── database/
│   │   │   ├── admin-prisma.service.ts
│   │   │   ├── database.contract.ts
│   │   │   ├── database.module.ts
│   │   │   └── prisma.service.ts
│   │   ├── modules/
│   │   │   ├── admin/
│   │   │   │   ├── dto/
│   │   │   │   │   ├── admin.dto.ts
│   │   │   │   │   └── management-input.ts
│   │   │   │   ├── policies/
│   │   │   │   │   └── admin.policy.ts
│   │   │   │   ├── repositories/
│   │   │   │   │   ├── admin.repository.ts
│   │   │   │   │   └── management.repository.ts
│   │   │   │   ├── test/
│   │   │   │   │   └── admin.spec.ts
│   │   │   │   ├── admin-reporting.service.ts
│   │   │   │   ├── admin.controller.ts
│   │   │   │   ├── admin.module.ts
│   │   │   │   ├── admin.service.ts
│   │   │   │   ├── assessment-management.service.ts
│   │   │   │   └── question-management.service.ts
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
│   │   │   │   ├── attempt-heartbeat.controller.ts
│   │   │   │   ├── attempt-heartbeat.service.ts
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
│   │   │   │   ├── execution-availability.ts
│   │   │   │   ├── execution.controller.ts
│   │   │   │   ├── execution.module.ts
│   │   │   │   ├── execution.service.ts
│   │   │   │   └── grading.ts
│   │   │   ├── health/
│   │   │   │   ├── health.controller.ts
│   │   │   │   ├── health.module.ts
│   │   │   │   └── health.service.ts
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
│   │   │       │   ├── create-submission.dto.ts
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
│   │   │   ├── execution-queues.ts
│   │   │   └── queue.contracts.ts
│   │   ├── workers/
│   │   │   ├── finalization/
│   │   │   │   └── finalization-worker.contract.ts
│   │   │   ├── judge/
│   │   │   │   ├── judge-service.ts
│   │   │   │   ├── judge-worker.contract.ts
│   │   │   │   ├── main.ts
│   │   │   │   ├── sandbox.contract.ts
│   │   │   │   ├── security.spec.ts
│   │   │   │   ├── source-adapter.ts
│   │   │   │   └── testcase-crypto.ts
│   │   │   ├── outbox/
│   │   │   │   ├── grading-cutoff.ts
│   │   │   │   ├── main.ts
│   │   │   │   ├── outbox-dispatcher.ts
│   │   │   │   └── outbox-worker.contract.ts
│   │   │   ├── sandbox/
│   │   │   │   ├── broker-client.ts
│   │   │   │   ├── broker.ts
│   │   │   │   ├── docker-engine.ts
│   │   │   │   ├── protocol.ts
│   │   │   │   ├── reaper.ts
│   │   │   │   └── toolchain-catalog.ts
│   │   │   ├── README.md
│   │   │   └── worker-context.ts
│   │   ├── app.module.ts
│   │   └── main.ts
│   ├── test/
│   │   ├── judge/
│   │   │   ├── crash-worker.cjs
│   │   │   └── real-judge.spec.ts
│   │   ├── support/
│   │   │   ├── contract-broker.ts
│   │   │   └── step4-context.ts
│   │   ├── admin-body-parser.spec.ts
│   │   ├── admin.integration.spec.ts
│   │   ├── attempts.integration.spec.ts
│   │   ├── auth-identity.spec.ts
│   │   ├── auth-security.spec.ts
│   │   ├── environment.spec.ts
│   │   ├── execution.integration.spec.ts
│   │   ├── health.spec.ts
│   │   ├── heartbeat.integration.spec.ts
│   │   ├── local-seed.integration.spec.ts
│   │   ├── README.md
│   │   ├── seed-cli.integration.spec.ts
│   │   └── student.integration.spec.ts
│   ├── .env.example
│   ├── .env.judge-gate.example
│   ├── .env.judge.example
│   ├── .env.maintenance.example
│   ├── .env.sandbox.example
│   ├── Dockerfile
│   ├── eslint.config.mjs
│   ├── jest.config.cjs
│   ├── jest.judge.config.cjs
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
│   ├── judge-test-gate.md
│   ├── local-development.md
│   ├── local-verification.md
│   ├── question-allocation.md
│   ├── step-1-readme.md
│   ├── step-2-validation.md
│   ├── step-2.md
│   ├── step-3-validation.md
│   ├── step-3.md
│   ├── step-4-validation.md
│   ├── step-4.md
│   ├── step-5-deployment.md
│   ├── step-5-load-testing.md
│   ├── step-5-security.md
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
│   │   │   ├── use-draft-autosave.ts
│   │   │   └── use-execution.ts
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
│   │   ├── execution.test.tsx
│   │   ├── login-form.test.tsx
│   │   └── setup.ts
│   ├── types/
│   │   └── api.ts
│   ├── .env.example
│   ├── components.json
│   ├── Dockerfile
│   ├── eslint.config.mjs
│   ├── next-env.d.ts
│   ├── next.config.ts
│   ├── package.json
│   ├── postcss.config.mjs
│   ├── tsconfig.json
│   └── vitest.config.mts
├── infra/
│   ├── backup/
│   │   ├── backup.sh
│   │   └── restore-test.sh
│   ├── deploy/
│   │   ├── .env.example
│   │   ├── admin-api.env.example
│   │   ├── api.env.example
│   │   ├── Caddyfile
│   │   ├── docker-compose.judge.yml
│   │   ├── docker-compose.prod.yml
│   │   └── migration.env.example
│   ├── monitoring/
│   │   ├── alerts.yml
│   │   ├── blackbox.yml
│   │   └── prometheus.yml
│   ├── nginx/
│   │   └── dev.conf
│   └── systemd/
│       ├── assessment-sandbox-reaper.service
│       ├── assessment-sandbox-reaper.timer
│       └── assessment-sandbox.service
├── patches/
│   └── braces@3.0.3.patch
├── scripts/
│   ├── load/
│   │   └── assessment.k6.js
│   ├── local/
│   │   ├── assets.mjs
│   │   ├── check.mjs
│   │   ├── environment.mjs
│   │   ├── judge.mjs
│   │   ├── runtime.mjs
│   │   └── service.mjs
│   ├── railway/
│   │   ├── postgres/
│   │   │   ├── .dockerignore
│   │   │   ├── Dockerfile
│   │   │   ├── init-ssl.sh
│   │   │   └── README.md
│   │   ├── certificate.mjs
│   │   ├── cli.mjs
│   │   ├── database.mjs
│   │   └── responses.mjs
│   ├── admin-openapi.mjs
│   ├── audit-dependencies.mjs
│   ├── build-openapi.mjs
│   ├── build-toolchains.mjs
│   ├── check-api-scaffold.mjs
│   ├── check-deployment.mjs
│   ├── check-railway-image.mjs
│   ├── create-development-judge-keyring.mjs
│   ├── dependency-remediations.mjs
│   ├── local.mjs
│   ├── prepare-admin-standalone.mjs
│   ├── prepare-monaco.mjs
│   ├── prepare-student-standalone.mjs
│   ├── railway.mjs
│   ├── run-load-test.mjs
│   ├── start-admin.mjs
│   ├── validate-scaffold.mjs
│   └── write-structure.mjs
├── test/
│   ├── e2e/
│   │   ├── admin-workflow.spec.ts
│   │   ├── attempt.spec.ts
│   │   └── student.spec.ts
│   ├── support/
│   │   └── start-step2.mjs
│   ├── contracts.test.mjs
│   ├── dependency-remediations.test.mjs
│   ├── deployment.test.mjs
│   ├── gate-cache.test.mjs
│   ├── local-startup.test.mjs
│   ├── migration.test.mjs
│   ├── railway-certificate.test.mjs
│   ├── railway-database.test.mjs
│   ├── railway-responses.test.mjs
│   └── step4-permissions.test.mjs
├── .dockerignore
├── .editorconfig
├── .env.example
├── .final-admin-tests.log
├── .final-api-smoke.log
├── .final-backend-tests.log
├── .final-build.log
├── .final-dependency-fix.log
├── .final-e2e.log
├── .final-format.log
├── .final-frontend-tests.log
├── .final-readme-format.log
├── .final-regression-tests.log
├── .final-security-audit-prod.log
├── .final-security-audit.log
├── .final-seed-tests.log
├── .final-validate.log
├── .gitattributes
├── .gitignore
├── .node-version
├── .npmrc
├── .nvmrc
├── .prettierignore
├── .prettierrc.json
├── .step5-admin-build.log
├── .step5-admin-integration.log
├── .step5-admin-test-format.log
├── .step5-admin-test-lint.log
├── .step5-audit-full.log
├── .step5-audit-prod.log
├── .step5-auth-format.log
├── .step5-auth-identity.log
├── .step5-auth-lint.log
├── .step5-auth-prisma.log
├── .step5-auth-tests.log
├── .step5-auth-types.log
├── .step5-backend-build.log
├── .step5-backend-types.log
├── .step5-contracts-final.log
├── .step5-contracts.log
├── .step5-dependency-audit.log
├── .step5-dependency-install.log
├── .step5-devops-format-final.log
├── .step5-devops-format.log
├── .step5-devops-lint.log
├── .step5-devops-test.log
├── .step5-devops-types.log
├── .step5-e2e-exit-probe.log
├── .step5-e2e-initial.log
├── .step5-e2e.log
├── .step5-format-final.log
├── .step5-format-security.log
├── .step5-format.log
├── .step5-frontend-build.log
├── .step5-schema.log
├── .step5-types-merged.log
├── .step5-validate.log
├── docker-compose.judge.local.yml
├── docker-compose.local.yml
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

484 source/configuration/documentation files in this inventory.

The applications implement student authentication, dashboard, coding workspace, durable attempts/drafts, execution orchestration, grading and separate administration. The gVisor judge has an independent Linux release gate. The student App Router lives in frontend/src/app; components/features/services retain their original locations. See [the project walkthrough](../../praduman.md) for the complete flow, configuration provenance and production requirements.
