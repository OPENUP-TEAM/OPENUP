-- =====================================================================
-- Migration 005 — Mental Health Assessment
-- Run in the Supabase SQL Editor after 004.
--
-- The assessment table stored a score and a result string but not which
-- instrument produced them. A PHQ-9 score of 12 and a GAD-7 score of 12
-- mean different things, so the instrument has to be recorded alongside
-- the number or the history is uninterpretable.
-- =====================================================================

BEGIN;

ALTER TABLE assessment
  ADD COLUMN IF NOT EXISTS instrument   VARCHAR(20) NOT NULL DEFAULT 'phq9',
  ADD COLUMN IF NOT EXISTS severity     VARCHAR(20),
  ADD COLUMN IF NOT EXISTS max_score    INT,
  ADD COLUMN IF NOT EXISTS flagged_item BOOLEAN NOT NULL DEFAULT false;

COMMENT ON COLUMN assessment.flagged_item IS
  'True when a safety-critical item was answered above zero, regardless of total score. PHQ-9 item 9 asks about thoughts of self-harm; a low total with that item endorsed still requires follow-up.';

ALTER TABLE assessment DROP CONSTRAINT IF EXISTS ck_assessment_instrument;
ALTER TABLE assessment ADD CONSTRAINT ck_assessment_instrument
  CHECK (instrument IN ('phq9', 'gad7'));

CREATE INDEX IF NOT EXISTS idx_assessment_flagged
  ON assessment (user_id, taken_at DESC) WHERE flagged_item = true;

COMMIT;

-- Trend per instrument, for "View Results" over time.
CREATE OR REPLACE VIEW v_assessment_history AS
SELECT user_id,
       instrument,
       taken_at::date AS taken_date,
       score,
       max_score,
       severity,
       flagged_item
  FROM assessment;

ALTER VIEW v_assessment_history SET (security_invoker = on);
REVOKE ALL ON v_assessment_history FROM anon, authenticated;

SELECT column_name, data_type FROM information_schema.columns
 WHERE table_name = 'assessment' ORDER BY ordinal_position;
