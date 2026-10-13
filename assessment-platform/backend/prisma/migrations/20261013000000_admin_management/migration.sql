-- Additive management support. Existing identities, snapshots and results are preserved.
ALTER TABLE students ADD COLUMN cohort varchar(100);
CREATE INDEX students_cohort_idx ON students(cohort);
ALTER TABLE question_versions ADD COLUMN revision integer NOT NULL DEFAULT 1 CHECK (revision >= 1);
ALTER TABLE assessment_rules ADD COLUMN difficulty_marks jsonb;
ALTER TABLE assessment_attempts ADD COLUMN last_heartbeat_at timestamptz(3);
CREATE INDEX assessment_attempts_status_last_heartbeat_at_idx ON assessment_attempts(status,last_heartbeat_at);
ALTER TABLE assessment_rules DROP CONSTRAINT fixed_exam_rule;
ALTER TABLE assessment_rules ADD CONSTRAINT bounded_exam_rule CHECK (
  duration_seconds BETWEEN 900 AND 21600 AND easy_count >= 0 AND medium_count >= 0 AND hard_count >= 0
  AND easy_count + medium_count + hard_count BETWEEN 1 AND 20 AND max_source_bytes = 65536
  AND cardinality(allowed_languages) BETWEEN 1 AND 3
  AND allowed_languages <@ ARRAY['PYTHON','JAVA','CPP']::"Language"[]
);
ALTER TABLE assessments DROP CONSTRAINT full_duration_schedule;
ALTER TABLE assessments ADD CONSTRAINT bounded_schedule CHECK (
  status IN ('DRAFT','CANCELLED') OR
  (opens_at IS NOT NULL AND latest_start_at IS NOT NULL AND closes_at IS NOT NULL
   AND opens_at <= latest_start_at AND latest_start_at < closes_at
   AND results_release_at IS NOT NULL AND results_release_at >= closes_at)
);
ALTER TABLE attempt_questions DROP CONSTRAINT question_position;
ALTER TABLE attempt_questions ADD CONSTRAINT question_position CHECK (position BETWEEN 1 AND 20);
ALTER TABLE assessment_attempts DROP CONSTRAINT attempt_duration;
ALTER TABLE assessment_attempts ADD CONSTRAINT attempt_duration CHECK (
  (rule_snapshot->>'durationSeconds')::integer BETWEEN 900 AND 21600
  AND expires_at = started_at + make_interval(secs => (rule_snapshot->>'durationSeconds')::integer)
  AND state_version >= 1 AND (status NOT IN ('FINALIZED','VOIDED') OR finalized_at IS NOT NULL)
);
CREATE OR REPLACE FUNCTION validate_attempt_allocation() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE target_id uuid; total integer; easy integer; medium integer; hard integer; rules jsonb;
BEGIN
  IF TG_TABLE_NAME = 'assessment_attempts' THEN target_id := NEW.id;
  ELSIF TG_OP = 'DELETE' THEN target_id := OLD.attempt_id; ELSE target_id := NEW.attempt_id; END IF;
  SELECT rule_snapshot INTO rules FROM assessment_attempts WHERE id = target_id;
  IF NOT FOUND THEN RETURN NULL; END IF;
  SELECT count(*), count(*) FILTER (WHERE v.difficulty='EASY'), count(*) FILTER (WHERE v.difficulty='MEDIUM'), count(*) FILTER (WHERE v.difficulty='HARD')
  INTO total,easy,medium,hard FROM attempt_questions q JOIN question_versions v ON v.id=q.question_version_id WHERE q.attempt_id=target_id;
  IF easy <> (rules->>'easyCount')::integer OR medium <> (rules->>'mediumCount')::integer OR hard <> (rules->>'hardCount')::integer
    OR total <> (rules->>'easyCount')::integer + (rules->>'mediumCount')::integer + (rules->>'hardCount')::integer
  THEN RAISE EXCEPTION 'Allocation must match its immutable rule snapshot'; END IF;
  RETURN NULL;
END $$;
CREATE OR REPLACE FUNCTION protect_assessment_schedule() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE r assessment_rules%ROWTYPE; e integer; m integer; h integer;
BEGIN
  IF TG_OP='INSERT' THEN
    IF NEW.status <> 'DRAFT' THEN RAISE EXCEPTION 'Create a draft before scheduling'; END IF;
    RETURN NEW;
  END IF;
  IF OLD.status <> 'DRAFT' AND (NEW.title,NEW.description,NEW.opens_at,NEW.latest_start_at,NEW.closes_at,NEW.results_release_at,NEW.created_by_id)
    IS DISTINCT FROM (OLD.title,OLD.description,OLD.opens_at,OLD.latest_start_at,OLD.closes_at,OLD.results_release_at,OLD.created_by_id)
  THEN RAISE EXCEPTION 'Scheduled assessment configuration is immutable'; END IF;
  IF NEW.status <> OLD.status AND NOT (
    (OLD.status='DRAFT' AND NEW.status IN ('SCHEDULED','CANCELLED')) OR
    (OLD.status='SCHEDULED' AND NEW.status IN ('OPEN','CANCELLED')) OR
    (OLD.status='OPEN' AND NEW.status IN ('CLOSED','CANCELLED')) OR
    (OLD.status='CLOSED' AND NEW.status='ARCHIVED'))
  THEN RAISE EXCEPTION 'Invalid assessment status transition'; END IF;
  IF OLD.status='DRAFT' AND NEW.status='SCHEDULED' THEN
    SELECT * INTO r FROM assessment_rules WHERE assessment_id=NEW.id;
    IF NOT FOUND THEN RAISE EXCEPTION 'Scheduling requires rules'; END IF;
    IF NEW.latest_start_at + make_interval(secs=>r.duration_seconds) > NEW.closes_at THEN
      RAISE EXCEPTION 'Every admitted student must receive the full duration'; END IF;
    IF EXISTS (SELECT 1 FROM assessment_pool_questions p JOIN question_versions v ON v.id=p.question_version_id JOIN questions q ON q.id=v.question_id
      WHERE p.assessment_id=NEW.id AND (v.status <> 'PUBLISHED' OR q.archived_at IS NOT NULL))
    THEN RAISE EXCEPTION 'Scheduling requires active published versions'; END IF;
    SELECT count(*) FILTER (WHERE v.difficulty='EASY'),count(*) FILTER (WHERE v.difficulty='MEDIUM'),count(*) FILTER (WHERE v.difficulty='HARD')
    INTO e,m,h FROM assessment_pool_questions p JOIN question_versions v ON v.id=p.question_version_id
    WHERE p.assessment_id=NEW.id AND (cardinality(r.allowed_topics)=0 OR v.topic_snapshot && r.allowed_topics);
    IF e<r.easy_count OR m<r.medium_count OR h<r.hard_count THEN RAISE EXCEPTION 'Insufficient question pool'; END IF;
  END IF;
  RETURN NEW;
END $$;
CREATE FUNCTION validate_attempt_language() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE languages jsonb;
BEGIN
  SELECT rule_snapshot->'allowedLanguages' INTO languages FROM assessment_attempts WHERE id=NEW.attempt_id;
  IF NOT (languages @> to_jsonb(ARRAY[NEW.selected_language::text])) OR NOT EXISTS (
    SELECT 1 FROM question_templates WHERE question_version_id=NEW.question_version_id AND language=NEW.selected_language)
  THEN RAISE EXCEPTION 'Selected language must match the frozen assessment and template'; END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER guard_attempt_language BEFORE INSERT OR UPDATE ON attempt_questions FOR EACH ROW EXECUTE FUNCTION validate_attempt_language();
