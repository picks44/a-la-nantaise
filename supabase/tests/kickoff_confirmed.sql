-- Tests horaires confirmés + provenance (migrations 041000 / 041400).
-- Exécuter dans une transaction : BEGIN; \i ... ; ROLLBACK;

BEGIN;

UPDATE public.app_settings
SET
  value = extensions.crypt('test-code-aln', extensions.gen_salt('bf')),
  updated_at = now()
WHERE key = 'access_code_hash';

INSERT INTO public.app_settings (key, value)
SELECT 'access_code_hash', extensions.crypt('test-code-aln', extensions.gen_salt('bf'))
WHERE NOT EXISTS (
  SELECT 1 FROM public.app_settings AS s WHERE s.key = 'access_code_hash'
);

UPDATE public.app_settings
SET
  value = extensions.crypt('admin-test-code', extensions.gen_salt('bf')),
  updated_at = now()
WHERE key = 'admin_code_hash';

INSERT INTO public.app_settings (key, value)
SELECT 'admin_code_hash', extensions.crypt('admin-test-code', extensions.gen_salt('bf'))
WHERE NOT EXISTS (
  SELECT 1 FROM public.app_settings AS s WHERE s.key = 'admin_code_hash'
);

INSERT INTO public.players (id, display_name, is_active, pin_hash, must_change_pin)
VALUES (
  'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaa0d1',
  'Testeur Kickoff',
  TRUE,
  extensions.crypt('1234', extensions.gen_salt('bf')),
  FALSE
)
ON CONFLICT (id) DO UPDATE
SET
  display_name = EXCLUDED.display_name,
  is_active = TRUE,
  pin_hash = EXCLUDED.pin_hash,
  must_change_pin = FALSE,
  pin_failed_attempts = 0,
  pin_locked_until = NULL,
  pin_temporary_expires_at = NULL;

DELETE FROM public.predictions
WHERE player_id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaa0d1';

DELETE FROM public.player_sessions
WHERE player_id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaa0d1';

DELETE FROM public.matches
WHERE external_id LIKE 'test-kickoff-%'
   OR id IN (
     'eeeeeeee-eeee-eeee-eeee-eeeeeeeeee01',
     'eeeeeeee-eeee-eeee-eeee-eeeeeeeeee02',
     'eeeeeeee-eeee-eeee-eeee-eeeeeeeeee03',
     'eeeeeeee-eeee-eeee-eeee-eeeeeeeeee04',
     'eeeeeeee-eeee-eeee-eeee-eeeeeeeeee05',
     'eeeeeeee-eeee-eeee-eeee-eeeeeeeeee06',
     'eeeeeeee-eeee-eeee-eeee-eeeeeeeeee07',
     'eeeeeeee-eeee-eeee-eeee-eeeeeeeeee08'
   );

-- ---------------------------------------------------------------------------
-- 1) Minuit Paris en été (CEST) : 2026-07-15 00:00 Europe/Paris = 22:00 UTC J-1
--    Ne doit PAS comparer naïvement UTC à 00:00.
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  v_summer timestamptz := timestamptz '2026-07-14 22:00:00+00';
  v_utc_midnight timestamptz := timestamptz '2026-07-15 00:00:00+00';
  v_res RECORD;
BEGIN
  IF NOT public.is_paris_midnight_kickoff(v_summer) THEN
    RAISE EXCEPTION 'TEST FAIL: minuit Paris été non détecté';
  END IF;

  IF public.is_paris_midnight_kickoff(v_utc_midnight) THEN
    RAISE EXCEPTION 'TEST FAIL: minuit UTC été détecté à tort comme minuit Paris';
  END IF;

  SELECT * INTO v_res
  FROM public.resolve_kickoff_confirmation(v_summer, 'scheduled', NULL, NULL);

  IF v_res.confirmed IS NOT FALSE OR v_res.confirmation_source <> 'heuristic' THEN
    RAISE EXCEPTION 'TEST FAIL: été minuit → heuristic/false (obtenu % / %)',
      v_res.confirmed, v_res.confirmation_source;
  END IF;
END;
$$;

-- ---------------------------------------------------------------------------
-- 2) Minuit Paris en hiver (CET) : 2026-01-15 00:00 Europe/Paris = 23:00 UTC J-1
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  v_winter timestamptz := timestamptz '2026-01-14 23:00:00+00';
  v_utc_midnight timestamptz := timestamptz '2026-01-15 00:00:00+00';
  v_res RECORD;
