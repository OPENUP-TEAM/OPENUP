-- =====================================================================
-- OpenUp — clear the Security Advisor findings
-- Run in the Supabase SQL Editor after schema.sql, seed.sql and rls.sql.
-- =====================================================================

-- 1. Drop the leftover setup function -----------------------------------
-- Enabling RLS is a one-time task. A SECURITY DEFINER function owned by
-- postgres and executable by PUBLIC should not stay in the database.
DROP FUNCTION IF EXISTS public.rls_auto_enable();


-- 2. Fix the four CRITICAL "Security Definer View" findings -------------
-- By default a view runs with its creator's permissions, so anyone who
-- reaches these views reads straight through the RLS on the underlying
-- tables. security_invoker makes the view run as the querying user.
-- The Express server connects as postgres (the table owner) so it is
-- unaffected; anon and authenticated get nothing.
ALTER VIEW public.v_barangay_mood_daily      SET (security_invoker = on);
ALTER VIEW public.v_community_wellness_index SET (security_invoker = on);
ALTER VIEW public.v_barangay_budget          SET (security_invoker = on);
ALTER VIEW public.v_ai_effectiveness         SET (security_invoker = on);

-- If the four lines above error with "unrecognized parameter", your
-- project is on PostgreSQL 14 or older. Upgrade under Project Settings ->
-- Infrastructure, or fall back to revoking access instead:
--   REVOKE ALL ON public.v_barangay_mood_daily FROM anon, authenticated;


-- 3. Fix "Function Search Path Mutable" ---------------------------------
-- Without a pinned search_path, someone who can create objects in a
-- schema earlier on the path could shadow a function this trigger calls.
CREATE OR REPLACE FUNCTION public.set_updated_at()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;


-- 4. Belt and braces: revoke the views from the public API roles --------
REVOKE ALL ON public.v_barangay_mood_daily      FROM anon, authenticated;
REVOKE ALL ON public.v_community_wellness_index FROM anon, authenticated;
REVOKE ALL ON public.v_barangay_budget          FROM anon, authenticated;
REVOKE ALL ON public.v_ai_effectiveness         FROM anon, authenticated;


-- ---------------------------------------------------------------------
-- Verify
-- ---------------------------------------------------------------------
-- Every table should report true:
SELECT tablename, rowsecurity
  FROM pg_tables
 WHERE schemaname = 'public'
 ORDER BY rowsecurity, tablename;
