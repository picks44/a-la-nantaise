-- Tests sessions admin (login_admin / admin_sessions / admin_auth_state) —
-- migration 20260804120000_admin_sessions.sql.
-- Exécuter dans une transaction : BEGIN; \i ... ; ROLLBACK;

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

-- Repart d’un état d’auth admin propre entre scénarios.
UPDATE public.admin_auth_state
SET failed_attempts = 0, locked_until = NULL
WHERE id = TRUE;

UPDATE public.admin_sessions
SET revoked_at = now()
WHERE revoked_at IS NULL;

-- 1) Mauvais code : résultat vide (pas d’exception), compteur incrémenté
DO $$
DECLARE
  v_count integer;
  v_attempts integer;
BEGIN
  SELECT count(*)::integer INTO v_count
  FROM public.login_admin('mauvais-code');

  IF v_count <> 0 THEN
    RAISE EXCEPTION 'TEST_FAIL: mauvais code devrait renvoyer 0 ligne (%)', v_count;
  END IF;

  SELECT failed_attempts INTO v_attempts
  FROM public.admin_auth_state
  WHERE id = TRUE;

  IF v_attempts <> 1 THEN
    RAISE EXCEPTION 'TEST_FAIL: failed_attempts devrait être 1 après un échec (%)', v_attempts;
  END IF;
END;
$$;

-- 2) Après 5 échecs cumulés : verrouillage, puis ADMIN_LOCKED même avec le bon code
DO $$
DECLARE
  i integer;
  v_count integer;
BEGIN
  FOR i IN 2..5 LOOP
    SELECT count(*)::integer INTO v_count
    FROM public.login_admin('mauvais-code');
    IF v_count <> 0 THEN
      RAISE EXCEPTION 'TEST_FAIL: tentative % aurait dû échouer silencieusement', i;
    END IF;
  END LOOP;

  IF NOT EXISTS (
    SELECT 1 FROM public.admin_auth_state
    WHERE id = TRUE AND failed_attempts >= 5 AND locked_until > now()
  ) THEN
    RAISE EXCEPTION 'TEST_FAIL: verrouillage attendu après 5 essais';
  END IF;

  BEGIN
    PERFORM * FROM public.login_admin('admin-test-code');
    RAISE EXCEPTION 'TEST_FAIL: ADMIN_LOCKED attendu même avec le bon code pendant le verrouillage';
  EXCEPTION
    WHEN OTHERS THEN
      IF SQLERRM NOT LIKE '%ADMIN_LOCKED%' THEN
        RAISE;
      END IF;
  END;
END;
$$;

-- Déverrouillage (reset direct de l’état, comme admin_unlock_player_pin
-- le ferait côté PIN joueur) pour poursuivre le scénario.
UPDATE public.admin_auth_state
SET failed_attempts = 0, locked_until = NULL
WHERE id = TRUE;

-- 3) Bon code : jeton de session renvoyé, compteur remis à zéro
DO $$
DECLARE
  v_token text;
  v_attempts integer;
BEGIN
  SELECT l.session_token INTO v_token
  FROM public.login_admin('admin-test-code') AS l;

  IF v_token IS NULL OR v_token !~ '^[0-9a-f]{64}$' THEN
    RAISE EXCEPTION 'TEST_FAIL: jeton admin manquant ou mal formé';
  END IF;

  SELECT failed_attempts INTO v_attempts
  FROM public.admin_auth_state
  WHERE id = TRUE;
  IF v_attempts <> 0 THEN
    RAISE EXCEPTION 'TEST_FAIL: failed_attempts devrait être remis à zéro après succès (%)', v_attempts;
  END IF;

  PERFORM set_config('test.admin_token', v_token, true);
END;
$$;

-- token_hash stocké n’est jamais égal au jeton brut (hash seulement)
DO $$
DECLARE
  v_token text := current_setting('test.admin_token');
  v_hash_hex text;
BEGIN
  SELECT encode(s.token_hash, 'hex') INTO v_hash_hex
  FROM public.admin_sessions AS s
  WHERE s.revoked_at IS NULL AND s.expires_at > now()
  ORDER BY s.created_at DESC
  LIMIT 1;

  IF v_hash_hex IS NULL THEN
    RAISE EXCEPTION 'TEST_FAIL: session admin introuvable pour vérifier le hash';
  END IF;

  IF v_hash_hex = v_token THEN
    RAISE EXCEPTION 'TEST_FAIL: token_hash ne doit jamais être égal au jeton brut';
  END IF;
END;
$$;

-- 4) admin_get_stats fonctionne avec la session admin
DO $$
DECLARE
  v_token text := current_setting('test.admin_token');
  rec RECORD;
BEGIN
  SELECT * INTO rec FROM public.admin_get_stats(v_token);
  IF NOT FOUND OR rec.supabase_ok IS NOT TRUE THEN
    RAISE EXCEPTION 'TEST_FAIL: admin_get_stats devrait réussir avec une session admin valide';
  END IF;
