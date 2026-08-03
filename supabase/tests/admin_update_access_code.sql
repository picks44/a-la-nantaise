-- Test manuel (SQL Editor) — se termine toujours par ROLLBACK.
-- Ne pas exécuter en production hors transaction.

BEGIN;

-- Préparation isolée
UPDATE public.app_settings
SET value = extensions.crypt('ancien-code-groupe', extensions.gen_salt('bf'))
WHERE key = 'access_code_hash';

UPDATE public.app_settings
SET value = extensions.crypt('code-admin-test', extensions.gen_salt('bf'))
WHERE key = 'admin_code_hash';

DO $$
BEGIN
  -- Mauvais code admin
  BEGIN
    PERFORM public.admin_update_access_code('mauvais-admin', 'nouveau-code-ok');
    RAISE EXCEPTION 'TEST_FAIL: mauvais admin accepté';
  EXCEPTION
    WHEN OTHERS THEN
      IF SQLERRM NOT LIKE '%INVALID_ADMIN_CODE%' THEN
        RAISE;
      END IF;
  END;

  -- Code vide
  BEGIN
    PERFORM public.admin_update_access_code('code-admin-test', '   ');
    RAISE EXCEPTION 'TEST_FAIL: code vide accepté';
  EXCEPTION
    WHEN OTHERS THEN
      IF SQLERRM NOT LIKE '%INVALID_ACCESS_CODE%' THEN
        RAISE;
      END IF;
  END;

  -- Trop court
  BEGIN
    PERFORM public.admin_update_access_code('code-admin-test', 'abc');
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
      'code-admin-test',
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
  IF public.admin_update_access_code('code-admin-test', 'nouveau-code-ok') IS NOT TRUE THEN
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

  -- Admin inchangé
  IF public.verify_admin_code('code-admin-test') IS NOT TRUE THEN
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
