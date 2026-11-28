-- Preserve existing enrolments; new admissions supply a course.
ALTER TABLE students ADD COLUMN course varchar(100);
CREATE INDEX students_institution_id_course_idx ON students(institution_id, course);
DO $$ BEGIN
  IF EXISTS (SELECT FROM pg_roles WHERE rolname = 'assessment_admin') THEN
    GRANT UPDATE (course) ON students TO assessment_admin;
  END IF;
END $$;
