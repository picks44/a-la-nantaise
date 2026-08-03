-- Remplace dblink (mot de passe requis hors superuser) par une mise à jour
-- commitée via dblink_connect_u en tant que propriétaire superuser.

CREATE EXTENSION IF NOT EXISTS dblink WITH SCHEMA extensions;

CREATE OR REPLACE FUNCTION public.record_failed_pin_attempt(p_player_id UUID)
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  v_attempts INTEGER := 0;
  v_conn_name TEXT := 'aln_pin_fail';
BEGIN
  IF p_player_id IS NULL THEN
    RETURN 0;
  END IF;

  -- Connexion autonome sans mot de passe (réservée aux superusers).
  PERFORM extensions.dblink_connect_u(
    v_conn_name,
    format('dbname=%s', current_database())
  );

  BEGIN
    PERFORM extensions.dblink_exec(
      v_conn_name,
      format(
        $cmd$
          UPDATE public.players AS pl
          SET
            pin_failed_attempts = pl.pin_failed_attempts + 1,
            pin_locked_until = CASE
              WHEN pl.pin_failed_attempts + 1 >= 5
                THEN now() + interval '15 minutes'
              ELSE pl.pin_locked_until
            END
          WHERE pl.id = %L
        $cmd$,
        p_player_id
      )
    );
  EXCEPTION
    WHEN OTHERS THEN
      PERFORM extensions.dblink_disconnect(v_conn_name);
      RAISE;
  END;

  PERFORM extensions.dblink_disconnect(v_conn_name);

  SELECT pl.pin_failed_attempts
  INTO v_attempts
  FROM public.players AS pl
  WHERE pl.id = p_player_id;

  RETURN COALESCE(v_attempts, 0);
END;
$$;

ALTER FUNCTION public.record_failed_pin_attempt(UUID) OWNER TO postgres;
ALTER FUNCTION public.login_player(TEXT, UUID, TEXT) OWNER TO postgres;

REVOKE ALL ON FUNCTION public.record_failed_pin_attempt(UUID)
  FROM PUBLIC, anon, authenticated;
