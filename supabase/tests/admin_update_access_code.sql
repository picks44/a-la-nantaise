-- Test manuel (SQL Editor) — se termine toujours par ROLLBACK.
-- Ne pas exécuter en production hors transaction.
-- Depuis la migration sessions admin (20260804120000), admin_update_access_code
-- prend un p_admin_session_token — plus de p_admin_code direct.

BEGIN;

-- Préparation isolée
UPDATE public.app_settings
SET value = extensions.crypt('ancien-code-groupe', extensions.gen_salt('bf'))
WHERE key = 'access_code_hash';

UPDATE public.app_settings
SET value = extensions.crypt('code-admin-test', extensions.gen_salt('bf'))
WHERE key = 'admin_code_hash';

UPDATE public.admin_auth_state
SET failed_attempts = 0, locked_until = NULL
WHERE id = TRUE;

DO $$
DECLARE
  v_token text;
BEGIN
  SELECT l.session_token INTO v_token
  FROM public.login_admin('code-admin-test') AS l;

  IF v_token IS NULL THEN
    RAISE EXCEPTION 'TEST_FAIL: connexion admin de test échouée';
  END IF;

  PERFORM set_config('test.admin_token', v_token, true);

  -- Session admin invalide
  BEGIN
    PERFORM public.admin_update_access_code(repeat('0', 64), 'nouveau-code-ok');
    RAISE EXCEPTION 'TEST_FAIL: session admin invalide acceptée';
  EXCEPTION
    WHEN OTHERS THEN
      IF SQLERRM NOT LIKE '%INVALID_ADMIN_SESSION%' THEN
        RAISE;
      END IF;
  END;

  -- Code vide
  BEGIN
    PERFORM public.admin_update_access_code(v_token, '   ');
    RAISE EXCEPTION 'TEST_FAIL: code vide accepté';
  EXCEPTION
    WHEN OTHERS THEN
      IF SQLERRM NOT LIKE '%INVALID_ACCESS_CODE%' THEN
        RAISE;
      END IF;
  END;

  -- Trop court
  BEGIN
    PERFORM public.admin_update_access_code(v_token, 'abc');
    RAISE EXCEPTION 'TEST_FAIL: code trop court accepté';
  EXCEPTION
    WHEN OTHERS THEN
      IF SQLERRM NOT LIKE '%INVALID_ACCESS_CODE_LENGTH%' THEN
        RAISE;
      END IF;
  END;

  -- Trop long
  BEGIN
    PERFORM public.admin_update_access_code(
      v_token,
      repeat('x', 65)
    );
    RAISE EXCEPTION 'TEST_FAIL: code trop long accepté';
  EXCEPTION
    WHEN OTHERS THEN
      IF SQLERRM NOT LIKE '%INVALID_ACCESS_CODE_LENGTH%' THEN
        RAISE;
      END IF;
  END;

  -- Succès
  IF public.admin_update_access_code(v_token, 'nouveau-code-ok') IS NOT TRUE THEN
    RAISE EXCEPTION 'TEST_FAIL: succès attendu';
  END IF;

  -- Ancien code invalide
  IF public.verify_access_code('ancien-code-groupe') IS TRUE THEN
    RAISE EXCEPTION 'TEST_FAIL: ancien code encore valide';
  END IF;

  -- Nouveau code valide
  IF public.verify_access_code('nouveau-code-ok') IS NOT TRUE THEN
    RAISE EXCEPTION 'TEST_FAIL: nouveau code invalide';
  END IF;

  -- Session admin toujours intacte (le code admin n’a pas changé)
  IF public.verify_admin_code(v_token) IS NOT TRUE THEN
    RAISE EXCEPTION 'TEST_FAIL: code admin cassé';
  END IF;

  -- Hash présent, pas de clair
  IF EXISTS (
    SELECT 1
    FROM public.app_settings AS s
    WHERE s.key = 'access_code_hash'
      AND (
        s.value = 'nouveau-code-ok'
        OR s.value = ''
        OR s.value NOT LIKE '$2%'
      )
  ) THEN
    RAISE EXCEPTION 'TEST_FAIL: hash access_code invalide ou clair';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM public.app_settings AS s
    WHERE s.key = 'admin_code_hash'
      AND s.value = 'nouveau-code-ok'
  ) THEN
    RAISE EXCEPTION 'TEST_FAIL: admin_code_hash modifié à tort';
  END IF;
END;
$$;

ROLLBACK;
