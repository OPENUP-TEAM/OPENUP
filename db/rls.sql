-- =====================================================================
-- OpenUp — Row Level Security lockdown
-- Run this in the Supabase SQL Editor AFTER schema.sql and seed.sql.
--
-- Why this exists:
--   Supabase publishes every table in the `public` schema through
--   PostgREST at https://[ref].supabase.co/rest/v1/. That endpoint
--   accepts the anon key, which is public by design. Without RLS,
--   anyone with that key can read the entire database.
--
-- What this does:
--   Enables RLS on every table and writes NO policies. PostgREST then
--   returns nothing to anon and authenticated roles.
--
-- What this does NOT do:
--   Affect the Express server. It connects as `postgres`, which owns
--   these tables, and table owners bypass RLS. All authorisation for
--   the application happens in middleware/auth.js.
-- =====================================================================

DO $$
DECLARE t text;
BEGIN
  FOR t IN
    SELECT tablename FROM pg_tables WHERE schemaname = 'public'
  LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t);
  END LOOP;
END $$;

-- Views inherit the permissions of their underlying tables, but revoke
-- explicitly so the analytics views are not readable over PostgREST either.
REVOKE ALL ON v_barangay_mood_daily      FROM anon, authenticated;
REVOKE ALL ON v_community_wellness_index FROM anon, authenticated;
REVOKE ALL ON v_barangay_budget          FROM anon, authenticated;
REVOKE ALL ON v_ai_effectiveness         FROM anon, authenticated;


-- ---------------------------------------------------------------------
-- Verification — run these after the block above.
-- ---------------------------------------------------------------------

-- Every row should show rowsecurity = true.
--   SELECT tablename, rowsecurity FROM pg_tables
--    WHERE schemaname = 'public' ORDER BY tablename;

-- Then confirm the public endpoint is closed. In a terminal:
--   curl "https://[ref].supabase.co/rest/v1/user?select=email" \
--        -H "apikey: YOUR_ANON_KEY"
-- Expected: []   (an empty array, not a list of emails)


-- ---------------------------------------------------------------------
-- Note for later
-- ---------------------------------------------------------------------
-- If you ever move authentication to Supabase Auth and let the browser
-- query Supabase directly, this file is where the real policies go, and
-- they would look like:
--
--   CREATE POLICY own_moods ON mood_entry FOR SELECT
--     USING (user_id = auth.uid());
--
-- That only works with UUID user IDs, so it is tied to the auth decision
-- flagged in the README. As long as the browser talks only to the Express
-- API, deny-all is the correct configuration.
