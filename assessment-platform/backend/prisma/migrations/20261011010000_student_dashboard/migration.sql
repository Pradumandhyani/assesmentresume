BEGIN;
ALTER TABLE assessments ADD COLUMN description TEXT;
CREATE TABLE login_rate_limits (
  key CHAR(64) PRIMARY KEY,
  count INTEGER NOT NULL DEFAULT 1 CHECK (count > 0),
  expires_at TIMESTAMPTZ(3) NOT NULL
);
CREATE INDEX login_rate_limits_expires_at_idx ON login_rate_limits(expires_at);
COMMIT;
