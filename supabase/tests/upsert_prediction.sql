-- Tests manuels / CI SQL pour upsert_prediction (session).
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

INSERT INTO public.players (id, display_name, is_active, pin_hash, must_change_pin)
VALUES
  (
    'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa1',
    'Testeur Upsert',
    TRUE,
    extensions.crypt('1234', extensions.gen_salt('bf')),
    FALSE
  ),
  (
    'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa2',
    'Autre Upsert',
    TRUE,
    extensions.crypt('5678', extensions.gen_salt('bf')),
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

INSERT INTO public.matches (
  id, external_id, round_number, home_team, away_team, kickoff_at, status
) VALUES
  (
    'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbb1',
    'test-upsert-open',
    99,
    'FC Nantes',
    'Test FC',
    now() + interval '2 days',
    'scheduled'
  ),
  (
    'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbb2',
    'test-upsert-locked',
    99,
    'FC Nantes',
    'Lock FC',
    now() - interval '1 minute',
    'scheduled'
  )
ON CONFLICT (id) DO UPDATE
SET
  kickoff_at = EXCLUDED.kickoff_at,
  status = EXCLUDED.status,
  home_team = EXCLUDED.home_team,
  away_team = EXCLUDED.away_team;

DELETE FROM public.predictions AS pr
WHERE pr.player_id IN (
  'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa1',
  'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa2'
)
  AND pr.match_id IN (
    'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbb1',
    'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbb2'
  );

DELETE FROM public.player_sessions AS s
WHERE s.player_id IN (
  'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa1',
  'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa2'
);

-- Sessions de test (joueur 1 + joueur 2)
DO $$
DECLARE
  v_token text;
  v_token_b text;
BEGIN
  SELECT l.session_token INTO v_token
  FROM public.login_player(
    'test-code-aln',
    'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa1',
    '1234'
  ) AS l;

  SELECT l.session_token INTO v_token_b
  FROM public.login_player(
    'test-code-aln',
    'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa2',
    '5678'
  ) AS l;

  PERFORM set_config('test.session_token', v_token, true);
  PERFORM set_config('test.session_token_b', v_token_b, true);
END;
$$;

-- 1) Création d’un pronostic
DO $$
DECLARE
  row_count integer;
  v_token text := current_setting('test.session_token');
BEGIN
  PERFORM *
  FROM public.upsert_prediction(
    v_token,
    'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbb1',
    2,
    1
  );

  SELECT count(*)::integer INTO row_count
  FROM public.predictions AS pr
  WHERE pr.player_id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa1'
    AND pr.match_id = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbb1'
    AND pr.predicted_home_score = 2
    AND pr.predicted_away_score = 1;

  IF row_count <> 1 THEN
    RAISE EXCEPTION 'TEST FAIL: création du pronostic';
  END IF;
END;
$$;

-- 2) Modification du même pronostic
DO $$
DECLARE
  row_count integer;
  home_score integer;
  v_token text := current_setting('test.session_token');
BEGIN
  PERFORM *
  FROM public.upsert_prediction(
    v_token,
    'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbb1',
    3,
    0
  );

  SELECT pr.predicted_home_score, count(*) OVER ()
  INTO home_score, row_count
  FROM public.predictions AS pr
  WHERE pr.player_id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa1'
    AND pr.match_id = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbb1';

  IF home_score <> 3 OR row_count <> 1 THEN
    RAISE EXCEPTION 'TEST FAIL: modification / unicité joueur+match';
  END IF;
END;
$$;

-- 3) Unicité joueur + match (une seule ligne)
DO $$
DECLARE
  row_count integer;
BEGIN
  SELECT count(*)::integer INTO row_count
  FROM public.predictions AS pr
  WHERE pr.player_id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa1'
    AND pr.match_id = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbb1';

  IF row_count <> 1 THEN
    RAISE EXCEPTION 'TEST FAIL: unicité player_id + match_id (%)', row_count;
  END IF;
END;
$$;

-- 4) Refus après le coup d’envoi (horloge DB)
DO $$
DECLARE
  v_token text := current_setting('test.session_token');
BEGIN
  BEGIN
    PERFORM *
    FROM public.upsert_prediction(
      v_token,
      'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbb2',
      1,
      1
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

-- 5) Confidentialité : lecture limitée à ses propres pronostics avant kickoff
DO $$
DECLARE
  v_token text := current_setting('test.session_token');
  v_token_b text := current_setting('test.session_token_b');
  v_count integer;
  v_other_id uuid;
BEGIN
  -- Joueur B enregistre un prono distinct
  PERFORM *
  FROM public.upsert_prediction(
    v_token_b,
    'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbb1',
    4,
    2
  );

  SELECT count(*)::integer INTO v_count
  FROM public.get_my_predictions(v_token);

  IF v_count <> 1 THEN
    RAISE EXCEPTION 'TEST FAIL: get_my_predictions doit renvoyer uniquement le prono du joueur A (%)', v_count;
  END IF;

  SELECT pr.player_id INTO v_other_id
  FROM public.get_my_predictions(v_token) AS pr
  WHERE pr.player_id <> 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa1';

  IF FOUND THEN
    RAISE EXCEPTION 'TEST FAIL: get_my_predictions a exposé un autre joueur';
  END IF;

  -- Avant kickoff, get_visible_predictions ne doit pas exposer le score de B à A
  SELECT count(*)::integer INTO v_count
  FROM public.get_visible_predictions(v_token) AS pr
  WHERE pr.player_id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa2';

  IF v_count <> 0 THEN
    RAISE EXCEPTION 'TEST FAIL: score d’un autre joueur visible avant kickoff';
  END IF;
END;
$$;

-- 6) Pas d’usurpation : la session lie le joueur, pas un player_id client
DO $$
BEGIN
  IF to_regprocedure('public.upsert_prediction(text,uuid,uuid,integer,integer)') IS NOT NULL THEN
    RAISE EXCEPTION 'TEST FAIL: ancienne signature upsert_prediction encore présente';
  END IF;
  IF to_regprocedure('public.get_my_predictions(text,uuid)') IS NOT NULL THEN
    RAISE EXCEPTION 'TEST FAIL: ancienne signature get_my_predictions encore présente';
  END IF;
END;
$$;

ROLLBACK;
