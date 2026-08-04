-- COMPAT TRANSITOIRE (à retirer après déploiement Edge + front).
-- L’Edge Function production encore en place appelle :
--   verify_admin_code(p_admin_code)
--   admin_get_matches(p_admin_code)
--   admin_commit_fixture_sync(p_admin_code, p_plan)
-- Les signatures (TEXT) / (TEXT, JSONB) sont les mêmes que pour les jetons
-- de session : on accepte donc code OU session dans assert_admin_session.
--
-- Suppression prévue : supabase/maintenance/drop_admin_code_auth_compat.sql
-- après déploiement de la nouvelle Edge Function (plus de p_admin_code RPC).

CREATE OR REPLACE FUNCTION public.assert_admin_session(p_admin_session_token TEXT)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  v_hash BYTEA;
  v_session_id UUID;
BEGIN
  -- 1) Session opaque (chemin nominal post-041200)
  BEGIN
    v_hash := public.hash_session_token(p_admin_session_token);
  EXCEPTION
    WHEN OTHERS THEN
      v_hash := NULL;
  END;

  IF v_hash IS NOT NULL THEN
    SELECT s.id
    INTO v_session_id
    FROM public.admin_sessions AS s
    WHERE s.token_hash = v_hash
      AND s.revoked_at IS NULL
      AND s.expires_at > now()
    FOR UPDATE OF s;

    IF v_session_id IS NOT NULL THEN
      RETURN;
    END IF;
  END IF;

  -- 2) COMPAT TEMPORAIRE : ancien Edge / cron qui envoie encore le code admin
  BEGIN
    PERFORM public.assert_admin_code(p_admin_session_token);
    RETURN;
  EXCEPTION
    WHEN OTHERS THEN
      NULL;
  END;

  RAISE EXCEPTION 'INVALID_ADMIN_SESSION'
    USING ERRCODE = '28000',
          DETAIL = 'Session administrateur invalide ou expirée.';
END;
$$;

REVOKE ALL ON FUNCTION public.assert_admin_session(TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.assert_admin_session(TEXT) FROM anon, authenticated;

-- verify_admin_code : true si session valide OU code admin valide
-- (ancien Edge appelle encore ce nom avec le code en clair).
CREATE OR REPLACE FUNCTION public.verify_admin_code(p_admin_session_token TEXT)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
BEGIN
  PERFORM public.assert_admin_session(p_admin_session_token);
  RETURN TRUE;
EXCEPTION
  WHEN OTHERS THEN
    RETURN FALSE;
END;
$$;

REVOKE ALL ON FUNCTION public.verify_admin_code(TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.verify_admin_code(TEXT) TO anon, authenticated;

COMMENT ON FUNCTION public.assert_admin_session(TEXT) IS
  'Auth admin : jeton de session, ou (COMPAT TEMP) code admin pour l’ancienne Edge. '
  'Retirer le fallback code via maintenance/drop_admin_code_auth_compat.sql '
  'après déploiement de sync-fc-nantes + front admin session.';
