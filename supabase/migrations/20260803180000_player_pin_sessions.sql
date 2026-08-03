-- PIN joueur + sessions opaques.
-- DROP explicite des anciennes RPC acceptant un player_id client.
-- Aucune table métier (players/predictions/matches) n’est tronquée.

-- ---------------------------------------------------------------------------
-- Schéma joueurs / sessions
-- ---------------------------------------------------------------------------

ALTER TABLE public.players
  ADD COLUMN IF NOT EXISTS pin_hash TEXT,
  ADD COLUMN IF NOT EXISTS must_change_pin BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS pin_temporary_expires_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS pin_failed_attempts INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS pin_locked_until TIMESTAMPTZ;

ALTER TABLE public.players
  DROP CONSTRAINT IF EXISTS players_pin_failed_attempts_nonnegative;

ALTER TABLE public.players
  ADD CONSTRAINT players_pin_failed_attempts_nonnegative
  CHECK (pin_failed_attempts >= 0);

CREATE TABLE IF NOT EXISTS public.player_sessions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  player_id UUID NOT NULL REFERENCES public.players (id) ON DELETE CASCADE,
  token_hash BYTEA NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  revoked_at TIMESTAMPTZ,
  CONSTRAINT player_sessions_token_hash_unique UNIQUE (token_hash)
);

CREATE INDEX IF NOT EXISTS player_sessions_player_id_idx
  ON public.player_sessions (player_id);

CREATE INDEX IF NOT EXISTS player_sessions_expires_at_idx
  ON public.player_sessions (expires_at);

ALTER TABLE public.player_sessions ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public.player_sessions FROM PUBLIC;
REVOKE ALL ON TABLE public.player_sessions FROM anon, authenticated;

-- ---------------------------------------------------------------------------
-- DROP des anciennes signatures vulnérables / à remplacer
-- ---------------------------------------------------------------------------

DROP FUNCTION IF EXISTS public.upsert_prediction(TEXT, UUID, UUID, INTEGER, INTEGER);
DROP FUNCTION IF EXISTS public.get_my_predictions(TEXT, UUID);
DROP FUNCTION IF EXISTS public.get_visible_predictions(TEXT, UUID);
DROP FUNCTION IF EXISTS public.get_matches(TEXT);
DROP FUNCTION IF EXISTS public.get_ranking(TEXT);
DROP FUNCTION IF EXISTS public.register_push_subscription(TEXT, UUID, TEXT, TEXT, TEXT, TIMESTAMPTZ, TEXT);
DROP FUNCTION IF EXISTS public.deactivate_push_subscription(TEXT, TEXT);
DROP FUNCTION IF EXISTS public.get_push_subscription_status(TEXT, TEXT);

-- ---------------------------------------------------------------------------
-- Helpers internes (pas de GRANT à anon)
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.hash_session_token(p_session_token TEXT)
RETURNS BYTEA
LANGUAGE plpgsql
IMMUTABLE
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  v_raw BYTEA;
BEGIN
  IF p_session_token IS NULL OR p_session_token !~ '^[0-9a-f]{64}$' THEN
    RAISE EXCEPTION 'INVALID_SESSION'
      USING ERRCODE = '28000',
            DETAIL = 'Session invalide.';
  END IF;

  v_raw := decode(p_session_token, 'hex');
  RETURN extensions.digest(v_raw, 'sha256');
END;
$$;

