-- Tests enforcement serveur de must_change_pin — migration 20260804100000.
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
VALUES (
  'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaa0e1',
  'Testeur MustChange',
  TRUE,
  extensions.crypt('9999', extensions.gen_salt('bf')),
  TRUE
)
ON CONFLICT (id) DO UPDATE
SET
  display_name = EXCLUDED.display_name,
  is_active = TRUE,
  pin_hash = EXCLUDED.pin_hash,
  must_change_pin = TRUE,
  pin_failed_attempts = 0,
  pin_locked_until = NULL,
  pin_temporary_expires_at = NULL;

DELETE FROM public.player_sessions
WHERE player_id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaa0e1';

DELETE FROM public.predictions
WHERE player_id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaa0e1';

INSERT INTO public.matches (
  id, external_id, round_number, home_team, away_team, kickoff_at, status
) VALUES (
  'ffffffff-ffff-ffff-ffff-ffffffffff01',
  'test-must-change-pin-open',
  95,
  'FC Nantes',
  'MustChange FC',
  now() + interval '2 days',
  'scheduled'
)
ON CONFLICT (id) DO UPDATE
SET kickoff_at = EXCLUDED.kickoff_at, status = EXCLUDED.status;

-- Connexion avec un PIN valide, must_change_pin déjà vrai avant tout login
DO $$
DECLARE
  v_token text;
  v_must_change boolean;
BEGIN
  SELECT l.session_token, l.must_change_pin INTO v_token, v_must_change
  FROM public.login_player(
    'test-code-aln',
    'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaa0e1',
    '9999'
  ) AS l;

  IF v_token IS NULL THEN
    RAISE EXCEPTION 'TEST FAIL: connexion joueur de test échouée';
  END IF;
  IF v_must_change IS NOT TRUE THEN
    RAISE EXCEPTION 'TEST FAIL: must_change_pin devrait être vrai après ce login';
  END IF;

  PERFORM set_config('test.session_token', v_token, true);
END;
$$;

-- get_matches refuse tant que le PIN n’a pas été changé
DO $$
DECLARE
  v_token text := current_setting('test.session_token');
BEGIN
  BEGIN
    PERFORM * FROM public.get_matches(v_token);
    RAISE EXCEPTION 'TEST FAIL: PIN_CHANGE_REQUIRED attendu sur get_matches';
  EXCEPTION
    WHEN OTHERS THEN
      IF SQLERRM NOT LIKE '%PIN_CHANGE_REQUIRED%' THEN
        RAISE;
      END IF;
  END;
END;
$$;

-- get_ranking refuse tant que le PIN n’a pas été changé
DO $$
DECLARE
  v_token text := current_setting('test.session_token');
BEGIN
  BEGIN
    PERFORM * FROM public.get_ranking(v_token);
    RAISE EXCEPTION 'TEST FAIL: PIN_CHANGE_REQUIRED attendu sur get_ranking';
  EXCEPTION
    WHEN OTHERS THEN
      IF SQLERRM NOT LIKE '%PIN_CHANGE_REQUIRED%' THEN
        RAISE;
      END IF;
  END;
END;
$$;

-- upsert_prediction refuse tant que le PIN n’a pas été changé
DO $$
DECLARE
  v_token text := current_setting('test.session_token');
BEGIN
  BEGIN
    PERFORM *
    FROM public.upsert_prediction(
      v_token,
      'ffffffff-ffff-ffff-ffff-ffffffffff01',
      1,
      0
    );
    RAISE EXCEPTION 'TEST FAIL: PIN_CHANGE_REQUIRED attendu sur upsert_prediction';
  EXCEPTION
    WHEN OTHERS THEN
      IF SQLERRM NOT LIKE '%PIN_CHANGE_REQUIRED%' THEN
        RAISE;
      END IF;
  END;
END;
$$;

-- get_session_player reste accessible (hors assert_player_session)
DO $$
DECLARE
  v_token text := current_setting('test.session_token');
  rec RECORD;
BEGIN
  SELECT * INTO rec FROM public.get_session_player(v_token);
  IF NOT FOUND THEN
    RAISE EXCEPTION 'TEST FAIL: get_session_player devrait rester accessible';
  END IF;
  IF rec.must_change_pin IS NOT TRUE THEN
    RAISE EXCEPTION 'TEST FAIL: get_session_player devrait refléter must_change_pin=true';
  END IF;
END;
$$;

-- change_player_pin réussit et lève le flag, sans révoquer la session courante
DO $$
DECLARE
  v_token text := current_setting('test.session_token');
BEGIN
  IF public.change_player_pin(v_token, '9999', '4242') IS NOT TRUE THEN
    RAISE EXCEPTION 'TEST FAIL: change_player_pin devrait réussir';
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.players AS pl
    WHERE pl.id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaa0e1'
      AND pl.must_change_pin IS TRUE
  ) THEN
    RAISE EXCEPTION 'TEST FAIL: must_change_pin devrait être levé après changement';
  END IF;
END;
$$;

-- get_matches fonctionne désormais avec la même session
DO $$
DECLARE
  v_token text := current_setting('test.session_token');
  v_count integer;
BEGIN
  SELECT count(*)::integer INTO v_count FROM public.get_matches(v_token);
  IF v_count < 1 THEN
    RAISE EXCEPTION 'TEST FAIL: get_matches devrait fonctionner après changement de PIN';
  END IF;
END;
$$;

ROLLBACK;