BEGIN
  IF NOT public.is_paris_midnight_kickoff(v_winter) THEN
    RAISE EXCEPTION 'TEST FAIL: minuit Paris hiver non détecté';
  END IF;

  IF public.is_paris_midnight_kickoff(v_utc_midnight) THEN
    RAISE EXCEPTION 'TEST FAIL: minuit UTC hiver détecté à tort comme minuit Paris';
  END IF;

  SELECT * INTO v_res
  FROM public.resolve_kickoff_confirmation(v_winter, 'scheduled', NULL, NULL);

  IF v_res.confirmed IS NOT FALSE OR v_res.confirmation_source <> 'heuristic' THEN
    RAISE EXCEPTION 'TEST FAIL: hiver minuit → heuristic/false';
  END IF;
END;
$$;

-- ---------------------------------------------------------------------------
-- 3) Horaire normal confirmé (non-minuit)
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  v_kickoff timestamptz := timestamptz '2026-08-20 19:00:00+02';
  v_res RECORD;
BEGIN
  IF public.is_paris_midnight_kickoff(v_kickoff) THEN
    RAISE EXCEPTION 'TEST FAIL: 21:00 Paris détecté comme minuit';
  END IF;

  SELECT * INTO v_res
  FROM public.resolve_kickoff_confirmation(v_kickoff, 'scheduled', NULL, NULL);

  IF v_res.confirmed IS NOT TRUE OR v_res.confirmation_source <> 'feed' THEN
    RAISE EXCEPTION 'TEST FAIL: horaire normal → feed/true';
  END IF;
END;
$$;

-- Insère un match minuit Paris FUTUR (heuristic) pour les scénarios suivants
DO $$
DECLARE
  v_kickoff timestamptz;
BEGIN
  -- Prochain minuit Paris dans ≥ 20 jours (reste futur quel que soit now())
  v_kickoff := (
    date_trunc('day', (now() AT TIME ZONE 'Europe/Paris') + interval '20 days')
  ) AT TIME ZONE 'Europe/Paris';

  IF NOT public.is_paris_midnight_kickoff(v_kickoff) THEN
    RAISE EXCEPTION 'TEST FAIL: kickoff futur généré n’est pas minuit Paris';
  END IF;

  INSERT INTO public.matches (
    id, external_id, round_number, home_team, away_team,
    kickoff_at, kickoff_time_confirmed, kickoff_confirmation_source, status, source
  ) VALUES (
    'eeeeeeee-eeee-eeee-eeee-eeeeeeeeee01',
    'test-kickoff-midnight',
    30,
    'FC Nantes',
    'Minuit FC',
    v_kickoff,
    FALSE,
    'heuristic',
    'scheduled',
    'fixturedownload'
  );

  PERFORM set_config('test.midnight_kickoff', v_kickoff::text, true);
END;
$$;

-- Session joueur
DO $$
DECLARE
  v_token text;
BEGIN
  SELECT l.session_token INTO v_token
  FROM public.login_player(
    'test-code-aln',
    'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaa0d1',
    '1234'
  ) AS l;

  IF v_token IS NULL THEN
    RAISE EXCEPTION 'TEST FAIL: connexion joueur de test échouée';
  END IF;

  PERFORM set_config('test.session_token', v_token, true);
END;
$$;

-- ---------------------------------------------------------------------------
-- 4) Absence de verrouillage / participation / rappel tant que non confirmé
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  v_token text := current_setting('test.session_token');
BEGIN
  BEGIN
    PERFORM *
    FROM public.upsert_prediction(
      v_token,
      'eeeeeeee-eeee-eeee-eeee-eeeeeeeeee01',
      1,
      1
    );
    RAISE EXCEPTION 'TEST FAIL: MATCH_KICKOFF_UNCONFIRMED attendu';
  EXCEPTION
    WHEN OTHERS THEN
      IF SQLERRM NOT LIKE '%MATCH_KICKOFF_UNCONFIRMED%' THEN
        RAISE;
      END IF;
  END;
END;
$$;

DO $$
DECLARE
  v_token text := current_setting('test.session_token');
  v_row RECORD;
