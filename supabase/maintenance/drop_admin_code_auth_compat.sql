-- À exécuter APRÈS le déploiement de :
--   1) migrations jusqu’à 20260804150000 (déjà appliquées)
--   2) Edge Function sync-fc-nantes (auth via login_admin / admin_session_token)
--   3) front admin (plus de p_admin_code en clair)
--
-- Retire le fallback « code admin » dans assert_admin_session.
-- Ne laisse plus qu’un seul système d’auth admin : sessions opaques.
--
-- Ne pas inclure dans un db reset tant que la fenêtre de bascule n’est pas
-- terminée en staging/prod. Appliquer manuellement :
--   psql ... -f supabase/maintenance/drop_admin_code_auth_compat.sql

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
  v_hash := public.hash_session_token(p_admin_session_token);

  SELECT s.id
  INTO v_session_id
  FROM public.admin_sessions AS s
  WHERE s.token_hash = v_hash
    AND s.revoked_at IS NULL
    AND s.expires_at > now()
  FOR UPDATE OF s;

  IF v_session_id IS NULL THEN
    RAISE EXCEPTION 'INVALID_ADMIN_SESSION'
      USING ERRCODE = '28000',
            DETAIL = 'Session administrateur invalide ou expirée.';
  END IF;
END;
$$;

REVOKE ALL ON FUNCTION public.assert_admin_session(TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.assert_admin_session(TEXT) FROM anon, authenticated;

COMMENT ON FUNCTION public.assert_admin_session(TEXT) IS
  'Auth admin stricte : jeton de session opaque uniquement.';
