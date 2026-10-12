-- Additive Step 4 migration. Existing identities, schedules, versions and snapshots are preserved.
ALTER TABLE assessment_rules
  ADD COLUMN allowed_topics text[] NOT NULL DEFAULT '{}',
  ADD COLUMN submission_selection varchar(32) NOT NULL DEFAULT 'FINAL_SNAPSHOT',
  ADD COLUMN partial_scoring boolean NOT NULL DEFAULT true,
  ADD COLUMN max_hidden_submissions integer NOT NULL DEFAULT 20,
  ADD COLUMN hidden_cooldown_seconds integer NOT NULL DEFAULT 15,
  ADD COLUMN max_public_runs integer NOT NULL DEFAULT 100,
  ADD COLUMN hidden_feedback_immediate boolean NOT NULL DEFAULT false,
  ADD CONSTRAINT grading_policy_bounds CHECK (
    submission_selection IN ('FINAL_SNAPSHOT','BEST_VALID','LATEST_VALID')
    AND max_hidden_submissions BETWEEN 1 AND 100
    AND hidden_cooldown_seconds BETWEEN 0 AND 3600 AND max_public_runs BETWEEN 1 AND 1000
    AND cardinality(allowed_topics) <= 50
  );
ALTER TABLE question_versions
  ADD COLUMN tags text[] NOT NULL DEFAULT '{}',
  ADD COLUMN topic_snapshot text[] NOT NULL DEFAULT '{}',
  ADD COLUMN output_comparison varchar(16) NOT NULL DEFAULT 'TOKENS',
  ADD COLUMN process_limit integer NOT NULL DEFAULT 32,
  ADD CONSTRAINT execution_policy_bounds CHECK (
    output_comparison IN ('TOKENS','EXACT') AND process_limit BETWEEN 1 AND 64
    AND cardinality(tags) <= 50
  );
ALTER TABLE question_templates ADD COLUMN execution_adapter jsonb;
ALTER TABLE question_templates ADD CONSTRAINT adapter_size CHECK (
  execution_adapter IS NULL OR (jsonb_typeof(execution_adapter) = 'object'
    AND octet_length(execution_adapter::text) <= 32768)
);
ALTER TABLE submissions
  ADD COLUMN judge_attempts integer NOT NULL DEFAULT 0,
  ADD COLUMN last_judge_error_code varchar(64),
  ADD CONSTRAINT judge_attempt_bounds CHECK (judge_attempts BETWEEN 0 AND 3);
ALTER TABLE assessment_results ADD COLUMN question_scores jsonb;
CREATE TABLE judge_worker_heartbeats (
  id uuid PRIMARY KEY,
  toolchain_ids text[] NOT NULL,
  last_seen_at timestamptz(3) NOT NULL
);
CREATE INDEX judge_worker_heartbeats_last_seen_at_idx ON judge_worker_heartbeats(last_seen_at);
CREATE INDEX submissions_attempt_purpose_accepted_idx ON submissions(attempt_id, purpose, accepted_at);

-- Result rows are write-once, including their private encrypted diagnostic payload.
CREATE FUNCTION reject_result_mutation() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN RAISE EXCEPTION 'Computed results are immutable'; END $$;
CREATE TRIGGER immutable_submission_result BEFORE UPDATE OR DELETE ON submission_results
  FOR EACH ROW EXECUTE FUNCTION reject_result_mutation();
CREATE TRIGGER immutable_assessment_result BEFORE UPDATE OR DELETE ON assessment_results
  FOR EACH ROW EXECUTE FUNCTION reject_result_mutation();

-- A status replay must never resurrect a terminal submission.
CREATE FUNCTION protect_submission_state() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.status IN ('COMPLETED','INFRASTRUCTURE_FAILED','CANCELLED') AND NEW IS DISTINCT FROM OLD THEN
    RAISE EXCEPTION 'Terminal submissions are immutable';
  END IF;
  IF NEW.status <> OLD.status AND NOT (
    (OLD.status = 'PENDING' AND NEW.status IN ('QUEUED','RUNNING','INFRASTRUCTURE_FAILED','CANCELLED')) OR
    (OLD.status = 'QUEUED' AND NEW.status IN ('RUNNING','INFRASTRUCTURE_FAILED','CANCELLED')) OR
    (OLD.status = 'RUNNING' AND NEW.status IN ('QUEUED','COMPLETED','INFRASTRUCTURE_FAILED','CANCELLED'))
  ) THEN RAISE EXCEPTION 'Invalid submission transition'; END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER submission_state_machine BEFORE UPDATE ON submissions
  FOR EACH ROW EXECUTE FUNCTION protect_submission_state();
