-- Tests admin RPC (transaction annulée)
-- Depuis la migration sessions admin (20260804120000), les RPC admin_*
-- prennent un p_admin_session_token — plus de p_admin_code direct.
BEGIN;

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

UPDATE public.admin_auth_state
SET failed_attempts = 0, locked_until = NULL
WHERE id = TRUE;

-- Session admin de test (réutilisée par tous les scénarios ci-dessous)
DO $$
DECLARE
  v_token text;
BEGIN
  SELECT l.session_token INTO v_token
  FROM public.login_admin('admin-test-code') AS l;

  IF v_token IS NULL THEN
    RAISE EXCEPTION 'TEST FAIL: connexion admin de test échouée';
  END IF;

  PERFORM set_config('test.admin_token', v_token, true);
END;
$$;

-- Mauvais code admin (jeton de session invalide)
DO $$
BEGIN
  IF public.verify_admin_code('mauvais') THEN
    RAISE EXCEPTION 'TEST FAIL: mauvais code admin accepté';
  END IF;
END;
$$;

-- Création participant
DO $$
DECLARE
  new_id UUID;
  v_token text := current_setting('test.admin_token');
BEGIN
  SELECT pl.id INTO new_id
  FROM public.admin_create_player(v_token, '  Zinedine  ') AS pl;

  IF new_id IS NULL THEN
    RAISE EXCEPTION 'TEST FAIL: création participant';
  END IF;

  PERFORM public.admin_update_player_name(
    v_token,
    new_id,
    'Zizou'
  );
END;
$$;

-- Unicité pseudo case-insensitive
DO $$
DECLARE
  v_token text := current_setting('test.admin_token');
BEGIN
  BEGIN
    PERFORM public.admin_create_player(v_token, 'zizou');
    RAISE EXCEPTION 'TEST FAIL: doublon pseudo accepté';
  EXCEPTION
    WHEN OTHERS THEN
      IF SQLERRM NOT LIKE '%DUPLICATE_PLAYER_NAME%' THEN
        RAISE;
      END IF;
  END;
END;
$$;

-- Création match valide
DO $$
DECLARE
  match_id UUID;
  v_token text := current_setting('test.admin_token');
BEGIN
  SELECT m.id INTO match_id
  FROM public.admin_create_match(
    v_token,
    10,
    'FC Nantes',
    'Test United',
    now() + interval '3 days',
    'scheduled',
    NULL,
    NULL,
    'admin-test-match'
  ) AS m;

  IF match_id IS NULL THEN
    RAISE EXCEPTION 'TEST FAIL: création match';
  END IF;

  PERFORM public.admin_update_match(
    v_token,
    match_id,
    10,
    'FC Nantes',
    'Test United',
    now() + interval '4 days',
    'scheduled',
    NULL,
    NULL,
    'admin-test-match'
  );
END;
$$;

-- Refus sans FC Nantes
DO $$
DECLARE
  v_token text := current_setting('test.admin_token');
BEGIN
  BEGIN
    PERFORM public.admin_create_match(
      v_token,
      11,
      'Stade Rennais',
      'OM',
      now() + interval '5 days',
      'scheduled',
      NULL,
      NULL,
      NULL
    );
    RAISE EXCEPTION 'TEST FAIL: match sans Nantes accepté';
  EXCEPTION
    WHEN OTHERS THEN
      IF SQLERRM NOT LIKE '%INVALID_NANTES_FIXTURE%' THEN
        RAISE;
      END IF;
  END;
END;
$$;

-- Refus résultat incomplet
DO $$
DECLARE
  match_id UUID;
  v_token text := current_setting('test.admin_token');
BEGIN
  SELECT m.id INTO match_id
  FROM public.admin_create_match(
    v_token,
    12,
    'FC Nantes',
    'Incomplete FC',
    now() - interval '2 hours',
    'scheduled',
    NULL,
    NULL,
    'admin-incomplete'
  ) AS m;

  BEGIN
    PERFORM public.admin_set_match_result(
      v_token,
      match_id,
      2,
      NULL
    );
    RAISE EXCEPTION 'TEST FAIL: résultat incomplet accepté';
  EXCEPTION
    WHEN OTHERS THEN
      IF SQLERRM NOT LIKE '%INCOMPLETE_RESULT%'
         AND SQLERRM NOT LIKE '%INVALID_SCORE%' THEN
        RAISE;
      END IF;
  END;
