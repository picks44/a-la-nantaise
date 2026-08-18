-- Tests : fixture_result_sync_is_needed (migration 20260810130000).
-- Exécuter via npm run test:sql:local (transaction BEGIN / ROLLBACK).

BEGIN;

DELETE FROM public.matches
WHERE external_id LIKE 'test-result-sync-%'
   OR id IN (
     'f1111111-1111-1111-1111-111111111101',
     'f1111111-1111-1111-1111-111111111102',
     'f1111111-1111-1111-1111-111111111103',
     'f1111111-1111-1111-1111-111111111104',
     'f1111111-1111-1111-1111-111111111105',
     'f1111111-1111-1111-1111-111111111106',
     'f1111111-1111-1111-1111-111111111107',
     'f1111111-1111-1111-1111-111111111108',
     'f1111111-1111-1111-1111-111111111109',
     'f1111111-1111-1111-1111-111111111110'
   );

-- ---------------------------------------------------------------------------
-- 0) Aucun match → false
-- ---------------------------------------------------------------------------
DO $$
BEGIN
  IF public.fixture_result_sync_is_needed() THEN
    RAISE EXCEPTION 'TEST FAIL: sans match, attendu false';
  END IF;
END;
$$;

-- ---------------------------------------------------------------------------
-- 1) kickoff non confirmé (dans la fenêtre temporelle) → false
-- ---------------------------------------------------------------------------
DO $$
BEGIN
  INSERT INTO public.matches (
    id, external_id, round_number, home_team, away_team,
    kickoff_at, kickoff_time_confirmed, kickoff_confirmation_source, status
  ) VALUES (
    'f1111111-1111-1111-1111-111111111101',
    'test-result-sync-unconfirmed',
    91,
    'FC Nantes',
    'Test Unconfirmed',
    now() - interval '3 hours',
    FALSE,
    'heuristic',
    'scheduled'
  );

  IF public.fixture_result_sync_is_needed() THEN
    RAISE EXCEPTION 'TEST FAIL: kickoff non confirmé doit être false';
  END IF;

  DELETE FROM public.matches WHERE id = 'f1111111-1111-1111-1111-111111111101';
END;
$$;

-- ---------------------------------------------------------------------------
-- 2) trop tôt (kickoff + 30 min) → false
-- ---------------------------------------------------------------------------
DO $$
BEGIN
  INSERT INTO public.matches (
    id, external_id, round_number, home_team, away_team,
    kickoff_at, kickoff_time_confirmed, kickoff_confirmation_source, status
  ) VALUES (
    'f1111111-1111-1111-1111-111111111102',
    'test-result-sync-too-early',
    91,
    'FC Nantes',
    'Test Early',
    now() - interval '30 minutes',
    TRUE,
    'feed',
    'scheduled'
  );

  IF public.fixture_result_sync_is_needed() THEN
    RAISE EXCEPTION 'TEST FAIL: trop tôt après kickoff doit être false';
  END IF;

  DELETE FROM public.matches WHERE id = 'f1111111-1111-1111-1111-111111111102';
END;
$$;

-- ---------------------------------------------------------------------------
-- 3) kickoff + 105 min exact → true
-- ---------------------------------------------------------------------------
DO $$
BEGIN
  INSERT INTO public.matches (
    id, external_id, round_number, home_team, away_team,
    kickoff_at, kickoff_time_confirmed, kickoff_confirmation_source, status
  ) VALUES (
    'f1111111-1111-1111-1111-111111111103',
    'test-result-sync-at-lower',
    91,
    'FC Nantes',
    'Test Lower Bound',
    now() - interval '105 minutes',
    TRUE,
    'feed',
    'scheduled'
  );

  IF NOT public.fixture_result_sync_is_needed() THEN
    RAISE EXCEPTION 'TEST FAIL: kickoff + 105 min doit être true';
  END IF;

  DELETE FROM public.matches WHERE id = 'f1111111-1111-1111-1111-111111111103';
