-- =====================================================================
-- Migration 004 — Care Credit allocation pool
-- Run in the Supabase SQL Editor after 003.
--
-- Why:
--   care_credit.resident_id was NOT NULL, so a credit had to belong to a
--   person the moment it existed. That leaves nowhere for a barangay's
--   unissued pool to sit, which is what "Segregate per Barangay" means.
--
--   The lifecycle becomes:
--     admin allocates a batch to a barangay   -> resident_id IS NULL
--     LGU assigns a credit to a resident      -> resident_id set
--     resident books with it                  -> status 'reserved'
--     session completes                       -> status 'consumed'
-- =====================================================================

BEGIN;

ALTER TABLE care_credit ALTER COLUMN resident_id DROP NOT NULL;

ALTER TABLE care_credit
  ADD COLUMN IF NOT EXISTS allocated_by BIGINT REFERENCES "user"(user_id),
  ADD COLUMN IF NOT EXISTS assigned_by  BIGINT REFERENCES "user"(user_id),
  ADD COLUMN IF NOT EXISTS assigned_at  TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS batch_note   VARCHAR(255);

-- Unassigned credits are the barangay pool; this index drives the counts
-- on both the admin and LGU dashboards.
CREATE INDEX IF NOT EXISTS idx_credit_pool
  ON care_credit (barangay_id, status) WHERE resident_id IS NULL;

-- A credit that has been used must belong to someone. Only 'available'
-- credits are allowed to sit unassigned.
ALTER TABLE care_credit DROP CONSTRAINT IF EXISTS ck_credit_assigned;
ALTER TABLE care_credit ADD CONSTRAINT ck_credit_assigned
  CHECK (resident_id IS NOT NULL OR status = 'available');

COMMIT;

-- Distribution per barangay: pool, assigned, and what has actually been used.
CREATE OR REPLACE VIEW v_credit_distribution AS
SELECT b.barangay_id,
       b.name AS barangay_name,
       COUNT(*) FILTER (WHERE c.resident_id IS NULL
                        AND c.status = 'available')::int            AS pool_count,
       COALESCE(SUM(c.amount) FILTER (WHERE c.resident_id IS NULL
                        AND c.status = 'available'), 0)             AS pool_value,
       COUNT(*) FILTER (WHERE c.resident_id IS NOT NULL)::int       AS assigned_count,
       COUNT(*) FILTER (WHERE c.status = 'consumed')::int           AS consumed_count,
       COALESCE(SUM(c.amount) FILTER (WHERE c.status = 'consumed'), 0) AS consumed_value,
       COUNT(*) FILTER (WHERE c.status = 'reserved')::int           AS reserved_count,
       COUNT(*)::int                                                AS total_count,
       COALESCE(SUM(c.amount), 0)                                   AS total_value,
       -- Utilization: of what was handed to residents, how much got used.
       CASE WHEN COUNT(*) FILTER (WHERE c.resident_id IS NOT NULL) = 0 THEN 0
            ELSE ROUND(
              COUNT(*) FILTER (WHERE c.status = 'consumed')::numeric
              / COUNT(*) FILTER (WHERE c.resident_id IS NOT NULL) * 100, 1)
       END                                                          AS utilization_pct
  FROM barangay b
  LEFT JOIN care_credit c ON c.barangay_id = b.barangay_id
 GROUP BY b.barangay_id, b.name;

ALTER VIEW v_credit_distribution SET (security_invoker = on);
REVOKE ALL ON v_credit_distribution FROM anon, authenticated;

-- Verify
SELECT barangay_name, pool_count, assigned_count, consumed_count, utilization_pct
  FROM v_credit_distribution
 WHERE total_count > 0;
