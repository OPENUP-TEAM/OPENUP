-- =====================================================================
-- Migration 001 — separate "rejected" from "suspended"
-- Run in the Supabase SQL Editor.
--
-- Why:
--   Psychologist Verification set status = 'suspended' on rejection, but
--   the login route blocks suspended accounts. A rejected applicant was
--   therefore locked out and could never read the rejection reason or
--   upload a corrected license.
--
--   Suspended is an enforcement action. Rejected is an application
--   outcome the applicant is expected to act on. They need separate
--   states so login can allow one and block the other.
-- =====================================================================

BEGIN;

ALTER TABLE "user" DROP CONSTRAINT IF EXISTS ck_user_status;

ALTER TABLE "user" ADD CONSTRAINT ck_user_status
  CHECK (status IN ('active', 'suspended', 'pending', 'rejected'));

-- Move any psychologist suspended by the rejection flow over to the new
-- status. Identified by having a review timestamp but no verification.
UPDATE "user" u
   SET status = 'rejected'
  FROM psychologist p
 WHERE p.user_id = u.user_id
   AND u.status = 'suspended'
   AND p.is_verified = false
   AND p.verified_at IS NOT NULL;

COMMIT;

-- Verify: should list every psychologist account and its status.
SELECT u.name, u.email, u.status, p.is_verified, p.verified_at IS NOT NULL AS reviewed
  FROM "user" u JOIN psychologist p ON p.user_id = u.user_id
 ORDER BY u.created_at;
