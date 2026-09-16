-- =====================================================================
-- Migration 003 — transcript confidence
-- Run in the Supabase SQL Editor after 002.
--
-- Google chirp_2 returns per-word confidence for ceb-PH. Storing the
-- average lets the interface tell a resident when the transcript is
-- probably wrong, instead of presenting a guess as what they said.
-- =====================================================================

ALTER TABLE voice_journal
  ADD COLUMN IF NOT EXISTS transcript_confidence NUMERIC(4,3);

COMMENT ON COLUMN voice_journal.transcript_confidence IS
  'Mean word-level confidence from the recogniser, 0 to 1. NULL when the provider does not report it (Whisper).';

-- Useful for measuring Bisaya accuracy for Chapter IV: average confidence
-- per language, over entries that actually completed.
SELECT language,
       COUNT(*)                                  AS entries,
       ROUND(AVG(transcript_confidence), 3)      AS avg_confidence,
       ROUND(MIN(transcript_confidence), 3)      AS worst,
       COUNT(*) FILTER (WHERE transcript_confidence < 0.7)::int AS low_confidence
  FROM voice_journal
 WHERE status = 'ready' AND transcript_confidence IS NOT NULL
 GROUP BY language;
