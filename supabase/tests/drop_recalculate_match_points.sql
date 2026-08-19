-- Vérifie le drop de recalculate_match_points (legacy access-code).
-- Exécuter via npm run test:sql:local (BEGIN / ROLLBACK).

BEGIN;

DO $$
BEGIN
  IF to_regprocedure('public.recalculate_match_points(text, uuid)') IS NOT NULL THEN
    RAISE EXCEPTION 'TEST_FAIL: recalculate_match_points(text, uuid) must be dropped';
  END IF;

  IF to_regprocedure('public.recalculate_points_for_match(uuid)') IS NULL THEN
    RAISE EXCEPTION 'TEST_FAIL: recalculate_points_for_match(uuid) must remain';
  END IF;
END;
$$;

ROLLBACK;