END;
$$;

-- 5) admin_get_stats refuse un jeton de session joueur (namespaces distincts)
DO $$
DECLARE
  v_player_token text;
BEGIN
  INSERT INTO public.players (id, display_name, is_active, pin_hash, must_change_pin)
  VALUES (
    'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaa0f1',
    'Testeur SessionAdmin',
    TRUE,
    extensions.crypt('1357', extensions.gen_salt('bf')),
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

  DELETE FROM public.player_sessions
  WHERE player_id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaa0f1';

  SELECT l.session_token INTO v_player_token
  FROM public.login_player(
    'test-code-aln',
    'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaa0f1',
    '1357'
  ) AS l;

  IF v_player_token IS NULL THEN
    RAISE EXCEPTION 'TEST_FAIL: connexion joueur de test échouée';
  END IF;

  BEGIN
    PERFORM * FROM public.admin_get_stats(v_player_token);
    RAISE EXCEPTION 'TEST_FAIL: INVALID_ADMIN_SESSION attendu pour un jeton de session joueur';
  EXCEPTION
    WHEN OTHERS THEN
      IF SQLERRM NOT LIKE '%INVALID_ADMIN_SESSION%' THEN
        RAISE;
      END IF;
  END;
END;
$$;

-- 6) logout_admin révoque la session, puis admin_get_stats échoue
DO $$
DECLARE
  v_token text := current_setting('test.admin_token');
BEGIN
  IF public.logout_admin(v_token) IS NOT TRUE THEN
    RAISE EXCEPTION 'TEST_FAIL: logout_admin devrait réussir sur une session active';
  END IF;

  BEGIN
    PERFORM * FROM public.admin_get_stats(v_token);
    RAISE EXCEPTION 'TEST_FAIL: INVALID_ADMIN_SESSION attendu après logout_admin';
  EXCEPTION
    WHEN OTHERS THEN
      IF SQLERRM NOT LIKE '%INVALID_ADMIN_SESSION%' THEN
        RAISE;
      END IF;
  END;
END;
$$;

-- 7) Anciennes signatures p_admin_code absentes de toutes les RPC admin_*
DO $$
DECLARE
  v_count integer;
BEGIN
  SELECT COUNT(*)::integer INTO v_count
  FROM pg_proc
  WHERE proname = 'admin_get_stats'
    AND pg_get_function_identity_arguments(oid) LIKE '%admin_code%';

  IF v_count <> 0 THEN
    RAISE EXCEPTION 'TEST_FAIL: admin_get_stats accepte encore p_admin_code (%)', v_count;
  END IF;

  SELECT COUNT(*)::integer INTO v_count
  FROM pg_proc AS p
  JOIN pg_namespace AS n ON n.oid = p.pronamespace
  WHERE n.nspname = 'public'
    AND p.proname LIKE 'admin_%'
    AND pg_get_function_identity_arguments(p.oid) LIKE '%admin_code%';

  IF v_count <> 0 THEN
    RAISE EXCEPTION 'TEST_FAIL: % RPC admin_* accepte(nt) encore p_admin_code', v_count;
  END IF;
END;
$$;

-- 8) Expiration 12h : session expirée refusée
DO $$
DECLARE
  v_token text;
  v_hash bytea;
BEGIN
  UPDATE public.admin_auth_state
  SET failed_attempts = 0, locked_until = NULL
  WHERE id = TRUE;

  SELECT l.session_token INTO v_token
  FROM public.login_admin('admin-test-code') AS l;

  v_hash := public.hash_session_token(v_token);

  UPDATE public.admin_sessions
  SET expires_at = now() - interval '1 minute'
  WHERE token_hash = v_hash;

  BEGIN
    PERFORM * FROM public.admin_get_stats(v_token);
    RAISE EXCEPTION 'TEST_FAIL: INVALID_ADMIN_SESSION attendu pour session expirée';
  EXCEPTION
    WHEN OTHERS THEN
      IF SQLERRM NOT LIKE '%INVALID_ADMIN_SESSION%' THEN
        RAISE;
      END IF;
  END;
END;
$$;

-- 9) Compteur d’échecs persiste (pas de rollback par exception) + permissions
DO $$
DECLARE
  v_before integer;
  v_after integer;
BEGIN
  UPDATE public.admin_auth_state
  SET failed_attempts = 0, locked_until = NULL
  WHERE id = TRUE;

  SELECT failed_attempts INTO v_before FROM public.admin_auth_state WHERE id = TRUE;

  BEGIN
    -- login échoué silencieux (RETURN) — le compteur doit rester après COMMIT logique
    PERFORM * FROM public.login_admin('encore-mauvais');
  END;

  SELECT failed_attempts INTO v_after FROM public.admin_auth_state WHERE id = TRUE;
  IF v_after <> v_before + 1 THEN
    RAISE EXCEPTION 'TEST_FAIL: compteur non persisté après échec (% → %)', v_before, v_after;
  END IF;