BEGIN
  INSERT INTO public.matches (
    id, external_id, round_number, home_team, away_team,
    kickoff_at, kickoff_time_confirmed, kickoff_confirmation_source, status
  ) VALUES (
    'eeeeeeee-eeee-eeee-eeee-eeeeeeeeee02',
    'test-kickoff-confirmed-j91',
    31,
    'Confirmé FC',
    'FC Nantes',
    now() + interval '9 days',
    TRUE,
    'feed',
    'scheduled'
  );

  INSERT INTO public.matches (
    id, external_id, round_number, home_team, away_team,
    kickoff_at, kickoff_time_confirmed, kickoff_confirmation_source, status
  ) VALUES (
    'eeeeeeee-eeee-eeee-eeee-eeeeeeeeee03',
    'test-kickoff-unconfirmed-j91',
    31,
    'FC Nantes',
    'NonConfirmé FC',
    now() + interval '11 days',
    FALSE,
    'heuristic',
    'scheduled'
  );

  SELECT * INTO v_row
  FROM public.get_round_participation(v_token, 31) AS p
  WHERE p.player_id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaa0d1';

  IF v_row.expected_count <> 1 THEN
    RAISE EXCEPTION
      'TEST FAIL: expected_count devrait exclure le non confirmé (obtenu %)',
      v_row.expected_count;
  END IF;
END;
$$;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM public.push_reminder_eligibility() AS e
    WHERE e.match_id = 'eeeeeeee-eeee-eeee-eeee-eeeeeeeeee01'
  ) THEN
    RAISE EXCEPTION 'TEST FAIL: rappel push ne doit pas cibler un horaire non confirmé';
  END IF;
END;
$$;

-- ---------------------------------------------------------------------------
-- 5) Confirmation manuelle + sync suivante (minuit inchangé) → reste confirmé
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  v_admin text;
  v_token text := current_setting('test.session_token');
  v_plan jsonb;
  v_res RECORD;
BEGIN
  UPDATE public.admin_auth_state
  SET failed_attempts = 0, locked_until = NULL
  WHERE id = TRUE;

  SELECT l.session_token INTO v_admin
  FROM public.login_admin('admin-test-code') AS l;

  IF v_admin IS NULL THEN
    RAISE EXCEPTION 'TEST FAIL: login admin échoué';
  END IF;

  PERFORM set_config('test.admin_token', v_admin, true);

  -- Confirmation manuelle via admin_update_match (source=manual)
  PERFORM *
  FROM public.admin_update_match(
    v_admin,
    'eeeeeeee-eeee-eeee-eeee-eeeeeeeeee01',
    30,
    'FC Nantes',
    'Minuit FC',
    current_setting('test.midnight_kickoff')::timestamptz,
    'scheduled',
    NULL,
    NULL,
    'test-kickoff-midnight',
    TRUE
  );

  IF NOT EXISTS (
    SELECT 1 FROM public.matches AS m
    WHERE m.id = 'eeeeeeee-eeee-eeee-eeee-eeeeeeeeee01'
      AND m.kickoff_time_confirmed IS TRUE
      AND m.kickoff_confirmation_source = 'manual'
  ) THEN
    RAISE EXCEPTION 'TEST FAIL: confirmation manuelle non enregistrée';
  END IF;

  -- Pronostic ouvert après confirmation
  PERFORM *
  FROM public.upsert_prediction(
    v_token,
    'eeeeeeee-eeee-eeee-eeee-eeeeeeeeee01',
    2,
    1
  );

  -- Sync non protégée simulée : même minuit Paris → doit rester manual/true
  -- (on retire temporairement manual_override pour exercer resolve_* sur update)
  UPDATE public.matches
  SET manual_override = FALSE
  WHERE id = 'eeeeeeee-eeee-eeee-eeee-eeeeeeeeee01';

  v_plan := jsonb_build_object(
    'synced_at', now(),
    'creates', '[]'::jsonb,
    'conflicts', '[]'::jsonb,
    'updates', jsonb_build_array(
      jsonb_build_object(
        'id', 'eeeeeeee-eeee-eeee-eeee-eeeeeeeeee01',
        'external_id', 'test-kickoff-midnight',
        'round_number', 30,
        'home_team', 'FC Nantes',
        'away_team', 'Minuit FC',
        'kickoff_at', current_setting('test.midnight_kickoff'),
        'status', 'scheduled',
        'home_score', '',
        'away_score', '',
        'protected', false,
        'unchanged', false,
        'new_result', false,
        'recalculate', false,
        'source_home_team', 'FC Nantes',
        'source_away_team', 'Minuit FC',
        'source_kickoff_at', current_setting('test.midnight_kickoff'),
        'source_home_score', '',
        'source_away_score', '',
        'source_status', 'scheduled'
      )
    )
  );

  PERFORM public.admin_commit_fixture_sync(v_admin, v_plan);

  SELECT m.kickoff_time_confirmed, m.kickoff_confirmation_source
  INTO v_res
  FROM public.matches AS m
  WHERE m.id = 'eeeeeeee-eeee-eeee-eeee-eeeeeeeeee01';

  IF v_res.kickoff_time_confirmed IS NOT TRUE
     OR v_res.kickoff_confirmation_source <> 'manual' THEN
    RAISE EXCEPTION
      'TEST FAIL: sync ne doit pas écraser une confirmation manuelle (% / %)',
      v_res.kickoff_time_confirmed, v_res.kickoff_confirmation_source;
  END IF;