END;
$$;

-- Barème 3 / 1 / 0 + recalcul après correction
DO $$
DECLARE
  v_token text := current_setting('test.admin_token');
  v_match_id UUID;
  player_a UUID;
  player_b UUID;
  player_c UUID;
  pts INTEGER;
  recalc INTEGER;
BEGIN
  SELECT pl.id INTO player_a
  FROM public.admin_create_player(v_token, 'Exacteur') AS pl;
  SELECT pl.id INTO player_b
  FROM public.admin_create_player(v_token, 'BonSens') AS pl;
  SELECT pl.id INTO player_c
  FROM public.admin_create_player(v_token, 'ACote') AS pl;

  SELECT m.id INTO v_match_id
  FROM public.admin_create_match(
    v_token,
    13,
    'FC Nantes',
    'Points FC',
    now() + interval '1 day',
    'scheduled',
    NULL,
    NULL,
    'admin-points'
  ) AS m;

  -- Pronos via upsert (session requise) : insertion directe sécurisée en test
  INSERT INTO public.predictions (
    player_id, match_id, predicted_home_score, predicted_away_score
  ) VALUES
    (player_a, v_match_id, 2, 1),
    (player_b, v_match_id, 3, 0),
    (player_c, v_match_id, 0, 2);

  SELECT r.recalculated_count INTO recalc
  FROM public.admin_set_match_result(v_token, v_match_id, 2, 1) AS r;

  IF recalc <> 3 THEN
    RAISE EXCEPTION 'TEST FAIL: recalcul initial (%)', recalc;
  END IF;

  SELECT pr.points INTO pts
  FROM public.predictions AS pr
  WHERE pr.player_id = player_a AND pr.match_id = v_match_id;
  IF pts <> 3 THEN
    RAISE EXCEPTION 'TEST FAIL: score exact (%)', pts;
  END IF;

  SELECT pr.points INTO pts
  FROM public.predictions AS pr
  WHERE pr.player_id = player_b AND pr.match_id = v_match_id;
  IF pts <> 1 THEN
    RAISE EXCEPTION 'TEST FAIL: bon résultat (%)', pts;
  END IF;

  SELECT pr.points INTO pts
  FROM public.predictions AS pr
  WHERE pr.player_id = player_c AND pr.match_id = v_match_id;
  IF pts <> 0 THEN
    RAISE EXCEPTION 'TEST FAIL: mauvais résultat (%)', pts;
  END IF;

  -- Correction du score → recalcul
  PERFORM public.admin_set_match_result(v_token, v_match_id, 0, 2);

  SELECT pr.points INTO pts
  FROM public.predictions AS pr
  WHERE pr.player_id = player_c AND pr.match_id = v_match_id;
  IF pts <> 3 THEN
    RAISE EXCEPTION 'TEST FAIL: recalcul après correction (%)', pts;
  END IF;
END;
$$;

-- Session invalide refusée par les RPC admin (p_admin_code disparu)
DO $$
BEGIN
  BEGIN
    PERFORM public.admin_get_players(repeat('0', 64));
    RAISE EXCEPTION 'TEST FAIL: session admin invalide acceptée';
  EXCEPTION
    WHEN OTHERS THEN
      IF SQLERRM NOT LIKE '%INVALID_ADMIN_SESSION%' THEN
        RAISE;
      END IF;
  END;
END;
$$;

-- Anciennes signatures p_admin_code absentes des RPC admin_*
DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM pg_proc AS p
    JOIN pg_namespace AS n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public'
      AND p.proname IN (
        'admin_get_players', 'admin_create_player', 'admin_update_player_name',
        'admin_set_player_active', 'admin_get_matches', 'admin_create_match',
        'admin_update_match', 'admin_set_match_result', 'admin_get_stats',
        'admin_clear_match_override', 'admin_get_fixture_sync_meta',
        'admin_commit_fixture_sync', 'admin_update_access_code',
        'admin_reset_player_pin', 'admin_unlock_player_pin'
      )
      AND pg_get_function_identity_arguments(p.oid) LIKE '%admin_code%'
  ) THEN
    RAISE EXCEPTION 'TEST FAIL: une RPC admin_* accepte encore p_admin_code';
  END IF;
END;
$$;

ROLLBACK;