END;
$$;

-- 10) cleanup_expired_admin_sessions ne touche jamais une session valide
DO $$
DECLARE
  v_token text;
  v_hash bytea;
  v_valid_id uuid;
  v_deleted integer;
  v_dead_id uuid;
BEGIN
  UPDATE public.admin_auth_state
  SET failed_attempts = 0, locked_until = NULL
  WHERE id = TRUE;

  SELECT l.session_token INTO v_token
  FROM public.login_admin('admin-test-code') AS l;
  v_hash := public.hash_session_token(v_token);

  SELECT s.id INTO v_valid_id
  FROM public.admin_sessions AS s
  WHERE s.token_hash = v_hash;

  INSERT INTO public.admin_sessions (token_hash, expires_at, revoked_at)
  VALUES (
    decode(repeat('ab', 32), 'hex'),
    now() - interval '1 hour',
    NULL
  )
  RETURNING id INTO v_dead_id;

  v_deleted := public.cleanup_expired_admin_sessions();

  IF NOT EXISTS (
    SELECT 1 FROM public.admin_sessions AS s WHERE s.id = v_valid_id
  ) THEN
    RAISE EXCEPTION 'TEST_FAIL: cleanup a supprimé une session encore valide';
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.admin_sessions AS s WHERE s.id = v_dead_id
  ) THEN
    RAISE EXCEPTION 'TEST_FAIL: cleanup aurait dû supprimer la session expirée';
  END IF;

  IF v_deleted < 1 THEN
    RAISE EXCEPTION 'TEST_FAIL: cleanup devrait supprimer au moins 1 ligne';
  END IF;

  -- La session valide fonctionne toujours
  PERFORM * FROM public.admin_get_stats(v_token);
END;
$$;

-- 11) Permissions : login_admin / admin_get_stats exécutables par anon ;
--     assert_admin_session / cleanup / hash helpers non exposés
DO $$
BEGIN
  IF NOT has_function_privilege('anon', 'public.login_admin(text)', 'EXECUTE') THEN
    RAISE EXCEPTION 'TEST_FAIL: anon doit pouvoir exécuter login_admin';
  END IF;

  IF NOT has_function_privilege('authenticated', 'public.login_admin(text)', 'EXECUTE') THEN
    RAISE EXCEPTION 'TEST_FAIL: authenticated doit pouvoir exécuter login_admin';
  END IF;

  IF NOT has_function_privilege('anon', 'public.admin_get_stats(text)', 'EXECUTE') THEN
    RAISE EXCEPTION 'TEST_FAIL: anon doit pouvoir exécuter admin_get_stats';
  END IF;

  IF has_function_privilege('anon', 'public.assert_admin_session(text)', 'EXECUTE') THEN
    RAISE EXCEPTION 'TEST_FAIL: assert_admin_session ne doit pas être exécutable par anon';
  END IF;

  IF has_function_privilege('anon', 'public.cleanup_expired_admin_sessions()', 'EXECUTE') THEN
    RAISE EXCEPTION 'TEST_FAIL: cleanup_expired_admin_sessions ne doit pas être exécutable par anon';
  END IF;

  IF has_function_privilege('anon', 'public.assert_admin_code(text)', 'EXECUTE') THEN
    RAISE EXCEPTION 'TEST_FAIL: assert_admin_code ne doit plus être exécutable par anon';
  END IF;

  IF has_function_privilege('anon', 'public.resolve_kickoff_confirmation(timestamptz, text, boolean, text)', 'EXECUTE') THEN
    RAISE EXCEPTION 'TEST_FAIL: resolve_kickoff_confirmation ne doit pas être exécutable par anon';
  END IF;
END;
$$;

-- 12) Verrouillage 15 minutes : locked_until ≈ now()+15m après 5 échecs
DO $$
DECLARE
  i integer;
  v_locked timestamptz;
BEGIN
  UPDATE public.admin_auth_state
  SET failed_attempts = 0, locked_until = NULL
  WHERE id = TRUE;

  FOR i IN 1..5 LOOP
    PERFORM * FROM public.login_admin('mauvais-code-lock');
  END LOOP;

  SELECT locked_until INTO v_locked
  FROM public.admin_auth_state
  WHERE id = TRUE;

  IF v_locked IS NULL
     OR v_locked < now() + interval '14 minutes'
     OR v_locked > now() + interval '16 minutes'
  THEN
    RAISE EXCEPTION 'TEST_FAIL: locked_until devrait être ≈ now()+15m (obtenu %)', v_locked;
  END IF;
END;
$$;

ROLLBACK;