REVOKE ALL ON FUNCTION public.hash_session_token(TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.hash_session_token(TEXT) FROM anon, authenticated;

CREATE OR REPLACE FUNCTION public.assert_valid_pin_format(p_pin TEXT)
RETURNS VOID
LANGUAGE plpgsql
IMMUTABLE
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF p_pin IS NULL OR (p_pin !~ '^\d{4}$' AND p_pin !~ '^\d{6}$') THEN
    RAISE EXCEPTION 'INVALID_PIN_FORMAT'
      USING ERRCODE = '22023',
            DETAIL = 'Le PIN doit contenir 4 ou 6 chiffres.';
  END IF;
END;
$$;

REVOKE ALL ON FUNCTION public.assert_valid_pin_format(TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.assert_valid_pin_format(TEXT) FROM anon, authenticated;

CREATE OR REPLACE FUNCTION public.raise_invalid_credentials()
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  RAISE EXCEPTION 'INVALID_CREDENTIALS'
    USING ERRCODE = '28000',
          DETAIL = 'Connexion impossible, réessaie plus tard.';
END;
$$;

REVOKE ALL ON FUNCTION public.raise_invalid_credentials() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.raise_invalid_credentials() FROM anon, authenticated;

CREATE OR REPLACE FUNCTION public.assert_player_session(p_session_token TEXT)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  v_hash BYTEA;
  v_player_id UUID;
  v_session_id UUID;
BEGIN
  v_hash := public.hash_session_token(p_session_token);

  SELECT s.id, s.player_id
  INTO v_session_id, v_player_id
  FROM public.player_sessions AS s
  INNER JOIN public.players AS pl ON pl.id = s.player_id
  WHERE s.token_hash = v_hash
    AND s.revoked_at IS NULL
    AND s.expires_at > now()
    AND pl.is_active = TRUE
  FOR UPDATE OF s;

  IF v_player_id IS NULL THEN
    RAISE EXCEPTION 'INVALID_SESSION'
      USING ERRCODE = '28000',
            DETAIL = 'Session invalide ou expirée.';
  END IF;

  RETURN v_player_id;
END;
$$;

REVOKE ALL ON FUNCTION public.assert_player_session(TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.assert_player_session(TEXT) FROM anon, authenticated;

CREATE OR REPLACE FUNCTION public.revoke_player_sessions(
  p_player_id UUID,
  p_except_session_id UUID DEFAULT NULL
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  UPDATE public.player_sessions AS s
  SET revoked_at = now()
  WHERE s.player_id = p_player_id
    AND s.revoked_at IS NULL
    AND (p_except_session_id IS NULL OR s.id <> p_except_session_id);
END;
$$;

REVOKE ALL ON FUNCTION public.revoke_player_sessions(UUID, UUID) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.revoke_player_sessions(UUID, UUID) FROM anon, authenticated;

-- ---------------------------------------------------------------------------
-- Auth joueur
-- ---------------------------------------------------------------------------

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
  v_attempts INTEGER;
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
    UPDATE public.players AS pl
    SET
      pin_failed_attempts = pl.pin_failed_attempts + 1,
      pin_locked_until = CASE
        WHEN pl.pin_failed_attempts + 1 >= 5 THEN now() + interval '15 minutes'
        ELSE pl.pin_locked_until
      END
    WHERE pl.id = v_player.id
    RETURNING pl.pin_failed_attempts INTO v_attempts;

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

CREATE OR REPLACE FUNCTION public.logout_player(p_session_token TEXT)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  v_hash BYTEA;
  v_updated INTEGER;
BEGIN
  BEGIN
    v_hash := public.hash_session_token(p_session_token);
  EXCEPTION
    WHEN OTHERS THEN
      RETURN FALSE;
  END;

  UPDATE public.player_sessions AS s
  SET revoked_at = now()
  WHERE s.token_hash = v_hash
    AND s.revoked_at IS NULL;

  GET DIAGNOSTICS v_updated = ROW_COUNT;
  RETURN v_updated > 0;
END;
$$;

CREATE OR REPLACE FUNCTION public.get_session_player(p_session_token TEXT)
RETURNS TABLE (
  player_id UUID,
  pseudo TEXT,
  must_change_pin BOOLEAN,
  expires_at TIMESTAMPTZ
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  v_hash BYTEA;
BEGIN
  v_hash := public.hash_session_token(p_session_token);

  RETURN QUERY
  SELECT
    pl.id,
    pl.display_name,
    pl.must_change_pin,
    s.expires_at
  FROM public.player_sessions AS s
  INNER JOIN public.players AS pl ON pl.id = s.player_id
  WHERE s.token_hash = v_hash
    AND s.revoked_at IS NULL
    AND s.expires_at > now()
    AND pl.is_active = TRUE;
END;
$$;

CREATE OR REPLACE FUNCTION public.change_player_pin(
  p_session_token TEXT,
  p_old_pin TEXT,
  p_new_pin TEXT
)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  v_hash BYTEA;
  v_session_id UUID;
  v_player_id UUID;
  v_pin_hash TEXT;
BEGIN
  PERFORM public.assert_valid_pin_format(p_new_pin);
  v_hash := public.hash_session_token(p_session_token);

  SELECT s.id, pl.id, pl.pin_hash
  INTO v_session_id, v_player_id, v_pin_hash
  FROM public.player_sessions AS s
  INNER JOIN public.players AS pl ON pl.id = s.player_id
  WHERE s.token_hash = v_hash
    AND s.revoked_at IS NULL
    AND s.expires_at > now()
    AND pl.is_active = TRUE
  FOR UPDATE OF pl, s;

  IF v_session_id IS NULL OR v_player_id IS NULL THEN
    RAISE EXCEPTION 'INVALID_SESSION'
      USING ERRCODE = '28000',
            DETAIL = 'Session invalide ou expirée.';
  END IF;

  IF v_pin_hash IS NULL
     OR p_old_pin IS NULL
     OR v_pin_hash IS DISTINCT FROM extensions.crypt(p_old_pin, v_pin_hash)
  THEN
    PERFORM public.raise_invalid_credentials();
  END IF;

  UPDATE public.players AS pl
  SET
    pin_hash = extensions.crypt(p_new_pin, extensions.gen_salt('bf')),
    must_change_pin = FALSE,
    pin_temporary_expires_at = NULL,
    pin_failed_attempts = 0,
    pin_locked_until = NULL
  WHERE pl.id = v_player_id;

  PERFORM public.revoke_player_sessions(v_player_id, v_session_id);

  RETURN TRUE;
END;
$$;

CREATE OR REPLACE FUNCTION public.admin_reset_player_pin(
  p_admin_code TEXT,
  p_player_id UUID
)
RETURNS TABLE (
  temporary_pin TEXT,
  expires_at TIMESTAMPTZ
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  v_pin TEXT;
  v_expires TIMESTAMPTZ;
BEGIN
  PERFORM public.assert_admin_code(p_admin_code);

  IF p_player_id IS NULL THEN
    RAISE EXCEPTION 'INVALID_PLAYER'
      USING ERRCODE = '22023',
            DETAIL = 'Identifiant joueur manquant.';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.players AS pl WHERE pl.id = p_player_id
  ) THEN
    RAISE EXCEPTION 'INVALID_PLAYER'
      USING ERRCODE = '22023',
            DETAIL = 'Joueur introuvable.';
  END IF;

  -- PIN temporaire à 6 chiffres (100000–999999).
  v_pin := lpad((100000 + floor(random() * 900000)::integer)::text, 6, '0');
  v_expires := now() + interval '48 hours';

  UPDATE public.players AS pl
  SET
    pin_hash = extensions.crypt(v_pin, extensions.gen_salt('bf')),
    must_change_pin = TRUE,
    pin_temporary_expires_at = v_expires,
    pin_failed_attempts = 0,
    pin_locked_until = NULL
  WHERE pl.id = p_player_id;

  PERFORM public.revoke_player_sessions(p_player_id, NULL);

  RETURN QUERY
  SELECT v_pin, v_expires;
END;
$$;

CREATE OR REPLACE FUNCTION public.admin_unlock_player_pin(
  p_admin_code TEXT,
  p_player_id UUID
)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  v_updated INTEGER;
BEGIN
  PERFORM public.assert_admin_code(p_admin_code);

  IF p_player_id IS NULL THEN
    RAISE EXCEPTION 'INVALID_PLAYER'
      USING ERRCODE = '22023',
            DETAIL = 'Identifiant joueur manquant.';
  END IF;

  UPDATE public.players AS pl
  SET
    pin_failed_attempts = 0,
    pin_locked_until = NULL
  WHERE pl.id = p_player_id;

  GET DIAGNOSTICS v_updated = ROW_COUNT;
  IF v_updated = 0 THEN
    RAISE EXCEPTION 'INVALID_PLAYER'
      USING ERRCODE = '22023',
            DETAIL = 'Joueur introuvable.';
  END IF;

  RETURN TRUE;
END;
$$;

-- ---------------------------------------------------------------------------
-- Lectures / mutations authentifiées par session
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.get_matches(p_session_token TEXT)
RETURNS TABLE (
  id UUID,
  external_id TEXT,
  round_number INTEGER,
  home_team TEXT,
  away_team TEXT,
  kickoff_at TIMESTAMPTZ,
  status TEXT,
  home_score INTEGER,
  away_score INTEGER,
  created_at TIMESTAMPTZ,
  updated_at TIMESTAMPTZ
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
BEGIN
  PERFORM public.assert_player_session(p_session_token);

  RETURN QUERY
  SELECT
    m.id,
    m.external_id,
    m.round_number,
    m.home_team,
    m.away_team,
    m.kickoff_at,
    m.status,
    m.home_score,
    m.away_score,
    m.created_at,
    m.updated_at
  FROM public.matches AS m
  ORDER BY m.kickoff_at ASC, m.round_number ASC, m.home_team ASC, m.away_team ASC, m.id ASC;
END;
$$;

CREATE OR REPLACE FUNCTION public.get_ranking(p_session_token TEXT)
RETURNS TABLE (
  id UUID,
  display_name TEXT,
  points BIGINT,
  exact_scores BIGINT
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
BEGIN
  PERFORM public.assert_player_session(p_session_token);

  RETURN QUERY
  SELECT
    p.id,
    p.display_name,
    COALESCE(SUM(pr.points), 0)::BIGINT AS points,
    COALESCE(COUNT(*) FILTER (WHERE pr.points = 3), 0)::BIGINT AS exact_scores
  FROM public.players AS p
  LEFT JOIN public.predictions AS pr
    ON pr.player_id = p.id
   AND pr.points IS NOT NULL
  WHERE p.is_active = TRUE
  GROUP BY p.id, p.display_name
  ORDER BY points DESC, exact_scores DESC, p.display_name ASC;
END;
$$;

CREATE OR REPLACE FUNCTION public.get_my_predictions(p_session_token TEXT)
RETURNS TABLE (
  id UUID,
  player_id UUID,
  match_id UUID,
  predicted_home_score INTEGER,
  predicted_away_score INTEGER,
  points INTEGER,
  created_at TIMESTAMPTZ,
  updated_at TIMESTAMPTZ
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
#variable_conflict use_column
DECLARE
  v_player_id UUID;
BEGIN
  v_player_id := public.assert_player_session(p_session_token);

  RETURN QUERY
  SELECT
    pr.id,
    pr.player_id,
    pr.match_id,
    pr.predicted_home_score,
    pr.predicted_away_score,
    pr.points,
    pr.created_at,
    pr.updated_at
  FROM public.predictions AS pr
  WHERE pr.player_id = v_player_id
  ORDER BY pr.created_at ASC;
END;
$$;

CREATE OR REPLACE FUNCTION public.get_visible_predictions(p_session_token TEXT)
RETURNS TABLE (
  id UUID,
  player_id UUID,
  match_id UUID,
  predicted_home_score INTEGER,
  predicted_away_score INTEGER,
  points INTEGER,
  created_at TIMESTAMPTZ,
  updated_at TIMESTAMPTZ
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
#variable_conflict use_column
DECLARE
  v_player_id UUID;
BEGIN
  v_player_id := public.assert_player_session(p_session_token);

  RETURN QUERY
  SELECT
    pr.id,
    pr.player_id,
    pr.match_id,
    pr.predicted_home_score,
    pr.predicted_away_score,
    pr.points,
    pr.created_at,
    pr.updated_at
  FROM public.predictions AS pr
  INNER JOIN public.matches AS m ON m.id = pr.match_id
  WHERE pr.player_id = v_player_id
     OR m.kickoff_at <= now()
  ORDER BY pr.created_at ASC;
END;
$$;

CREATE OR REPLACE FUNCTION public.upsert_prediction(
  p_session_token TEXT,
  p_match_id UUID,
  p_predicted_home_score INTEGER,
  p_predicted_away_score INTEGER
)
RETURNS TABLE (
  id UUID,
  player_id UUID,
  match_id UUID,
  predicted_home_score INTEGER,
  predicted_away_score INTEGER,
  points INTEGER,
  created_at TIMESTAMPTZ,
  updated_at TIMESTAMPTZ
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
#variable_conflict use_column
DECLARE
  v_player_id UUID;
  match_row public.matches%ROWTYPE;
BEGIN
  v_player_id := public.assert_player_session(p_session_token);

  IF p_match_id IS NULL THEN
    RAISE EXCEPTION 'INVALID_INPUT'
      USING ERRCODE = '22023',
            DETAIL = 'Match manquant.';
  END IF;

  IF p_predicted_home_score IS NULL
     OR p_predicted_away_score IS NULL
     OR p_predicted_home_score < 0
     OR p_predicted_away_score < 0
     OR p_predicted_home_score > 15
     OR p_predicted_away_score > 15 THEN
    RAISE EXCEPTION 'INVALID_SCORE'
      USING ERRCODE = '22023',
            DETAIL = 'Les scores doivent être des entiers entre 0 et 15.';
  END IF;

  SELECT m.*
  INTO match_row
  FROM public.matches AS m
  WHERE m.id = p_match_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'MATCH_NOT_FOUND'
      USING ERRCODE = 'P0002',
            DETAIL = 'Match introuvable.';
  END IF;

  IF match_row.status IN ('postponed', 'cancelled', 'finished') THEN
    RAISE EXCEPTION 'MATCH_NOT_OPENABLE'
      USING ERRCODE = 'P0001',
            DETAIL = 'Ce match n’accepte plus de pronostic.';
  END IF;

  -- Heure serveur uniquement : verrouillage à l’instant exact du coup d’envoi.
  IF now() >= match_row.kickoff_at THEN
    RAISE EXCEPTION 'MATCH_LOCKED'
      USING ERRCODE = 'P0001',
            DETAIL = 'Le match a commencé : les pronostics sont verrouillés.';
  END IF;

  RETURN QUERY
  WITH upserted AS (
    INSERT INTO public.predictions AS pr (
      player_id,
      match_id,
      predicted_home_score,
      predicted_away_score
    )
    VALUES (
      v_player_id,
      p_match_id,
      p_predicted_home_score,
      p_predicted_away_score
    )
    ON CONFLICT ON CONSTRAINT predictions_player_match_unique
    DO UPDATE SET
      predicted_home_score = EXCLUDED.predicted_home_score,
      predicted_away_score = EXCLUDED.predicted_away_score,
      points = NULL,
      updated_at = now()
    WHERE (
      SELECT m2.kickoff_at > now()
      FROM public.matches AS m2
      WHERE m2.id = EXCLUDED.match_id
    )
    RETURNING
      pr.id,
      pr.player_id,
      pr.match_id,
      pr.predicted_home_score,
      pr.predicted_away_score,
      pr.points,
      pr.created_at,
      pr.updated_at
  )
  SELECT
    u.id,
    u.player_id,
    u.match_id,
    u.predicted_home_score,
    u.predicted_away_score,
    u.points,
    u.created_at,
    u.updated_at
  FROM upserted AS u;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'MATCH_LOCKED'
      USING ERRCODE = 'P0001',
            DETAIL = 'Le match a commencé : les pronostics sont verrouillés.';
  END IF;
END;
$$;

-- ---------------------------------------------------------------------------
-- Push : session à la place de access_code + player_id
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.register_push_subscription(
  p_session_token TEXT,
  p_endpoint TEXT,
  p_p256dh TEXT,
  p_auth TEXT,
  p_expiration_time TIMESTAMPTZ DEFAULT NULL,
  p_user_agent TEXT DEFAULT NULL
)
RETURNS TABLE (
  id UUID,
  player_id UUID,
  status TEXT,
  updated_at TIMESTAMPTZ
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  v_player_id UUID;
  v_hash BYTEA;
  v_active_for_player INTEGER;
  v_active_total INTEGER;
  v_ua TEXT;
BEGIN
  v_player_id := public.assert_player_session(p_session_token);
  PERFORM public.assert_push_endpoint(p_endpoint);

  IF p_p256dh IS NULL OR char_length(p_p256dh) < 16 OR char_length(p_p256dh) > 256 THEN
    RAISE EXCEPTION 'INVALID_PUSH_KEYS'
      USING ERRCODE = '22023',
            DETAIL = 'Clé p256dh invalide.';
  END IF;

  IF p_auth IS NULL OR char_length(p_auth) < 8 OR char_length(p_auth) > 128 THEN
    RAISE EXCEPTION 'INVALID_PUSH_KEYS'
      USING ERRCODE = '22023',
            DETAIL = 'Clé auth invalide.';
  END IF;

  v_ua := NULLIF(left(trim(COALESCE(p_user_agent, '')), 512), '');
  v_hash := public.push_endpoint_hash(p_endpoint);

  IF NOT EXISTS (
    SELECT 1
    FROM public.push_subscriptions AS s
    WHERE s.endpoint_hash = v_hash
  ) THEN
    SELECT count(*)::integer INTO v_active_for_player
    FROM public.push_subscriptions AS s
    WHERE s.player_id = v_player_id
      AND s.status = 'active';

    IF v_active_for_player >= 5 THEN
      RAISE EXCEPTION 'PUSH_DEVICE_LIMIT'
        USING ERRCODE = 'P0001',
              DETAIL = 'Maximum 5 appareils actifs pour ce joueur.';
    END IF;

    SELECT count(*)::integer INTO v_active_total
    FROM public.push_subscriptions AS s
    WHERE s.status = 'active';

    IF v_active_total >= 25 THEN
      RAISE EXCEPTION 'PUSH_DEVICE_LIMIT'
        USING ERRCODE = 'P0001',
              DETAIL = 'Maximum 25 abonnements actifs pour le groupe.';
    END IF;
  END IF;

  RETURN QUERY
  INSERT INTO public.push_subscriptions (
    player_id,
    endpoint,
    endpoint_hash,
    p256dh,
    auth,
    content_encoding,
    expiration_time,
    status,
    user_agent,
    last_seen_at,
    failure_count,
    invalidated_at
  )
  VALUES (
    v_player_id,
    p_endpoint,
    v_hash,
    p_p256dh,
    p_auth,
    'aes128gcm',
    p_expiration_time,
    'active',
    v_ua,
    now(),
    0,
    NULL
  )
  ON CONFLICT (endpoint_hash) DO UPDATE
  SET
    player_id = EXCLUDED.player_id,
    endpoint = EXCLUDED.endpoint,
    p256dh = EXCLUDED.p256dh,
    auth = EXCLUDED.auth,
    content_encoding = 'aes128gcm',
    expiration_time = EXCLUDED.expiration_time,
    status = 'active',
    user_agent = COALESCE(EXCLUDED.user_agent, public.push_subscriptions.user_agent),
    last_seen_at = now(),
    failure_count = 0,
    invalidated_at = NULL,
    updated_at = now()
  RETURNING
    public.push_subscriptions.id,
    public.push_subscriptions.player_id,
    public.push_subscriptions.status,
    public.push_subscriptions.updated_at;
END;
$$;

CREATE OR REPLACE FUNCTION public.deactivate_push_subscription(
  p_session_token TEXT,
  p_endpoint TEXT
)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  v_player_id UUID;
  v_hash BYTEA;
  v_updated INTEGER;
BEGIN
  v_player_id := public.assert_player_session(p_session_token);
  PERFORM public.assert_push_endpoint(p_endpoint);

  v_hash := public.push_endpoint_hash(p_endpoint);

  UPDATE public.push_subscriptions AS s
  SET
    status = 'disabled',
    invalidated_at = now(),
    updated_at = now()
  WHERE s.endpoint_hash = v_hash
    AND s.player_id = v_player_id
    AND s.status = 'active';

  GET DIAGNOSTICS v_updated = ROW_COUNT;
  RETURN v_updated > 0;
END;
$$;

CREATE OR REPLACE FUNCTION public.get_push_subscription_status(
  p_session_token TEXT,
  p_endpoint TEXT
)
RETURNS TABLE (
  active BOOLEAN,
  status TEXT,
  player_id UUID
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  v_player_id UUID;
  v_hash BYTEA;
BEGIN
  v_player_id := public.assert_player_session(p_session_token);
  PERFORM public.assert_push_endpoint(p_endpoint);

  v_hash := public.push_endpoint_hash(p_endpoint);

  RETURN QUERY
  SELECT
    (s.status = 'active') AS active,
    s.status,
    s.player_id
  FROM public.push_subscriptions AS s
  WHERE s.endpoint_hash = v_hash
    AND s.player_id = v_player_id;
END;
$$;

-- ---------------------------------------------------------------------------
-- Privileges
-- ---------------------------------------------------------------------------

REVOKE ALL ON FUNCTION public.login_player(TEXT, UUID, TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.logout_player(TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.get_session_player(TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.change_player_pin(TEXT, TEXT, TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.admin_reset_player_pin(TEXT, UUID) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.admin_unlock_player_pin(TEXT, UUID) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.get_matches(TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.get_ranking(TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.get_my_predictions(TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.get_visible_predictions(TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.upsert_prediction(TEXT, UUID, INTEGER, INTEGER) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.register_push_subscription(TEXT, TEXT, TEXT, TEXT, TIMESTAMPTZ, TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.deactivate_push_subscription(TEXT, TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.get_push_subscription_status(TEXT, TEXT) FROM PUBLIC;

GRANT EXECUTE ON FUNCTION public.login_player(TEXT, UUID, TEXT) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.logout_player(TEXT) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_session_player(TEXT) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.change_player_pin(TEXT, TEXT, TEXT) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.admin_reset_player_pin(TEXT, UUID) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.admin_unlock_player_pin(TEXT, UUID) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_matches(TEXT) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_ranking(TEXT) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_my_predictions(TEXT) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_visible_predictions(TEXT) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.upsert_prediction(TEXT, UUID, INTEGER, INTEGER) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.register_push_subscription(TEXT, TEXT, TEXT, TEXT, TIMESTAMPTZ, TEXT)
  TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.deactivate_push_subscription(TEXT, TEXT) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_push_subscription_status(TEXT, TEXT) TO anon, authenticated;
