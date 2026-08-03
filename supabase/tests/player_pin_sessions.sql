-- Tests PIN + sessions joueur.
-- Exécuter : BEGIN; \i ... ; ROLLBACK;

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
  value = extensions.crypt('test-admin-aln', extensions.gen_salt('bf')),
  updated_at = now()
WHERE key = 'admin_code_hash';

INSERT INTO public.app_settings (key, value)
SELECT 'admin_code_hash', extensions.crypt('test-admin-aln', extensions.gen_salt('bf'))
WHERE NOT EXISTS (
  SELECT 1 FROM public.app_settings AS s WHERE s.key = 'admin_code_hash'
);

INSERT INTO public.players (id, display_name, is_active)
VALUES
  ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaac01', 'Pin Joueur A', TRUE),
  ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaac02', 'Pin Joueur B', TRUE)
ON CONFLICT (id) DO UPDATE
SET display_name = EXCLUDED.display_name, is_active = TRUE;

UPDATE public.players
SET
  pin_hash = NULL,
  must_change_pin = FALSE,
  pin_temporary_expires_at = NULL,
  pin_failed_attempts = 0,
  pin_locked_until = NULL
WHERE id IN (
  'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaac01',
  'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaac02'
);

DELETE FROM public.player_sessions
WHERE player_id IN (
  'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaac01',
  'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaac02'
);

INSERT INTO public.matches (
  id, external_id, round_number, home_team, away_team, kickoff_at, status
) VALUES (
  'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbc1',
  'test-pin-open',
  98,
  'FC Nantes',
  'Pin FC',
  now() + interval '3 days',
  'scheduled'
)
ON CONFLICT (id) DO UPDATE
SET kickoff_at = EXCLUDED.kickoff_at, status = EXCLUDED.status;

DELETE FROM public.predictions
WHERE match_id = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbc1';

-- Anciennes signatures absentes
DO $$
BEGIN
  IF to_regprocedure('public.upsert_prediction(text,uuid,uuid,integer,integer)') IS NOT NULL THEN
    RAISE EXCEPTION 'TEST_FAIL: ancienne upsert_prediction encore présente';
  END IF;
  IF to_regprocedure('public.get_my_predictions(text,uuid)') IS NOT NULL THEN
    RAISE EXCEPTION 'TEST_FAIL: ancienne get_my_predictions encore présente';
  END IF;
  IF to_regprocedure('public.get_visible_predictions(text,uuid)') IS NOT NULL THEN
    RAISE EXCEPTION 'TEST_FAIL: ancienne get_visible_predictions encore présente';
  END IF;
  IF to_regprocedure('public.register_push_subscription(text,uuid,text,text,text,timestamptz,text)') IS NOT NULL THEN
    RAISE EXCEPTION 'TEST_FAIL: ancienne register_push_subscription encore présente';
  END IF;
END;
$$;

-- player_sessions inaccessible en direct pour anon
DO $$
DECLARE
  priv text;
BEGIN
  SELECT privilege_type INTO priv
  FROM information_schema.role_table_grants
  WHERE grantee = 'anon'
    AND table_schema = 'public'
    AND table_name = 'player_sessions'
  LIMIT 1;

  IF priv IS NOT NULL THEN
    RAISE EXCEPTION 'TEST_FAIL: anon a un droit direct sur player_sessions (%)', priv;
  END IF;
END;
$$;

-- Reset PIN admin → temporary PIN
DO $$
DECLARE
  rec RECORD;
BEGIN
  SELECT * INTO rec
  FROM public.admin_reset_player_pin(
    'test-admin-aln',
    'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaac01'
  );

  IF rec.temporary_pin !~ '^\d{6}$' THEN
    RAISE EXCEPTION 'TEST_FAIL: PIN temporaire invalide';
  END IF;

  PERFORM set_config('test.temp_pin_a', rec.temporary_pin, true);

  IF NOT EXISTS (
    SELECT 1 FROM public.players AS pl
    WHERE pl.id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaac01'
      AND pl.must_change_pin IS TRUE
      AND pl.pin_temporary_expires_at > now()
      AND pl.pin_hash IS NOT NULL
  ) THEN
    RAISE EXCEPTION 'TEST_FAIL: must_change_pin / expiration absents';
  END IF;