END;
$$;

-- ---------------------------------------------------------------------------
-- 4) dans la fenêtre (kickoff + 3 h) → true
-- ---------------------------------------------------------------------------
DO $$
BEGIN
  INSERT INTO public.matches (
    id, external_id, round_number, home_team, away_team,
    kickoff_at, kickoff_time_confirmed, kickoff_confirmation_source, status
  ) VALUES (
    'f1111111-1111-1111-1111-111111111104',
    'test-result-sync-in-window',
    91,
    'FC Nantes',
    'Test In Window',
    now() - interval '3 hours',
    TRUE,
    'feed',
    'live'
  );

  IF NOT public.fixture_result_sync_is_needed() THEN
    RAISE EXCEPTION 'TEST FAIL: dans la fenêtre doit être true';
  END IF;

  DELETE FROM public.matches WHERE id = 'f1111111-1111-1111-1111-111111111104';
END;
$$;

-- ---------------------------------------------------------------------------
-- 5) finished → false
-- ---------------------------------------------------------------------------
DO $$
BEGIN
  INSERT INTO public.matches (
    id, external_id, round_number, home_team, away_team,
    kickoff_at, kickoff_time_confirmed, kickoff_confirmation_source,
    status, home_score, away_score
  ) VALUES (
    'f1111111-1111-1111-1111-111111111105',
    'test-result-sync-finished',
    91,
    'FC Nantes',
    'Test Finished',
    now() - interval '3 hours',
    TRUE,
    'feed',
    'finished',
    0,
    1
  );

  IF public.fixture_result_sync_is_needed() THEN
    RAISE EXCEPTION 'TEST FAIL: finished doit être false';
  END IF;

  DELETE FROM public.matches WHERE id = 'f1111111-1111-1111-1111-111111111105';
END;
$$;

-- ---------------------------------------------------------------------------
-- 6) postponed → false
-- ---------------------------------------------------------------------------
DO $$
BEGIN
  INSERT INTO public.matches (
    id, external_id, round_number, home_team, away_team,
    kickoff_at, kickoff_time_confirmed, kickoff_confirmation_source, status
  ) VALUES (
    'f1111111-1111-1111-1111-111111111106',
    'test-result-sync-postponed',
    91,
    'FC Nantes',
    'Test Postponed',
    now() - interval '3 hours',
    TRUE,
    'manual',
    'postponed'
  );

  IF public.fixture_result_sync_is_needed() THEN
    RAISE EXCEPTION 'TEST FAIL: postponed doit être false';
  END IF;

  DELETE FROM public.matches WHERE id = 'f1111111-1111-1111-1111-111111111106';
END;
$$;

-- ---------------------------------------------------------------------------
-- 7) cancelled → false
-- ---------------------------------------------------------------------------
DO $$
BEGIN
  INSERT INTO public.matches (
    id, external_id, round_number, home_team, away_team,
    kickoff_at, kickoff_time_confirmed, kickoff_confirmation_source, status
  ) VALUES (
    'f1111111-1111-1111-1111-111111111107',
    'test-result-sync-cancelled',
    91,
    'FC Nantes',
    'Test Cancelled',
    now() - interval '3 hours',
    TRUE,
    'manual',
    'cancelled'
  );

  IF public.fixture_result_sync_is_needed() THEN
    RAISE EXCEPTION 'TEST FAIL: cancelled doit être false';
  END IF;

  DELETE FROM public.matches WHERE id = 'f1111111-1111-1111-1111-111111111107';
END;
$$;

