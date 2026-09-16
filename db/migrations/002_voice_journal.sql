-- =====================================================================
-- Migration 002 — Voice Journal pipeline
-- Run in the Supabase SQL Editor.
--
-- The journal is a five-stage pipeline: upload, transcribe, analyse,
-- store, escalate. Any stage can fail on its own, so the row needs a
-- status the interface can report honestly instead of showing an empty
-- transcript as though the recording were silent.
-- =====================================================================

BEGIN;

ALTER TABLE voice_journal
  ADD COLUMN IF NOT EXISTS status        VARCHAR(20) NOT NULL DEFAULT 'ready',
  ADD COLUMN IF NOT EXISTS language      VARCHAR(10) NOT NULL DEFAULT 'en',
  ADD COLUMN IF NOT EXISTS duration_sec  INT,
  ADD COLUMN IF NOT EXISTS emotion_scores JSONB,
  ADD COLUMN IF NOT EXISTS risk_score    NUMERIC(4,3),
  ADD COLUMN IF NOT EXISTS error_detail  TEXT;

ALTER TABLE voice_journal DROP CONSTRAINT IF EXISTS ck_journal_status;
ALTER TABLE voice_journal ADD CONSTRAINT ck_journal_status
  CHECK (status IN ('uploaded', 'transcribing', 'analyzing', 'ready', 'failed'));

-- Existing rows predate the pipeline; treat them as finished.
UPDATE voice_journal SET status = 'ready' WHERE status IS NULL;

CREATE INDEX IF NOT EXISTS idx_journal_status
  ON voice_journal (status) WHERE status <> 'ready';

-- New tables always need RLS enabled; these columns sit on an existing
-- table that already has it, but confirm anyway.
ALTER TABLE voice_journal ENABLE ROW LEVEL SECURITY;
ALTER TABLE crisis_alert  ENABLE ROW LEVEL SECURITY;
ALTER TABLE trusted_contact ENABLE ROW LEVEL SECURITY;

COMMIT;

-- Emotion trend view: one row per user per day, for "View Emotion Trends".
CREATE OR REPLACE VIEW v_journal_emotion_daily AS
SELECT user_id,
       created_at::date                          AS entry_date,
       COUNT(*)                                  AS entries,
       ROUND(AVG(risk_score), 3)                 AS avg_risk,
       MODE() WITHIN GROUP (ORDER BY emotion_result) AS dominant_emotion
  FROM voice_journal
 WHERE status = 'ready'
 GROUP BY user_id, created_at::date;

ALTER VIEW v_journal_emotion_daily SET (security_invoker = on);
REVOKE ALL ON v_journal_emotion_daily FROM anon, authenticated;

-- Verify
SELECT column_name, data_type
  FROM information_schema.columns
 WHERE table_name = 'voice_journal'
 ORDER BY ordinal_position;
