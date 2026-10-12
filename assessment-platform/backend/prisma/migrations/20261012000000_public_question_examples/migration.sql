-- Additive only. Existing published versions remain immutable and are not backfilled.
ALTER TABLE question_versions ADD COLUMN public_examples jsonb;
ALTER TABLE question_versions ADD CONSTRAINT public_examples_array
  CHECK (public_examples IS NULL OR (jsonb_typeof(public_examples) = 'array' AND octet_length(public_examples::text) <= 131072));
