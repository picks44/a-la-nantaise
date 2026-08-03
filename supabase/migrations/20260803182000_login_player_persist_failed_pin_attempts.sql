-- Persiste le compteur d’échecs PIN sans transaction autonome ni extension externe.
-- En cas de mauvais PIN (ou joueur inconnu) : UPDATE du compteur puis RETURN 0 ligne
-- pour que la transaction soit commitée. Le front mappe l’absence de ligne en
-- INVALID_CREDENTIALS. Verrouillage actif et PIN temporaire expiré : RAISE dédié.

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
    RETURN;
  END IF;

  SELECT pl.*
  INTO v_player
  FROM public.players AS pl
  WHERE pl.id = p_player_id
  FOR UPDATE;

  IF NOT FOUND OR v_player.is_active IS NOT TRUE THEN
    RETURN;
  END IF;

  IF v_player.pin_locked_until IS NOT NULL
     AND v_player.pin_locked_until > now() THEN
    RAISE EXCEPTION 'PIN_LOCKED'
      USING ERRCODE = '28000',
            DETAIL = 'Trop de tentatives. Réessaie dans 15 minutes.';
  END IF;

  IF v_player.pin_temporary_expires_at IS NOT NULL
     AND v_player.pin_temporary_expires_at < now() THEN
    RAISE EXCEPTION 'TEMP_PIN_EXPIRED'
      USING ERRCODE = '28000',
            DETAIL = 'PIN temporaire expiré.';
  END IF;

  IF v_player.pin_hash IS NULL
     OR p_pin IS NULL
     OR (
       p_pin !~ '^\d{4}$'
       AND p_pin !~ '^\d{6}$'
     )
     OR v_player.pin_hash IS DISTINCT FROM extensions.crypt(p_pin, v_player.pin_hash)
  THEN
    UPDATE public.players AS pl
    SET
      pin_failed_attempts = pl.pin_failed_attempts + 1,
      pin_locked_until = CASE
        WHEN pl.pin_failed_attempts + 1 >= 5
          THEN now() + interval '15 minutes'
        ELSE pl.pin_locked_until
      END
    WHERE pl.id = v_player.id;

    RETURN;
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

-- Nettoyage éventuel d’un helper d’essai local s’il existait.
DROP FUNCTION IF EXISTS public.record_failed_pin_attempt(UUID);
