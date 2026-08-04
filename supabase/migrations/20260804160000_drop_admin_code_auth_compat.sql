-- Release B (20260804160000) : retrait définitif de la compatibilité temporaire
-- “admin code brut” dans assert_admin_session.
--
-- Objectif :
-- - empêcher toute authentification admin RPC via un code admin brut ;
-- - conserver le parcours cron : admin_code -> login_admin -> admin_session_token
--   -> RPC admin liées à la session.
--
-- Important :
-- - ne pas modifier l’historique des migrations existantes ;
-- - ne pas supprimer login_admin et les helpers nécessaires.

DROP FUNCTION IF EXISTS public.assert_admin_session(TEXT);

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

