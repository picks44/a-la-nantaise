-- Compteur d’échecs PIN : survit au rollback de l’EXCEPTION appelante.
-- Sans transaction autonome, PostgREST / blocs EXCEPTION annulent l’UPDATE.

CREATE EXTENSION IF NOT EXISTS dblink WITH SCHEMA extensions;

CREATE OR REPLACE FUNCTION public.record_failed_pin_attempt(p_player_id UUID)
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  v_attempts INTEGER;
  v_conn TEXT;
BEGIN
  IF p_player_id IS NULL THEN
    RETURN 0;
  END IF;

  -- Connexion locale autonome (commit indépendant de la transaction courante).
  v_conn := format('dbname=%s', current_database());

  PERFORM extensions.dblink_exec(
    v_conn,
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

  SELECT pl.pin_failed_attempts
  INTO v_attempts
  FROM public.players AS pl
  WHERE pl.id = p_player_id;

  RETURN COALESCE(v_attempts, 0);
END;
$$;

REVOKE ALL ON FUNCTION public.record_failed_pin_attempt(UUID)
  FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.login_player(
  p_access_code TEXT,
  p_player_id UUID,
  p_pin TEXT
)
RETURNS TABLE (
  session_token TEXT,
  player_id UUID,
  pseudo TEXT,
  must_change_pin BOOLEAN
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  v_player public.players%ROWTYPE;
  v_raw BYTEA;
  v_token TEXT;
  v_hash BYTEA;
BEGIN
  PERFORM public.assert_access_code(p_access_code);

  IF p_player_id IS NULL THEN
    PERFORM public.raise_invalid_credentials();
  END IF;

  SELECT pl.*
  INTO v_player
  FROM public.players AS pl
  WHERE pl.id = p_player_id
  FOR UPDATE;

  IF NOT FOUND OR v_player.is_active IS NOT TRUE THEN
    PERFORM public.raise_invalid_credentials();
  END IF;

  IF v_player.pin_locked_until IS NOT NULL
     AND v_player.pin_locked_until > now() THEN
    PERFORM public.raise_invalid_credentials();
  END IF;

  IF v_player.pin_hash IS NULL
     OR (
       v_player.pin_temporary_expires_at IS NOT NULL
       AND v_player.pin_temporary_expires_at < now()
     )
     OR p_pin IS NULL
     OR (
       p_pin !~ '^\d{4}$'
       AND p_pin !~ '^\d{6}$'
     )
     OR v_player.pin_hash IS DISTINCT FROM extensions.crypt(p_pin, v_player.pin_hash)
  THEN
    PERFORM public.record_failed_pin_attempt(v_player.id);
    PERFORM public.raise_invalid_credentials();
  END IF;

  UPDATE public.players AS pl
  SET
    pin_failed_attempts = 0,
    pin_locked_until = NULL
  WHERE pl.id = v_player.id;

  v_raw := extensions.gen_random_bytes(32);
  v_token := encode(v_raw, 'hex');
  v_hash := extensions.digest(v_raw, 'sha256');

  INSERT INTO public.player_sessions (player_id, token_hash, expires_at)
  VALUES (v_player.id, v_hash, now() + interval '30 days');

  RETURN QUERY
  SELECT
    v_token,
    v_player.id,
    v_player.display_name,
    v_player.must_change_pin;
END;
$$;

REVOKE ALL ON FUNCTION public.login_player(TEXT, UUID, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.login_player(TEXT, UUID, TEXT)
  TO anon, authenticated;