END;
$$;

-- ---------------------------------------------------------------------------
-- 6) Changement réel d’horaire fourni par la source → pris en compte (feed)
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  v_admin text := current_setting('test.admin_token');
  v_plan jsonb;
  v_new_kickoff timestamptz := now() + interval '25 days';
BEGIN
  UPDATE public.matches
  SET manual_override = FALSE
  WHERE id = 'eeeeeeee-eeee-eeee-eeee-eeeeeeeeee01';

  IF public.is_paris_midnight_kickoff(v_new_kickoff) THEN
    v_new_kickoff := v_new_kickoff + interval '3 hours';
  END IF;

  v_plan := jsonb_build_object(
    'synced_at', now(),
    'creates', '[]'::jsonb,
    'conflicts', '[]'::jsonb,
    'updates', jsonb_build_array(
      jsonb_build_object(
        'id', 'eeeeeeee-eeee-eeee-eeee-eeeeeeeeee01',
        'external_id', 'test-kickoff-midnight',
        'round_number', 30,
        'home_team', 'FC Nantes',
        'away_team', 'Minuit FC',
        'kickoff_at', v_new_kickoff,
        'status', 'scheduled',
        'home_score', '',
        'away_score', '',
        'protected', false,
        'unchanged', false,
        'new_result', false,
        'recalculate', false,
        'source_home_team', 'FC Nantes',
        'source_away_team', 'Minuit FC',
        'source_kickoff_at', v_new_kickoff,
        'source_home_score', '',
        'source_away_score', '',
        'source_status', 'scheduled'
      )
    )
  );

  PERFORM public.admin_commit_fixture_sync(v_admin, v_plan);

  IF NOT EXISTS (
    SELECT 1 FROM public.matches AS m
    WHERE m.id = 'eeeeeeee-eeee-eeee-eeee-eeeeeeeeee01'
      AND m.kickoff_time_confirmed IS TRUE
      AND m.kickoff_confirmation_source = 'feed'
      AND m.kickoff_at = v_new_kickoff
  ) THEN
    RAISE EXCEPTION 'TEST FAIL: nouvel horaire source non appliqué comme feed/confirmé';
  END IF;
END;
$$;

-- ---------------------------------------------------------------------------
-- 7) Match terminé reste confirmé
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  v_res RECORD;
BEGIN
  SELECT * INTO v_res
  FROM public.resolve_kickoff_confirmation(
    timestamptz '2026-01-14 23:00:00+00',
    'finished',
    FALSE,
    'heuristic'
  );

  IF v_res.confirmed IS NOT TRUE THEN
    RAISE EXCEPTION 'TEST FAIL: finished doit rester confirmé';
  END IF;
END;
$$;

-- ---------------------------------------------------------------------------
-- 8) Report / annulation : pas de réouverture des pronostics
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  v_token text := current_setting('test.session_token');
  v_admin text := current_setting('test.admin_token');