-- ---------------------------------------------------------------------------
-- 8) après kickoff + 8 h → true (catch-up, plus de plafond)
-- ---------------------------------------------------------------------------
DO $$
BEGIN
  INSERT INTO public.matches (
    id, external_id, round_number, home_team, away_team,
    kickoff_at, kickoff_time_confirmed, kickoff_confirmation_source, status
  ) VALUES (
    'f1111111-1111-1111-1111-111111111108',
    'test-result-sync-expired',
    91,
    'FC Nantes',
    'Test Expired',
    now() - interval '8 hours' - interval '1 minute',
    TRUE,
    'feed',
    'scheduled'
  );

  IF NOT public.fixture_result_sync_is_needed() THEN
    RAISE EXCEPTION 'TEST FAIL: après +8h doit rester true (catch-up)';
  END IF;

  DELETE FROM public.matches WHERE id = 'f1111111-1111-1111-1111-111111111108';
END;
$$;

-- ---------------------------------------------------------------------------
-- 8b) après plusieurs jours sans résultat → true (rattrapage)
-- ---------------------------------------------------------------------------
DO $$
BEGIN
  INSERT INTO public.matches (
    id, external_id, round_number, home_team, away_team,
    kickoff_at, kickoff_time_confirmed, kickoff_confirmation_source, status
  ) VALUES (
    'f1111111-1111-1111-1111-111111111110',
    'test-result-sync-stale-days',
    91,
    'FC Nantes',
    'Test Stale Days',
    now() - interval '4 days',
    TRUE,
    'feed',
    'scheduled'
  );

  IF NOT public.fixture_result_sync_is_needed() THEN
    RAISE EXCEPTION 'TEST FAIL: après plusieurs jours doit rester true (catch-up)';
  END IF;

  DELETE FROM public.matches WHERE id = 'f1111111-1111-1111-1111-111111111110';
END;
$$;

-- ---------------------------------------------------------------------------
-- 9) changement de kickoff → la fenêtre suit automatiquement
-- ---------------------------------------------------------------------------
DO $$
BEGIN
  INSERT INTO public.matches (
    id, external_id, round_number, home_team, away_team,
    kickoff_at, kickoff_time_confirmed, kickoff_confirmation_source, status
  ) VALUES (
    'f1111111-1111-1111-1111-111111111109',
    'test-result-sync-reschedule',
    91,
    'FC Nantes',
    'Test Reschedule',
    now() - interval '3 hours',
    TRUE,
    'feed',
    'scheduled'
  );

  IF NOT public.fixture_result_sync_is_needed() THEN
    RAISE EXCEPTION 'TEST FAIL: avant report, attendu true';
  END IF;

  -- Nouveau kickoff futur : hors fenêtre → false
  UPDATE public.matches
  SET kickoff_at = now() + interval '2 hours'
  WHERE id = 'f1111111-1111-1111-1111-111111111109';

  IF public.fixture_result_sync_is_needed() THEN
    RAISE EXCEPTION 'TEST FAIL: après report futur, attendu false';
  END IF;

  -- Kickoff décalé mais toujours dans la fenêtre (+2h depuis kickoff)
  UPDATE public.matches
  SET kickoff_at = now() - interval '2 hours'
  WHERE id = 'f1111111-1111-1111-1111-111111111109';

  IF NOT public.fixture_result_sync_is_needed() THEN
    RAISE EXCEPTION 'TEST FAIL: après report dans fenêtre, attendu true';
  END IF;

  DELETE FROM public.matches WHERE id = 'f1111111-1111-1111-1111-111111111109';
END;
$$;

-- ---------------------------------------------------------------------------
-- 10) Fonction non exposée à anon / authenticated
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  v_has_anon BOOLEAN;
  v_has_auth BOOLEAN;
BEGIN
  SELECT has_function_privilege('anon', 'public.fixture_result_sync_is_needed()', 'EXECUTE')
  INTO v_has_anon;
  SELECT has_function_privilege('authenticated', 'public.fixture_result_sync_is_needed()', 'EXECUTE')
  INTO v_has_auth;

  IF v_has_anon OR v_has_auth THEN
    RAISE EXCEPTION
      'TEST FAIL: fixture_result_sync_is_needed ne doit pas être exécutable par anon/authenticated';
  END IF;
END;
$$;

ROLLBACK;