END;
$$;

-- Login PIN invalide
DO $$
BEGIN
  BEGIN
    PERFORM *
    FROM public.login_player(
      'test-code-aln',
      'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaac01',
      '0000'
    );
    RAISE EXCEPTION 'TEST_FAIL: INVALID_CREDENTIALS attendu';
  EXCEPTION
    WHEN OTHERS THEN
      IF SQLERRM NOT LIKE '%INVALID_CREDENTIALS%' THEN
        RAISE;
      END IF;
  END;
END;
$$;

-- Login PIN valide
DO $$
DECLARE
  rec RECORD;
BEGIN
  SELECT * INTO rec
  FROM public.login_player(
    'test-code-aln',
    'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaac01',
    current_setting('test.temp_pin_a')
  );

  IF rec.session_token !~ '^[0-9a-f]{64}$' THEN
    RAISE EXCEPTION 'TEST_FAIL: jeton trop court / format invalide';
  END IF;
  IF rec.must_change_pin IS NOT TRUE THEN
    RAISE EXCEPTION 'TEST_FAIL: must_change_pin attendu après reset';
  END IF;

  PERFORM set_config('test.session_a', rec.session_token, true);

  -- Hash only in DB
  IF EXISTS (
    SELECT 1 FROM public.player_sessions AS s
    WHERE encode(s.token_hash, 'hex') = rec.session_token
  ) THEN
    RAISE EXCEPTION 'TEST_FAIL: jeton stocké en clair';
  END IF;
END;
$$;

-- Upsert via session
DO $$
DECLARE
  rec RECORD;
BEGIN
  SELECT * INTO rec
  FROM public.upsert_prediction(
    current_setting('test.session_a'),
    'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbc1',
    2,
    1
  );

  IF rec.player_id IS DISTINCT FROM 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaac01' THEN
    RAISE EXCEPTION 'TEST_FAIL: player_id résolu incorrectement';
  END IF;
END;
$$;

-- Session invalide refusée
DO $$
BEGIN
  BEGIN
    PERFORM *
    FROM public.upsert_prediction(
      repeat('ab', 32),
      'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbc1',
      1,
      0
    );
    RAISE EXCEPTION 'TEST_FAIL: INVALID_SESSION attendu';
  EXCEPTION
    WHEN OTHERS THEN
      IF SQLERRM NOT LIKE '%INVALID_SESSION%' THEN
        RAISE;
      END IF;
  END;
END;
$$;

-- Change PIN + révocation autres sessions
DO $$
DECLARE
  other RECORD;
  kept text := current_setting('test.session_a');
BEGIN
  SELECT * INTO other
  FROM public.login_player(
    'test-code-aln',
    'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaac01',
    current_setting('test.temp_pin_a')
  );

  PERFORM public.change_player_pin(kept, current_setting('test.temp_pin_a'), '4321');

  BEGIN
    PERFORM public.assert_player_session(other.session_token);
    RAISE EXCEPTION 'TEST_FAIL: autre session aurait dû être révoquée';
  EXCEPTION
    WHEN OTHERS THEN
      IF SQLERRM NOT LIKE '%INVALID_SESSION%' THEN
        RAISE;
      END IF;
  END;

  -- Session courante toujours valide
  PERFORM public.assert_player_session(kept);
END;
$$;

-- PIN personnel à 4 chiffres accepté après PIN temporaire à 6 chiffres
DO $$
DECLARE
  rec RECORD;
BEGIN
  IF current_setting('test.temp_pin_a') !~ '^\d{6}$' THEN
    RAISE EXCEPTION 'TEST_FAIL: PIN temporaire admin doit faire 6 chiffres';
  END IF;

  SELECT * INTO rec
  FROM public.login_player(
    'test-code-aln',
    'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaac01',
    '4321'
  );

  IF rec.must_change_pin IS TRUE THEN
    RAISE EXCEPTION 'TEST_FAIL: must_change_pin devrait être false après change à 4 chiffres';
  END IF;

  PERFORM set_config('test.session_a', rec.session_token, true);