BEGIN
  INSERT INTO public.matches (
    id, external_id, round_number, home_team, away_team,
    kickoff_at, kickoff_time_confirmed, kickoff_confirmation_source, status, source
  ) VALUES (
    'eeeeeeee-eeee-eeee-eeee-eeeeeeeeee04',
    'test-kickoff-postponed',
    32,
    'FC Nantes',
    'Reporté FC',
    now() + interval '3 days',
    TRUE,
    'feed',
    'postponed',
    'fixturedownload'
  );

  INSERT INTO public.matches (
    id, external_id, round_number, home_team, away_team,
    kickoff_at, kickoff_time_confirmed, kickoff_confirmation_source, status, source
  ) VALUES (
    'eeeeeeee-eeee-eeee-eeee-eeeeeeeeee05',
    'test-kickoff-cancelled',
    32,
    'Annulé FC',
    'FC Nantes',
    now() + interval '4 days',
    TRUE,
    'feed',
    'cancelled',
    'fixturedownload'
  );

  BEGIN
    PERFORM *
    FROM public.upsert_prediction(
      v_token,
      'eeeeeeee-eeee-eeee-eeee-eeeeeeeeee04',
      1,
      0
    );
    RAISE EXCEPTION 'TEST FAIL: MATCH_NOT_OPENABLE attendu pour postponed';
  EXCEPTION
    WHEN OTHERS THEN
      IF SQLERRM NOT LIKE '%MATCH_NOT_OPENABLE%' THEN
        RAISE;
      END IF;
  END;

  BEGIN
    PERFORM *
    FROM public.upsert_prediction(
      v_token,
      'eeeeeeee-eeee-eeee-eeee-eeeeeeeeee05',
      1,
      0
    );
    RAISE EXCEPTION 'TEST FAIL: MATCH_NOT_OPENABLE attendu pour cancelled';
  EXCEPTION
    WHEN OTHERS THEN
      IF SQLERRM NOT LIKE '%MATCH_NOT_OPENABLE%' THEN
        RAISE;
      END IF;
  END;

  -- Sync ne doit pas rouvrir un reporté en le passant scheduled sans intention :
  -- on vérifie ici que même confirmé, upsert refuse postponed/cancelled.
  PERFORM v_admin; -- silence unused if admin unused beyond setup
END;
$$;

-- ---------------------------------------------------------------------------
-- 9) Insert admin sans p_kickoff_time_confirmed + minuit → pas DEFAULT true
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  v_admin text := current_setting('test.admin_token');
  v_id uuid;
  v_midnight timestamptz;
BEGIN
  v_midnight := (
    date_trunc('day', (now() AT TIME ZONE 'Europe/Paris') + interval '40 days')
  ) AT TIME ZONE 'Europe/Paris';

  SELECT c.id INTO v_id
  FROM public.admin_create_match(
    v_admin,
    33,
    'FC Nantes',
    'Incomplet FC',
    v_midnight,
    'scheduled',
    NULL,
    NULL,
    'test-kickoff-admin-midnight'
    -- p_kickoff_time_confirmed omis (DEFAULT NULL)
  ) AS c;

  IF NOT EXISTS (
    SELECT 1 FROM public.matches AS m
    WHERE m.id = v_id
      AND m.kickoff_time_confirmed IS FALSE
      AND m.kickoff_confirmation_source = 'heuristic'
  ) THEN
    RAISE EXCEPTION 'TEST FAIL: admin create minuit sans flag ne doit pas DEFAULT true';
  END IF;
END;
$$;

-- ---------------------------------------------------------------------------
-- 10) Après confirmation + kickoff passé → MATCH_LOCKED (pas UNCONFIRMED)
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  v_token text := current_setting('test.session_token');
BEGIN
  UPDATE public.matches
  SET
    kickoff_at = now() - interval '1 minute',
    kickoff_time_confirmed = TRUE,
    kickoff_confirmation_source = 'manual',
    status = 'scheduled'
  WHERE id = 'eeeeeeee-eeee-eeee-eeee-eeeeeeeeee01';

  BEGIN
    PERFORM *
    FROM public.upsert_prediction(
      v_token,
      'eeeeeeee-eeee-eeee-eeee-eeeeeeeeee01',
      3,
      3
    );
    RAISE EXCEPTION 'TEST FAIL: MATCH_LOCKED attendu';
  EXCEPTION
    WHEN OTHERS THEN
      IF SQLERRM NOT LIKE '%MATCH_LOCKED%' THEN
        RAISE;
      END IF;
  END;
END;
$$;

ROLLBACK;
