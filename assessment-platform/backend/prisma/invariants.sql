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
