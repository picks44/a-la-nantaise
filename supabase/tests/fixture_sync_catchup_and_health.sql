-- Tests observabilité Fixture Download (migration 20260818100000).
-- Exécuter via npm run test:sql:local (transaction BEGIN / ROLLBACK).

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

DO $$
DECLARE
  v_token TEXT;
BEGIN
  SELECT l.session_token INTO v_token
  FROM public.login_admin('admin-test-code') AS l;

  IF v_token IS NULL THEN
    RAISE EXCEPTION 'TEST FAIL: connexion admin de test échouée';
  END IF;

  PERFORM set_config('test.admin_token', v_token, true);
END;
$$;

-- 1) Succès : ok=true, erreur vidée, summary persisté, meta lisible
DO $$
DECLARE
  v_token TEXT := current_setting('test.admin_token');
  v_meta RECORD;
BEGIN
  PERFORM public.record_fixture_sync_attempt(
    v_token,
    TRUE,
    'SHOULD_BE_CLEARED',
    'ne doit pas rester',
    jsonb_build_object(
      'created', 0,
      'updated', 2,
      'new_results', 1,
      'points_recalculated', 5,
      'protected', 0
    )
  );

  SELECT * INTO v_meta
  FROM public.admin_get_fixture_sync_meta(v_token);

  IF v_meta.last_attempt_ok IS NOT TRUE THEN
    RAISE EXCEPTION 'TEST FAIL: last_attempt_ok devrait être true';
  END IF;
  IF v_meta.last_attempt_at IS NULL THEN
    RAISE EXCEPTION 'TEST FAIL: last_attempt_at manquant';
  END IF;
  IF v_meta.last_error_code IS NOT NULL OR v_meta.last_error_message IS NOT NULL THEN
    RAISE EXCEPTION 'TEST FAIL: les erreurs devraient être vidées après un succès';
  END IF;
  IF COALESCE((v_meta.last_summary->>'new_results')::INTEGER, 0) <> 1 THEN
    RAISE EXCEPTION 'TEST FAIL: summary new_results attendu 1';
  END IF;
  IF v_meta.source_label <> 'Fixture Download' THEN
    RAISE EXCEPTION 'TEST FAIL: source_label';
  END IF;
END;
$$;

-- 2) Échec : ok=false, code + message conservés
DO $$
DECLARE
  v_token TEXT := current_setting('test.admin_token');
  v_meta RECORD;
BEGIN
  PERFORM public.record_fixture_sync_attempt(
    v_token,
    FALSE,
    'FEED_TIMEOUT',
    'Délai dépassé lors du téléchargement du calendrier.',
    NULL
  );

  SELECT * INTO v_meta
  FROM public.admin_get_fixture_sync_meta(v_token);

  IF v_meta.last_attempt_ok IS NOT FALSE THEN
    RAISE EXCEPTION 'TEST FAIL: last_attempt_ok devrait être false';
  END IF;
  IF v_meta.last_error_code <> 'FEED_TIMEOUT' THEN
    RAISE EXCEPTION 'TEST FAIL: last_error_code (%)', v_meta.last_error_code;
  END IF;
  IF v_meta.last_error_message IS NULL OR length(v_meta.last_error_message) = 0 THEN
    RAISE EXCEPTION 'TEST FAIL: last_error_message manquant';
  END IF;
END;
$$;

-- 3) Session invalide refusée
DO $$
BEGIN
  BEGIN
    PERFORM public.record_fixture_sync_attempt(
      'not-a-session',
      TRUE,
      NULL,
      NULL,
      NULL
    );
    RAISE EXCEPTION 'TEST FAIL: session invalide acceptée';
  EXCEPTION
    WHEN OTHERS THEN
      IF SQLERRM NOT LIKE '%INVALID_ADMIN_SESSION%'
         AND SQLERRM NOT LIKE '%admin%'
         AND SQLERRM NOT LIKE '%session%' THEN
        RAISE;
      END IF;
  END;
END;
$$;

-- 4) Privileges : record + meta exécutables par anon (SECURITY DEFINER, session requise)
DO $$
DECLARE
  v_has_anon BOOLEAN;
BEGIN
  SELECT has_function_privilege(
    'anon',
    'public.record_fixture_sync_attempt(text, boolean, text, text, jsonb)',
    'EXECUTE'
  ) INTO v_has_anon;

  IF NOT v_has_anon THEN
    RAISE EXCEPTION 'TEST FAIL: anon devrait pouvoir exécuter record_fixture_sync_attempt';
  END IF;
END;
$$;

ROLLBACK;
