-- NEW INSTALL ONLY. Existing identities require introspection and a separate additive baseline.
-- No database was changed while generating this migration.
BEGIN;
DO $$ BEGIN
  IF to_regclass('users') IS NOT NULL THEN
    RAISE EXCEPTION 'Existing users table detected. Stop and follow docs/database.md adoption strategy.';
  END IF;
END $$;

-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateEnum
CREATE TYPE "Role" AS ENUM ('STUDENT', 'ADMIN');

-- CreateEnum
CREATE TYPE "AssessmentStatus" AS ENUM ('DRAFT', 'SCHEDULED', 'OPEN', 'CLOSED', 'CANCELLED', 'ARCHIVED');

-- CreateEnum
CREATE TYPE "AttemptStatus" AS ENUM ('IN_PROGRESS', 'FINALIZING', 'FINALIZED', 'VOIDED');

-- CreateEnum
CREATE TYPE "SubmissionStatus" AS ENUM ('PENDING', 'QUEUED', 'RUNNING', 'COMPLETED', 'INFRASTRUCTURE_FAILED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "SubmissionPurpose" AS ENUM ('RUN_PUBLIC', 'SUBMIT', 'FINAL');

-- CreateEnum
CREATE TYPE "Verdict" AS ENUM ('ACCEPTED', 'WRONG_ANSWER', 'TIME_LIMIT_EXCEEDED', 'MEMORY_LIMIT_EXCEEDED', 'OUTPUT_LIMIT_EXCEEDED', 'COMPILATION_ERROR', 'RUNTIME_ERROR', 'INTERNAL_ERROR');

-- CreateEnum
CREATE TYPE "Difficulty" AS ENUM ('EASY', 'MEDIUM', 'HARD');

-- CreateEnum
CREATE TYPE "Language" AS ENUM ('PYTHON', 'JAVA', 'CPP');

-- CreateEnum
CREATE TYPE "QuestionVersionStatus" AS ENUM ('DRAFT', 'PUBLISHED');

-- CreateEnum
CREATE TYPE "TestCaseVisibility" AS ENUM ('PUBLIC', 'HIDDEN');

-- CreateEnum
CREATE TYPE "AssignmentStatus" AS ENUM ('ASSIGNED', 'REVOKED');

-- CreateEnum
CREATE TYPE "FinalizationReason" AS ENUM ('STUDENT', 'EXPIRED', 'ADMIN_VOID');

-- CreateEnum
CREATE TYPE "ResultStatus" AS ENUM ('PENDING', 'COMPLETE', 'REQUIRES_REVIEW');

-- CreateEnum
CREATE TYPE "OutboxStatus" AS ENUM ('PENDING', 'DISPATCHED');

-- CreateTable
CREATE TABLE "users" (
    "id" UUID NOT NULL,
    "email" VARCHAR(320) NOT NULL,
    "password_hash" TEXT NOT NULL,
    "role" "Role" NOT NULL,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "auth_version" INTEGER NOT NULL DEFAULT 1,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "students" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "external_id" VARCHAR(128) NOT NULL,
    "display_name" VARCHAR(200) NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "students_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "admins" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "display_name" VARCHAR(200) NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "admins_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "assessments" (
    "id" UUID NOT NULL,
    "title" VARCHAR(200) NOT NULL,
    "status" "AssessmentStatus" NOT NULL DEFAULT 'DRAFT',
    "opens_at" TIMESTAMPTZ(3),
    "latest_start_at" TIMESTAMPTZ(3),
    "closes_at" TIMESTAMPTZ(3),
    "results_release_at" TIMESTAMPTZ(3),
    "revision" INTEGER NOT NULL DEFAULT 1,
    "created_by_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "assessments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "assessment_rules" (
    "id" UUID NOT NULL,
    "assessment_id" UUID NOT NULL,
    "duration_seconds" INTEGER NOT NULL DEFAULT 10800,
    "easy_count" INTEGER NOT NULL DEFAULT 2,
    "medium_count" INTEGER NOT NULL DEFAULT 1,
    "hard_count" INTEGER NOT NULL DEFAULT 1,
    "allowed_languages" "Language"[] DEFAULT ARRAY['PYTHON', 'JAVA', 'CPP']::"Language"[],
    "max_source_bytes" INTEGER NOT NULL DEFAULT 65536,
    "grading_policy_version" VARCHAR(64) NOT NULL DEFAULT 'v1-final-snapshot',
    "allocation_policy_version" VARCHAR(64) NOT NULL DEFAULT 'v1-uniform-stratified',
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "assessment_rules_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "questions" (
    "id" UUID NOT NULL,
    "slug" VARCHAR(200) NOT NULL,
    "archived_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "questions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "question_topics" (
    "question_id" UUID NOT NULL,
    "topic" VARCHAR(100) NOT NULL,

    CONSTRAINT "question_topics_pkey" PRIMARY KEY ("question_id","topic")
);

-- CreateTable
CREATE TABLE "question_versions" (
    "id" UUID NOT NULL,
    "question_id" UUID NOT NULL,
    "version" INTEGER NOT NULL,
    "status" "QuestionVersionStatus" NOT NULL DEFAULT 'DRAFT',
    "title" VARCHAR(200) NOT NULL,
    "difficulty" "Difficulty" NOT NULL,
    "statement" TEXT NOT NULL,
    "input_format" TEXT NOT NULL,
    "output_format" TEXT NOT NULL,
    "constraints" TEXT NOT NULL,
    "explanation" TEXT,
    "cpu_time_ms" INTEGER NOT NULL DEFAULT 2000,
    "wall_time_ms" INTEGER NOT NULL DEFAULT 10000,
    "memory_limit_kib" INTEGER NOT NULL DEFAULT 262144,
    "output_limit_bytes" INTEGER NOT NULL DEFAULT 65536,
    "max_score" DECIMAL(10,2) NOT NULL DEFAULT 100,
    "content_hash" CHAR(64),
    "published_at" TIMESTAMPTZ(3),
    "created_by_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "question_versions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "question_templates" (
    "id" UUID NOT NULL,
    "question_version_id" UUID NOT NULL,
    "language" "Language" NOT NULL,
    "starter_code" TEXT NOT NULL,
    "toolchain_id" VARCHAR(128) NOT NULL,

    CONSTRAINT "question_templates_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "test_cases" (
    "id" UUID NOT NULL,
    "question_version_id" UUID NOT NULL,
    "ordinal" INTEGER NOT NULL,
    "visibility" "TestCaseVisibility" NOT NULL,
    "input_ciphertext" BYTEA NOT NULL,
    "expected_output_ciphertext" BYTEA NOT NULL,
    "encryption_key_id" VARCHAR(128) NOT NULL,
    "integrity_hash" CHAR(64) NOT NULL,
    "weight" DECIMAL(10,2) NOT NULL DEFAULT 1,

    CONSTRAINT "test_cases_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "assessment_pool_questions" (
    "assessment_id" UUID NOT NULL,
    "question_version_id" UUID NOT NULL,
    "question_id" UUID NOT NULL,

    CONSTRAINT "assessment_pool_questions_pkey" PRIMARY KEY ("assessment_id","question_version_id","question_id")
);

-- CreateTable
CREATE TABLE "assessment_assignments" (
    "id" UUID NOT NULL,
    "assessment_id" UUID NOT NULL,
    "student_id" UUID NOT NULL,
    "status" "AssignmentStatus" NOT NULL DEFAULT 'ASSIGNED',
    "assigned_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "assessment_assignments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "assessment_attempts" (
    "id" UUID NOT NULL,
    "assignment_id" UUID NOT NULL,
    "student_id" UUID NOT NULL,
    "assessment_id" UUID NOT NULL,
    "status" "AttemptStatus" NOT NULL DEFAULT 'IN_PROGRESS',
    "started_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expires_at" TIMESTAMPTZ(3) NOT NULL,
    "finalized_at" TIMESTAMPTZ(3),
    "finalization_reason" "FinalizationReason",
    "state_version" INTEGER NOT NULL DEFAULT 1,
    "rule_snapshot" JSONB NOT NULL,
    "allocation_manifest_hash" CHAR(64) NOT NULL,

    CONSTRAINT "assessment_attempts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "attempt_questions" (
    "id" UUID NOT NULL,
    "attempt_id" UUID NOT NULL,
    "assessment_id" UUID NOT NULL,
    "question_id" UUID NOT NULL,
    "question_version_id" UUID NOT NULL,
    "position" INTEGER NOT NULL,
    "selected_language" "Language" NOT NULL DEFAULT 'PYTHON',
    "final_submission_id" UUID,

    CONSTRAINT "attempt_questions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "code_drafts" (
    "id" UUID NOT NULL,
    "attempt_question_id" UUID NOT NULL,
    "attempt_id" UUID NOT NULL,
    "language" "Language" NOT NULL,
    "source_code" TEXT NOT NULL,
    "source_hash" CHAR(64) NOT NULL,
    "revision" INTEGER NOT NULL DEFAULT 1,
    "saved_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "code_drafts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "submissions" (
    "id" UUID NOT NULL,
    "attempt_question_id" UUID NOT NULL,
    "attempt_id" UUID NOT NULL,
    "question_version_id" UUID NOT NULL,
    "purpose" "SubmissionPurpose" NOT NULL,
    "language" "Language" NOT NULL,
    "source_code" TEXT NOT NULL,
    "source_hash" CHAR(64) NOT NULL,
    "idempotency_key" VARCHAR(128) NOT NULL,
    "request_hash" CHAR(64) NOT NULL,
    "status" "SubmissionStatus" NOT NULL DEFAULT 'PENDING',
    "state_version" INTEGER NOT NULL DEFAULT 1,
    "judge_generation" INTEGER NOT NULL DEFAULT 1,
    "judge_lease_token" UUID,
    "lease_expires_at" TIMESTAMPTZ(3),
    "accepted_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completed_at" TIMESTAMPTZ(3),

    CONSTRAINT "submissions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "submission_results" (
    "id" UUID NOT NULL,
    "submission_id" UUID NOT NULL,
    "verdict" "Verdict" NOT NULL,
    "passed_count" INTEGER NOT NULL,
    "total_count" INTEGER NOT NULL,
    "score" DECIMAL(10,2) NOT NULL,
    "cpu_time_ms" INTEGER,
    "memory_kib" INTEGER,
    "public_case_results" JSONB,
    "internal_diagnostics_ciphertext" BYTEA,
    "diagnostics_key_id" VARCHAR(128),
    "judge_generation" INTEGER NOT NULL,
    "toolchain_digest" VARCHAR(128) NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "submission_results_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "assessment_results" (
    "id" UUID NOT NULL,
    "attempt_id" UUID NOT NULL,
    "status" "ResultStatus" NOT NULL DEFAULT 'PENDING',
    "total_score" DECIMAL(10,2),
    "maximum_score" DECIMAL(10,2) NOT NULL,
    "grading_policy_version" VARCHAR(64) NOT NULL,
    "computed_at" TIMESTAMPTZ(3),
    "released_at" TIMESTAMPTZ(3),

    CONSTRAINT "assessment_results_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "audit_logs" (
    "id" UUID NOT NULL,
    "actor_user_id" UUID,
    "action" VARCHAR(100) NOT NULL,
    "entity_type" VARCHAR(100) NOT NULL,
    "entity_id" VARCHAR(128),
    "request_id" VARCHAR(128) NOT NULL,
    "metadata" JSONB NOT NULL,
    "occurred_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "audit_logs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "auth_sessions" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "token_hash" CHAR(64) NOT NULL,
    "csrf_token_hash" CHAR(64) NOT NULL,
    "auth_version" INTEGER NOT NULL,
    "expires_at" TIMESTAMPTZ(3) NOT NULL,
    "revoked_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "auth_sessions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "outbox_events" (
    "id" UUID NOT NULL,
    "event_type" VARCHAR(100) NOT NULL,
    "aggregate_id" UUID NOT NULL,
    "dedupe_key" VARCHAR(200) NOT NULL,
    "payload" JSONB NOT NULL,
    "status" "OutboxStatus" NOT NULL DEFAULT 'PENDING',
    "available_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "dispatched_at" TIMESTAMPTZ(3),

    CONSTRAINT "outbox_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "idempotency_records" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "operation" VARCHAR(200) NOT NULL,
    "key" VARCHAR(128) NOT NULL,
    "request_hash" CHAR(64) NOT NULL,
    "response_code" INTEGER NOT NULL,
    "response_body" JSONB NOT NULL,
    "expires_at" TIMESTAMPTZ(3) NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "idempotency_records_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "users_email_key" ON "users"("email");

-- CreateIndex
CREATE UNIQUE INDEX "students_user_id_key" ON "students"("user_id");

-- CreateIndex
CREATE UNIQUE INDEX "students_external_id_key" ON "students"("external_id");

-- CreateIndex
CREATE UNIQUE INDEX "admins_user_id_key" ON "admins"("user_id");

-- CreateIndex
CREATE INDEX "assessments_status_opens_at_idx" ON "assessments"("status", "opens_at");

-- CreateIndex
CREATE INDEX "assessments_created_by_id_idx" ON "assessments"("created_by_id");

-- CreateIndex
CREATE UNIQUE INDEX "assessment_rules_assessment_id_key" ON "assessment_rules"("assessment_id");

-- CreateIndex
CREATE UNIQUE INDEX "questions_slug_key" ON "questions"("slug");

-- CreateIndex
CREATE INDEX "question_topics_topic_question_id_idx" ON "question_topics"("topic", "question_id");

-- CreateIndex
CREATE INDEX "question_versions_status_difficulty_idx" ON "question_versions"("status", "difficulty");

-- CreateIndex
CREATE INDEX "question_versions_created_by_id_idx" ON "question_versions"("created_by_id");

-- CreateIndex
CREATE UNIQUE INDEX "question_versions_question_id_version_key" ON "question_versions"("question_id", "version");

-- CreateIndex
CREATE UNIQUE INDEX "question_versions_id_question_id_key" ON "question_versions"("id", "question_id");

-- CreateIndex
CREATE UNIQUE INDEX "question_templates_question_version_id_language_key" ON "question_templates"("question_version_id", "language");

-- CreateIndex
CREATE INDEX "test_cases_question_version_id_visibility_idx" ON "test_cases"("question_version_id", "visibility");

-- CreateIndex
CREATE UNIQUE INDEX "test_cases_question_version_id_ordinal_key" ON "test_cases"("question_version_id", "ordinal");

-- CreateIndex
CREATE INDEX "assessment_pool_questions_question_version_id_question_id_idx" ON "assessment_pool_questions"("question_version_id", "question_id");

-- CreateIndex
CREATE UNIQUE INDEX "assessment_pool_questions_assessment_id_question_id_key" ON "assessment_pool_questions"("assessment_id", "question_id");

-- CreateIndex
CREATE INDEX "assessment_assignments_student_id_status_idx" ON "assessment_assignments"("student_id", "status");

-- CreateIndex
CREATE UNIQUE INDEX "assessment_assignments_assessment_id_student_id_key" ON "assessment_assignments"("assessment_id", "student_id");

-- CreateIndex
CREATE UNIQUE INDEX "assessment_assignments_id_student_id_assessment_id_key" ON "assessment_assignments"("id", "student_id", "assessment_id");

-- CreateIndex
CREATE UNIQUE INDEX "assessment_attempts_assignment_id_key" ON "assessment_attempts"("assignment_id");

-- CreateIndex
CREATE INDEX "assessment_attempts_status_expires_at_idx" ON "assessment_attempts"("status", "expires_at");

-- CreateIndex
CREATE INDEX "assessment_attempts_student_id_started_at_idx" ON "assessment_attempts"("student_id", "started_at" DESC);

-- CreateIndex
CREATE UNIQUE INDEX "assessment_attempts_assessment_id_student_id_key" ON "assessment_attempts"("assessment_id", "student_id");

-- CreateIndex
CREATE UNIQUE INDEX "assessment_attempts_id_assessment_id_key" ON "assessment_attempts"("id", "assessment_id");

-- CreateIndex
CREATE UNIQUE INDEX "assessment_attempts_assignment_id_student_id_assessment_id_key" ON "assessment_attempts"("assignment_id", "student_id", "assessment_id");

-- CreateIndex
CREATE UNIQUE INDEX "attempt_questions_final_submission_id_key" ON "attempt_questions"("final_submission_id");

-- CreateIndex
CREATE INDEX "attempt_questions_assessment_id_question_version_id_questio_idx" ON "attempt_questions"("assessment_id", "question_version_id", "question_id");

-- CreateIndex
CREATE INDEX "attempt_questions_question_version_id_question_id_idx" ON "attempt_questions"("question_version_id", "question_id");

-- CreateIndex
CREATE UNIQUE INDEX "attempt_questions_attempt_id_position_key" ON "attempt_questions"("attempt_id", "position");

-- CreateIndex
CREATE UNIQUE INDEX "attempt_questions_attempt_id_question_id_key" ON "attempt_questions"("attempt_id", "question_id");

-- CreateIndex
CREATE UNIQUE INDEX "attempt_questions_id_attempt_id_key" ON "attempt_questions"("id", "attempt_id");

-- CreateIndex
CREATE UNIQUE INDEX "attempt_questions_id_attempt_id_question_version_id_key" ON "attempt_questions"("id", "attempt_id", "question_version_id");

-- CreateIndex
CREATE INDEX "code_drafts_attempt_id_idx" ON "code_drafts"("attempt_id");

-- CreateIndex
CREATE UNIQUE INDEX "code_drafts_attempt_question_id_language_key" ON "code_drafts"("attempt_question_id", "language");

-- CreateIndex
CREATE INDEX "submissions_attempt_question_id_accepted_at_idx" ON "submissions"("attempt_question_id", "accepted_at" DESC);

-- CreateIndex
CREATE INDEX "submissions_status_accepted_at_idx" ON "submissions"("status", "accepted_at");

-- CreateIndex
CREATE INDEX "submissions_status_lease_expires_at_idx" ON "submissions"("status", "lease_expires_at");

-- CreateIndex
CREATE INDEX "submissions_question_version_id_idx" ON "submissions"("question_version_id");

-- CreateIndex
CREATE UNIQUE INDEX "submissions_attempt_id_idempotency_key_key" ON "submissions"("attempt_id", "idempotency_key");

-- CreateIndex
CREATE UNIQUE INDEX "submission_results_submission_id_key" ON "submission_results"("submission_id");

-- CreateIndex
CREATE UNIQUE INDEX "assessment_results_attempt_id_key" ON "assessment_results"("attempt_id");

-- CreateIndex
CREATE INDEX "assessment_results_status_computed_at_idx" ON "assessment_results"("status", "computed_at");

-- CreateIndex
CREATE INDEX "audit_logs_actor_user_id_occurred_at_idx" ON "audit_logs"("actor_user_id", "occurred_at" DESC);

-- CreateIndex
CREATE INDEX "audit_logs_entity_type_entity_id_occurred_at_idx" ON "audit_logs"("entity_type", "entity_id", "occurred_at" DESC);

-- CreateIndex
CREATE INDEX "audit_logs_occurred_at_idx" ON "audit_logs"("occurred_at");

-- CreateIndex
CREATE UNIQUE INDEX "auth_sessions_token_hash_key" ON "auth_sessions"("token_hash");

-- CreateIndex
CREATE INDEX "auth_sessions_user_id_revoked_at_idx" ON "auth_sessions"("user_id", "revoked_at");

-- CreateIndex
CREATE INDEX "auth_sessions_expires_at_idx" ON "auth_sessions"("expires_at");

-- CreateIndex
CREATE UNIQUE INDEX "outbox_events_dedupe_key_key" ON "outbox_events"("dedupe_key");

-- CreateIndex
CREATE INDEX "outbox_events_status_available_at_created_at_idx" ON "outbox_events"("status", "available_at", "created_at");

-- CreateIndex
CREATE INDEX "idempotency_records_expires_at_idx" ON "idempotency_records"("expires_at");

-- CreateIndex
CREATE UNIQUE INDEX "idempotency_records_user_id_operation_key_key" ON "idempotency_records"("user_id", "operation", "key");

-- AddForeignKey
ALTER TABLE "students" ADD CONSTRAINT "students_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "admins" ADD CONSTRAINT "admins_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "assessments" ADD CONSTRAINT "assessments_created_by_id_fkey" FOREIGN KEY ("created_by_id") REFERENCES "admins"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "assessment_rules" ADD CONSTRAINT "assessment_rules_assessment_id_fkey" FOREIGN KEY ("assessment_id") REFERENCES "assessments"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "question_topics" ADD CONSTRAINT "question_topics_question_id_fkey" FOREIGN KEY ("question_id") REFERENCES "questions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "question_versions" ADD CONSTRAINT "question_versions_question_id_fkey" FOREIGN KEY ("question_id") REFERENCES "questions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "question_versions" ADD CONSTRAINT "question_versions_created_by_id_fkey" FOREIGN KEY ("created_by_id") REFERENCES "admins"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "question_templates" ADD CONSTRAINT "question_templates_question_version_id_fkey" FOREIGN KEY ("question_version_id") REFERENCES "question_versions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "test_cases" ADD CONSTRAINT "test_cases_question_version_id_fkey" FOREIGN KEY ("question_version_id") REFERENCES "question_versions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "assessment_pool_questions" ADD CONSTRAINT "assessment_pool_questions_assessment_id_fkey" FOREIGN KEY ("assessment_id") REFERENCES "assessments"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "assessment_pool_questions" ADD CONSTRAINT "assessment_pool_questions_question_version_id_question_id_fkey" FOREIGN KEY ("question_version_id", "question_id") REFERENCES "question_versions"("id", "question_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "assessment_assignments" ADD CONSTRAINT "assessment_assignments_assessment_id_fkey" FOREIGN KEY ("assessment_id") REFERENCES "assessments"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "assessment_assignments" ADD CONSTRAINT "assessment_assignments_student_id_fkey" FOREIGN KEY ("student_id") REFERENCES "students"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "assessment_attempts" ADD CONSTRAINT "assessment_attempts_assignment_id_student_id_assessment_id_fkey" FOREIGN KEY ("assignment_id", "student_id", "assessment_id") REFERENCES "assessment_assignments"("id", "student_id", "assessment_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "assessment_attempts" ADD CONSTRAINT "assessment_attempts_student_id_fkey" FOREIGN KEY ("student_id") REFERENCES "students"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "assessment_attempts" ADD CONSTRAINT "assessment_attempts_assessment_id_fkey" FOREIGN KEY ("assessment_id") REFERENCES "assessments"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "attempt_questions" ADD CONSTRAINT "attempt_questions_attempt_id_assessment_id_fkey" FOREIGN KEY ("attempt_id", "assessment_id") REFERENCES "assessment_attempts"("id", "assessment_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "attempt_questions" ADD CONSTRAINT "attempt_questions_assessment_id_question_version_id_questi_fkey" FOREIGN KEY ("assessment_id", "question_version_id", "question_id") REFERENCES "assessment_pool_questions"("assessment_id", "question_version_id", "question_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "attempt_questions" ADD CONSTRAINT "attempt_questions_question_version_id_question_id_fkey" FOREIGN KEY ("question_version_id", "question_id") REFERENCES "question_versions"("id", "question_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "attempt_questions" ADD CONSTRAINT "attempt_questions_final_submission_id_fkey" FOREIGN KEY ("final_submission_id") REFERENCES "submissions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "code_drafts" ADD CONSTRAINT "code_drafts_attempt_question_id_attempt_id_fkey" FOREIGN KEY ("attempt_question_id", "attempt_id") REFERENCES "attempt_questions"("id", "attempt_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "submissions" ADD CONSTRAINT "submissions_attempt_question_id_attempt_id_question_versio_fkey" FOREIGN KEY ("attempt_question_id", "attempt_id", "question_version_id") REFERENCES "attempt_questions"("id", "attempt_id", "question_version_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "submission_results" ADD CONSTRAINT "submission_results_submission_id_fkey" FOREIGN KEY ("submission_id") REFERENCES "submissions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "assessment_results" ADD CONSTRAINT "assessment_results_attempt_id_fkey" FOREIGN KEY ("attempt_id") REFERENCES "assessment_attempts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "audit_logs" ADD CONSTRAINT "audit_logs_actor_user_id_fkey" FOREIGN KEY ("actor_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "auth_sessions" ADD CONSTRAINT "auth_sessions_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "idempotency_records" ADD CONSTRAINT "idempotency_records_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Appended to the new-install migration. Adoption into existing databases needs separate review.
ALTER TABLE assessment_rules ADD CONSTRAINT fixed_exam_rule CHECK (
  duration_seconds = 10800 AND easy_count = 2 AND medium_count = 1 AND hard_count = 1
  AND max_source_bytes = 65536
  AND cardinality(allowed_languages) = 3
  AND allowed_languages @> ARRAY['PYTHON','JAVA','CPP']::"Language"[]
);
ALTER TABLE assessments ADD CONSTRAINT full_duration_schedule CHECK (
  (status = 'DRAFT' AND opens_at IS NULL AND latest_start_at IS NULL AND closes_at IS NULL)
  OR (opens_at IS NOT NULL AND latest_start_at IS NOT NULL AND closes_at IS NOT NULL
      AND opens_at <= latest_start_at AND latest_start_at + interval '3 hours' <= closes_at
      AND results_release_at IS NOT NULL AND results_release_at >= closes_at)
  OR status = 'CANCELLED'
);
ALTER TABLE question_versions ADD CONSTRAINT question_resource_bounds CHECK (
  version > 0 AND cpu_time_ms BETWEEN 1 AND 10000 AND wall_time_ms BETWEEN cpu_time_ms AND 30000
  AND memory_limit_kib BETWEEN 16384 AND 1048576 AND output_limit_bytes BETWEEN 1024 AND 65536
  AND max_score > 0
  AND (status = 'DRAFT' OR (content_hash IS NOT NULL AND published_at IS NOT NULL))
);
ALTER TABLE test_cases ADD CONSTRAINT positive_case_weight CHECK (ordinal > 0 AND weight > 0);
ALTER TABLE attempt_questions ADD CONSTRAINT question_position CHECK (position BETWEEN 1 AND 4);
ALTER TABLE code_drafts ADD CONSTRAINT draft_bounds CHECK (revision >= 1 AND octet_length(source_code) <= 65536);
ALTER TABLE submissions ADD CONSTRAINT submission_bounds CHECK (state_version >= 1 AND judge_generation >= 1 AND octet_length(source_code) <= 65536);
ALTER TABLE assessment_attempts ADD CONSTRAINT attempt_duration CHECK (
  expires_at = started_at + interval '3 hours'
  AND state_version >= 1
  AND (status NOT IN ('FINALIZED','VOIDED') OR finalized_at IS NOT NULL)
);
ALTER TABLE submission_results ADD CONSTRAINT result_counts CHECK (
  passed_count >= 0 AND total_count >= passed_count AND score >= 0
);
ALTER TABLE assessment_results ADD CONSTRAINT assessment_score_bounds CHECK (
  maximum_score > 0 AND (total_score IS NULL OR (total_score >= 0 AND total_score <= maximum_score))
  AND (status <> 'COMPLETE' OR (total_score IS NOT NULL AND computed_at IS NOT NULL))
);

-- Parent locks serialize publication against all template/case changes.
CREATE FUNCTION protect_question_children() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE parent_id uuid; parent_status "QuestionVersionStatus";
BEGIN
  IF TG_OP <> 'INSERT' THEN
    parent_id := OLD.question_version_id;
    SELECT status INTO parent_status FROM question_versions WHERE id = parent_id FOR UPDATE;
    IF parent_status = 'PUBLISHED' THEN RAISE EXCEPTION 'Published question children are immutable'; END IF;
  END IF;
  IF TG_OP <> 'DELETE' THEN
    parent_id := NEW.question_version_id;
    SELECT status INTO parent_status FROM question_versions WHERE id = parent_id FOR UPDATE;
    IF parent_status = 'PUBLISHED' THEN RAISE EXCEPTION 'Published question children are immutable'; END IF;
  END IF;
  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER protect_templates BEFORE INSERT OR UPDATE OR DELETE ON question_templates
  FOR EACH ROW EXECUTE FUNCTION protect_question_children();
CREATE TRIGGER protect_cases BEFORE INSERT OR UPDATE OR DELETE ON test_cases
  FOR EACH ROW EXECUTE FUNCTION protect_question_children();

CREATE FUNCTION protect_question_version() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP <> 'INSERT' AND OLD.status = 'PUBLISHED' THEN
    RAISE EXCEPTION 'Published question versions are immutable; create a new version';
  END IF;
  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
  IF NEW.status = 'PUBLISHED' THEN
    IF TG_OP = 'INSERT' THEN RAISE EXCEPTION 'Create a draft before publication'; END IF;
    IF (SELECT count(*) FROM question_templates WHERE question_version_id = NEW.id) <> 3
       OR NOT EXISTS (SELECT 1 FROM test_cases WHERE question_version_id = NEW.id AND visibility = 'PUBLIC')
       OR NOT EXISTS (SELECT 1 FROM test_cases WHERE question_version_id = NEW.id AND visibility = 'HIDDEN') THEN
      RAISE EXCEPTION 'Publication requires three language templates and public and hidden cases';
    END IF;
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER immutable_question_version BEFORE INSERT OR UPDATE OR DELETE ON question_versions
  FOR EACH ROW EXECUTE FUNCTION protect_question_version();

CREATE FUNCTION protect_assessment_children() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE parent_status "AssessmentStatus";
BEGIN
  IF TG_OP <> 'INSERT' THEN
    SELECT status INTO parent_status FROM assessments WHERE id = OLD.assessment_id FOR UPDATE;
    IF parent_status <> 'DRAFT' THEN RAISE EXCEPTION 'Scheduled assessment rules and pool are frozen'; END IF;
  END IF;
  IF TG_OP <> 'DELETE' THEN
    SELECT status INTO parent_status FROM assessments WHERE id = NEW.assessment_id FOR UPDATE;
    IF parent_status <> 'DRAFT' THEN RAISE EXCEPTION 'Scheduled assessment rules and pool are frozen'; END IF;
  END IF;
  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER frozen_rules BEFORE INSERT OR UPDATE OR DELETE ON assessment_rules
  FOR EACH ROW EXECUTE FUNCTION protect_assessment_children();
CREATE TRIGGER frozen_pool BEFORE INSERT OR UPDATE OR DELETE ON assessment_pool_questions
  FOR EACH ROW EXECUTE FUNCTION protect_assessment_children();

CREATE FUNCTION protect_assessment_schedule() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE easy_total integer; medium_total integer; hard_total integer;
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW.status <> 'DRAFT' THEN RAISE EXCEPTION 'Create a draft before scheduling'; END IF;
    RETURN NEW;
  END IF;
  IF OLD.status <> 'DRAFT' AND
    (NEW.title, NEW.opens_at, NEW.latest_start_at, NEW.closes_at, NEW.results_release_at, NEW.created_by_id)
    IS DISTINCT FROM
    (OLD.title, OLD.opens_at, OLD.latest_start_at, OLD.closes_at, OLD.results_release_at, OLD.created_by_id) THEN
    RAISE EXCEPTION 'Scheduled assessment configuration is immutable';
  END IF;
  IF NEW.status <> OLD.status AND NOT (
    (OLD.status = 'DRAFT' AND NEW.status IN ('SCHEDULED','CANCELLED')) OR
    (OLD.status = 'SCHEDULED' AND NEW.status IN ('OPEN','CANCELLED')) OR
    (OLD.status = 'OPEN' AND NEW.status IN ('CLOSED','CANCELLED')) OR
    (OLD.status = 'CLOSED' AND NEW.status = 'ARCHIVED')
  ) THEN RAISE EXCEPTION 'Invalid assessment status transition'; END IF;
  IF OLD.status = 'DRAFT' AND NEW.status = 'SCHEDULED' THEN
    IF NOT EXISTS (SELECT 1 FROM assessment_rules WHERE assessment_id = NEW.id) THEN
      RAISE EXCEPTION 'Scheduling requires a rule';
    END IF;
    IF EXISTS (SELECT 1 FROM assessment_pool_questions p JOIN question_versions v ON v.id = p.question_version_id
       WHERE p.assessment_id = NEW.id AND v.status <> 'PUBLISHED') THEN
      RAISE EXCEPTION 'Scheduling requires published versions';
    END IF;
    SELECT count(*) FILTER (WHERE v.difficulty = 'EASY'), count(*) FILTER (WHERE v.difficulty = 'MEDIUM'), count(*) FILTER (WHERE v.difficulty = 'HARD')
      INTO easy_total, medium_total, hard_total
      FROM assessment_pool_questions p JOIN question_versions v ON v.id = p.question_version_id
      WHERE p.assessment_id = NEW.id;
    IF easy_total < 2 OR medium_total < 1 OR hard_total < 1 THEN
      RAISE EXCEPTION 'Insufficient difficulty-stratified question pool';
    END IF;
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER frozen_schedule BEFORE INSERT OR UPDATE ON assessments
  FOR EACH ROW EXECUTE FUNCTION protect_assessment_schedule();

-- Commit-time validation permits one atomic insertion of attempt + four question rows.
CREATE FUNCTION validate_attempt_allocation() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE target_id uuid; total integer; easy integer; medium integer; hard integer;
BEGIN
  IF TG_TABLE_NAME = 'assessment_attempts' THEN target_id := NEW.id;
  ELSIF TG_OP = 'DELETE' THEN target_id := OLD.attempt_id;
  ELSE target_id := NEW.attempt_id;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM assessment_attempts WHERE id = target_id) THEN RETURN NULL; END IF;
  SELECT count(*), count(*) FILTER (WHERE v.difficulty = 'EASY'), count(*) FILTER (WHERE v.difficulty = 'MEDIUM'), count(*) FILTER (WHERE v.difficulty = 'HARD')
    INTO total, easy, medium, hard FROM attempt_questions q
    JOIN question_versions v ON v.id = q.question_version_id WHERE q.attempt_id = target_id;
  IF total <> 4 OR easy <> 2 OR medium <> 1 OR hard <> 1 THEN
    RAISE EXCEPTION 'Attempt requires exactly 2 easy, 1 medium and 1 hard question';
  END IF;
  RETURN NULL;
END $$;
CREATE CONSTRAINT TRIGGER attempt_has_four_questions AFTER INSERT ON assessment_attempts
  DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION validate_attempt_allocation();
CREATE CONSTRAINT TRIGGER validate_question_mix AFTER INSERT OR UPDATE OR DELETE ON attempt_questions
  DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION validate_attempt_allocation();

CREATE FUNCTION protect_attempt_question() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN RAISE EXCEPTION 'Attempt question allocation is immutable'; END IF;
  IF (NEW.id, NEW.attempt_id, NEW.assessment_id, NEW.question_id, NEW.question_version_id, NEW.position)
     IS DISTINCT FROM
     (OLD.id, OLD.attempt_id, OLD.assessment_id, OLD.question_id, OLD.question_version_id, OLD.position) THEN
    RAISE EXCEPTION 'Attempt question allocation is immutable';
  END IF;
  IF OLD.final_submission_id IS NOT NULL AND NEW.final_submission_id IS DISTINCT FROM OLD.final_submission_id THEN
    RAISE EXCEPTION 'Final submission snapshot cannot be replaced';
  END IF;
  IF NEW.final_submission_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM submissions s WHERE s.id = NEW.final_submission_id AND s.attempt_question_id = NEW.id
      AND s.attempt_id = NEW.attempt_id AND s.question_version_id = NEW.question_version_id AND s.purpose = 'FINAL'
  ) THEN RAISE EXCEPTION 'Final submission must belong to this allocated question'; END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER immutable_allocation BEFORE UPDATE OR DELETE ON attempt_questions
  FOR EACH ROW EXECUTE FUNCTION protect_attempt_question();

CREATE FUNCTION protect_attempt_identity() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF (NEW.id, NEW.assignment_id, NEW.student_id, NEW.assessment_id, NEW.started_at, NEW.expires_at,
      NEW.rule_snapshot, NEW.allocation_manifest_hash)
    IS DISTINCT FROM
     (OLD.id, OLD.assignment_id, OLD.student_id, OLD.assessment_id, OLD.started_at, OLD.expires_at,
      OLD.rule_snapshot, OLD.allocation_manifest_hash) THEN
    RAISE EXCEPTION 'Attempt identity, deadline and rule snapshot are immutable';
  END IF;
  IF NEW.status <> OLD.status AND NOT (
    (OLD.status = 'IN_PROGRESS' AND NEW.status IN ('FINALIZING','VOIDED')) OR
    (OLD.status = 'FINALIZING' AND NEW.status IN ('FINALIZED','VOIDED'))
  ) THEN RAISE EXCEPTION 'Invalid attempt status transition'; END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER immutable_attempt BEFORE UPDATE ON assessment_attempts
  FOR EACH ROW EXECUTE FUNCTION protect_attempt_identity();

CREATE FUNCTION protect_submission_snapshot() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN RAISE EXCEPTION 'Submission snapshots are immutable'; END IF;
  IF (NEW.id, NEW.attempt_question_id, NEW.attempt_id, NEW.question_version_id, NEW.purpose, NEW.language,
      NEW.source_code, NEW.source_hash, NEW.idempotency_key, NEW.request_hash, NEW.accepted_at)
    IS DISTINCT FROM
     (OLD.id, OLD.attempt_question_id, OLD.attempt_id, OLD.question_version_id, OLD.purpose, OLD.language,
      OLD.source_code, OLD.source_hash, OLD.idempotency_key, OLD.request_hash, OLD.accepted_at) THEN
    RAISE EXCEPTION 'Submission snapshots are immutable';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER immutable_submission BEFORE UPDATE OR DELETE ON submissions
  FOR EACH ROW EXECUTE FUNCTION protect_submission_snapshot();

CREATE FUNCTION reject_audit_mutation() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN RAISE EXCEPTION 'Audit log is append only'; END $$;
CREATE TRIGGER append_only_audit BEFORE UPDATE OR DELETE ON audit_logs
  FOR EACH ROW EXECUTE FUNCTION reject_audit_mutation();

-- Runtime role grants are a separate deployment step. The API receives SELECT on this view,
-- never SELECT on test_cases. The admin write path and judge use separate database credentials.
CREATE VIEW public_test_case_envelopes AS
  SELECT id, question_version_id, ordinal, input_ciphertext, expected_output_ciphertext, encryption_key_id
  FROM test_cases WHERE visibility = 'PUBLIC';

COMMIT;