END;
$$;

-- Logout révoque
DO $$
DECLARE
  rec RECORD;
BEGIN
  SELECT * INTO rec
  FROM public.login_player(
    'test-code-aln',
    'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaac01',
    '4321'
  );

  IF public.logout_player(rec.session_token) IS NOT TRUE THEN
    RAISE EXCEPTION 'TEST_FAIL: logout';
  END IF;

  BEGIN
    PERFORM public.assert_player_session(rec.session_token);
    RAISE EXCEPTION 'TEST_FAIL: session révoquée encore valide';
  EXCEPTION
    WHEN OTHERS THEN
      IF SQLERRM NOT LIKE '%INVALID_SESSION%' THEN
        RAISE;
      END IF;
  END;
END;
$$;

-- Jeton expiré refusé
DO $$
DECLARE
  rec RECORD;
  v_hash bytea;
BEGIN
  SELECT * INTO rec
  FROM public.login_player(
    'test-code-aln',
    'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaac01',
    '4321'
  );

  v_hash := public.hash_session_token(rec.session_token);
  UPDATE public.player_sessions AS s
  SET expires_at = now() - interval '1 minute'
  WHERE s.token_hash = v_hash;

  BEGIN
    PERFORM public.assert_player_session(rec.session_token);
    RAISE EXCEPTION 'TEST_FAIL: session expirée acceptée';
  EXCEPTION
    WHEN OTHERS THEN
      IF SQLERRM NOT LIKE '%INVALID_SESSION%' THEN
        RAISE;
      END IF;
  END;
END;
$$;

-- Rate-limit atomique + même erreur quand verrouillé
DO $$
DECLARE
  i integer;
BEGIN
  PERFORM *
  FROM public.admin_reset_player_pin(
    'test-admin-aln',
    'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaac02'
  );

  FOR i IN 1..5 LOOP
    BEGIN
      PERFORM *
      FROM public.login_player(
        'test-code-aln',
        'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaac02',
        '0000'
      );
    EXCEPTION
      WHEN OTHERS THEN
        IF SQLERRM NOT LIKE '%INVALID_CREDENTIALS%' THEN
          RAISE;
        END IF;
    END;
  END LOOP;

  IF NOT EXISTS (
    SELECT 1 FROM public.players AS pl
    WHERE pl.id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaac02'
      AND pl.pin_locked_until > now()
      AND pl.pin_failed_attempts >= 5
  ) THEN
    RAISE EXCEPTION 'TEST_FAIL: verrouillage après 5 essais';
  END IF;

  -- Même erreur générique pendant le lock
  BEGIN
    PERFORM *
    FROM public.login_player(
      'test-code-aln',
      'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaac02',
      '0000'
    );
    RAISE EXCEPTION 'TEST_FAIL: lock devrait refuser';
  EXCEPTION
    WHEN OTHERS THEN
      IF SQLERRM NOT LIKE '%INVALID_CREDENTIALS%' THEN
        RAISE;
      END IF;
  END;

  PERFORM public.admin_unlock_player_pin(
    'test-admin-aln',
    'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaac02'
  );

  IF EXISTS (
    SELECT 1 FROM public.players AS pl
    WHERE pl.id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaac02'
      AND (pl.pin_failed_attempts <> 0 OR pl.pin_locked_until IS NOT NULL)
  ) THEN
    RAISE EXCEPTION 'TEST_FAIL: unlock admin incomplet';
  END IF;
END;
$$;

-- Données joueurs conservées (pas de truncate)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM public.players
    WHERE id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaac01'
  ) THEN
    RAISE EXCEPTION 'TEST_FAIL: joueur disparu';
  END IF;
END;
$$;

-- MATCH_LOCKED utilise now() DB
DO $$
BEGIN
  IF position_source(
    'public.upsert_prediction(text,uuid,integer,integer)'
  ) NOT LIKE '%now() >= match_row.kickoff_at%' THEN
    RAISE EXCEPTION 'TEST_FAIL: verrouillage match sans now() DB';
  END IF;
END;
$$;

ROLLBACK;
