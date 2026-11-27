-- Existing student identities and assessment history remain intact.
CREATE TABLE institutions (
  id uuid PRIMARY KEY,
  institution_id varchar(128) NOT NULL UNIQUE,
  name varchar(200) NOT NULL,
  main_faculty varchar(200) NOT NULL,
  email varchar(320) NOT NULL,
  phone varchar(40) NOT NULL,
  address varchar(1000),
  created_at timestamptz(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at timestamptz(3) NOT NULL
);
ALTER TABLE students ADD COLUMN institution_id uuid;
ALTER TABLE students ADD CONSTRAINT students_institution_id_fkey
  FOREIGN KEY (institution_id) REFERENCES institutions(id) ON DELETE RESTRICT ON UPDATE CASCADE;
CREATE INDEX students_institution_id_idx ON students(institution_id);
-- Extend an already-provisioned administration group without granting hash reads.
DO $$ BEGIN
  IF EXISTS (SELECT FROM pg_roles WHERE rolname = 'assessment_admin') THEN
    GRANT SELECT, INSERT ON institutions TO assessment_admin;
    GRANT SELECT (email) ON users TO assessment_admin;
    GRANT INSERT ON users, students TO assessment_admin;
  END IF;
END $$;
