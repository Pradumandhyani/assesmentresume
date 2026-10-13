-- OPTIONAL DBA-reviewed deployment step, never run by db:migrate or application startup.
-- Apply only to a dedicated assessment database after its schema migrations. No passwords/data resets.
-- Create separately managed LOGIN identities and GRANT one of these NOLOGIN groups to each.
-- Never make runtime identities owners, superusers, migration-role members or grant them PUBLIC extras.
BEGIN;
DO $$ BEGIN
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'assessment_api') THEN CREATE ROLE assessment_api NOLOGIN; END IF;
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'assessment_judge') THEN CREATE ROLE assessment_judge NOLOGIN; END IF;
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'assessment_maintenance') THEN CREATE ROLE assessment_maintenance NOLOGIN; END IF;
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'assessment_admin') THEN CREATE ROLE assessment_admin NOLOGIN; END IF;
END $$;
REVOKE ALL ON ALL TABLES IN SCHEMA public FROM assessment_api, assessment_judge, assessment_maintenance, assessment_admin;
GRANT USAGE ON SCHEMA public TO assessment_api, assessment_judge, assessment_maintenance, assessment_admin;
GRANT SELECT ON assessments, assessment_rules, questions, question_topics, question_versions,
  question_templates, assessment_pool_questions, assessment_assignments, assessment_attempts,
  attempt_questions, code_drafts, submissions, assessment_results, audit_logs
  TO assessment_api, assessment_judge, assessment_maintenance;
-- PostgreSQL SHARE row locks need UPDATE privilege on at least one column.
GRANT UPDATE (revision) ON assessments TO assessment_api, assessment_judge, assessment_maintenance;
GRANT UPDATE (assigned_at) ON assessment_assignments TO assessment_api;
GRANT SELECT ON users, students, admins, auth_sessions, login_rate_limits, idempotency_records,
  outbox_events, judge_worker_heartbeats TO assessment_api;
GRANT UPDATE (password_hash, updated_at) ON users TO assessment_api;
GRANT INSERT, UPDATE ON auth_sessions, login_rate_limits, idempotency_records,
  assessment_attempts, attempt_questions, code_drafts, submissions, outbox_events TO assessment_api;
GRANT INSERT ON audit_logs TO assessment_api, assessment_judge, assessment_maintenance;
-- API cannot read raw private diagnostics or any encrypted test case; DTO repositories select only these columns.
GRANT SELECT (id, verdict, passed_count, total_count, score, public_case_results, cpu_time_ms, memory_kib, submission_id)
  ON submission_results TO assessment_api;
GRANT SELECT ON test_cases, submission_results, outbox_events, judge_worker_heartbeats TO assessment_judge;
GRANT INSERT ON submission_results, assessment_results TO assessment_judge;
GRANT UPDATE ON submissions, assessment_attempts TO assessment_judge;
GRANT INSERT, UPDATE, DELETE ON judge_worker_heartbeats TO assessment_judge;
GRANT SELECT ON outbox_events, submission_results TO assessment_maintenance;
GRANT INSERT ON assessment_results, submissions, outbox_events TO assessment_maintenance;
GRANT UPDATE ON outbox_events, submissions, assessment_attempts, attempt_questions TO assessment_maintenance;
-- No runtime group can modify question content/cases/rules/schedules or computed result rows.
-- Administration has a separate managed LOGIN identity and process. It never owns tables.
GRANT SELECT ON admins, students, assessments, assessment_rules, questions, question_topics,
  question_versions, question_templates, test_cases, assessment_pool_questions, assessment_assignments,
  assessment_attempts, attempt_questions, assessment_results, audit_logs, idempotency_records,
  judge_worker_heartbeats TO assessment_admin;
GRANT SELECT (id, role, is_active, auth_version) ON users TO assessment_admin;
GRANT SELECT (id, attempt_id, attempt_question_id, question_version_id, purpose, language,
  status, accepted_at, completed_at, last_judge_error_code) ON submissions TO assessment_admin;
GRANT SELECT (id, verdict, passed_count, total_count, score, cpu_time_ms, memory_kib, submission_id)
  ON submission_results TO assessment_admin;
GRANT INSERT, UPDATE ON assessments, assessment_rules, questions, question_topics, question_versions,
  question_templates, test_cases, assessment_pool_questions, assessment_assignments,
  idempotency_records TO assessment_admin;
GRANT DELETE ON question_topics, question_templates, test_cases, assessment_pool_questions TO assessment_admin;
GRANT UPDATE (cohort) ON students TO assessment_admin;
GRANT UPDATE (is_active, auth_version, updated_at) ON users TO assessment_admin;
GRANT UPDATE (revoked_at) ON auth_sessions TO assessment_admin;
GRANT SELECT (user_id, revoked_at) ON auth_sessions TO assessment_admin;
GRANT UPDATE (status, finalized_at, finalization_reason, state_version) ON assessment_attempts TO assessment_admin;
GRANT INSERT ON audit_logs TO assessment_admin;
-- Immutable version/schedule/result triggers apply to admin identities too. No private judge logs or hashes.
COMMIT;
