-- Tests admin RPC (transaction annulée)
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

-- Mauvais code admin
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
BEGIN
  SELECT pl.id INTO new_id
  FROM public.admin_create_player('admin-test-code', '  Zinedine  ') AS pl;

  IF new_id IS NULL THEN
    RAISE EXCEPTION 'TEST FAIL: création participant';
  END IF;

  PERFORM public.admin_update_player_name(
    'admin-test-code',
    new_id,
    'Zizou'
  );
END;
$$;

-- Unicité pseudo case-insensitive
DO $$
BEGIN
  BEGIN
    PERFORM public.admin_create_player('admin-test-code', 'zizou');
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
BEGIN
  SELECT m.id INTO match_id
  FROM public.admin_create_match(
    'admin-test-code',
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
    'admin-test-code',
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
BEGIN
  BEGIN
    PERFORM public.admin_create_match(
      'admin-test-code',
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
BEGIN
  SELECT m.id INTO match_id
  FROM public.admin_create_match(
    'admin-test-code',
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
      'admin-test-code',
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
  v_match_id UUID;
  player_a UUID;
  player_b UUID;
  player_c UUID;
  pts INTEGER;
  recalc INTEGER;
BEGIN
  SELECT pl.id INTO player_a
  FROM public.admin_create_player('admin-test-code', 'Exacteur') AS pl;
  SELECT pl.id INTO player_b
  FROM public.admin_create_player('admin-test-code', 'BonSens') AS pl;
  SELECT pl.id INTO player_c
  FROM public.admin_create_player('admin-test-code', 'ACote') AS pl;

  SELECT m.id INTO v_match_id
  FROM public.admin_create_match(
    'admin-test-code',
    13,
    'FC Nantes',
    'Points FC',
    now() + interval '1 day',
    'scheduled',
    NULL,
    NULL,
    'admin-points'
  ) AS m;

  -- Pronos via upsert (code joueur requis) : insertion directe sécurisée en test
  INSERT INTO public.predictions (
    player_id, match_id, predicted_home_score, predicted_away_score
  ) VALUES
    (player_a, v_match_id, 2, 1),
    (player_b, v_match_id, 3, 0),
    (player_c, v_match_id, 0, 2);

  SELECT r.recalculated_count INTO recalc
  FROM public.admin_set_match_result('admin-test-code', v_match_id, 2, 1) AS r;

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
  PERFORM public.admin_set_match_result('admin-test-code', v_match_id, 0, 2);

  SELECT pr.points INTO pts
  FROM public.predictions AS pr
  WHERE pr.player_id = player_c AND pr.match_id = v_match_id;
  IF pts <> 3 THEN
    RAISE EXCEPTION 'TEST FAIL: recalcul après correction (%)', pts;
  END IF;
END;
$$;

ROLLBACK;
