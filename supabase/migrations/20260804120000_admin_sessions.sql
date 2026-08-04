-- Sessions admin opaques + rate-limit login.
-- Remplace p_admin_code par p_admin_session_token sur les RPC admin_*.
-- Aucune table métier (players/predictions/matches) n’est tronquée.

-- ---------------------------------------------------------------------------
-- Schéma sessions / état d’auth admin
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.admin_sessions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  token_hash BYTEA NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  revoked_at TIMESTAMPTZ,
  CONSTRAINT admin_sessions_token_hash_unique UNIQUE (token_hash)
);

CREATE INDEX IF NOT EXISTS admin_sessions_expires_at_idx
  ON public.admin_sessions (expires_at);

ALTER TABLE public.admin_sessions ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public.admin_sessions FROM PUBLIC;
REVOKE ALL ON TABLE public.admin_sessions FROM anon, authenticated;

CREATE TABLE IF NOT EXISTS public.admin_auth_state (
  id BOOLEAN PRIMARY KEY DEFAULT TRUE CHECK (id),
  failed_attempts INTEGER NOT NULL DEFAULT 0 CHECK (failed_attempts >= 0),
  locked_until TIMESTAMPTZ
);

ALTER TABLE public.admin_auth_state ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public.admin_auth_state FROM PUBLIC;
REVOKE ALL ON TABLE public.admin_auth_state FROM anon, authenticated;

INSERT INTO public.admin_auth_state (id, failed_attempts, locked_until)
VALUES (TRUE, 0, NULL)
ON CONFLICT (id) DO NOTHING;

-- ---------------------------------------------------------------------------
-- Drop old overloads (p_admin_code)
-- ---------------------------------------------------------------------------

DROP FUNCTION IF EXISTS public.verify_admin_code(TEXT);
DROP FUNCTION IF EXISTS public.admin_get_players(TEXT);
DROP FUNCTION IF EXISTS public.admin_create_player(TEXT, TEXT);
DROP FUNCTION IF EXISTS public.admin_update_player_name(TEXT, UUID, TEXT);
DROP FUNCTION IF EXISTS public.admin_set_player_active(TEXT, UUID, BOOLEAN);
DROP FUNCTION IF EXISTS public.admin_get_matches(TEXT);
DROP FUNCTION IF EXISTS public.admin_create_match(TEXT, INTEGER, TEXT, TEXT, TIMESTAMPTZ, TEXT, INTEGER, INTEGER, TEXT);
DROP FUNCTION IF EXISTS public.admin_update_match(TEXT, UUID, INTEGER, TEXT, TEXT, TIMESTAMPTZ, TEXT, INTEGER, INTEGER, TEXT);
DROP FUNCTION IF EXISTS public.admin_set_match_result(TEXT, UUID, INTEGER, INTEGER);
DROP FUNCTION IF EXISTS public.admin_get_stats(TEXT);
DROP FUNCTION IF EXISTS public.admin_clear_match_override(TEXT, UUID);
DROP FUNCTION IF EXISTS public.admin_get_fixture_sync_meta(TEXT);
DROP FUNCTION IF EXISTS public.admin_commit_fixture_sync(TEXT, JSONB);
DROP FUNCTION IF EXISTS public.admin_update_access_code(TEXT, TEXT);
DROP FUNCTION IF EXISTS public.admin_reset_player_pin(TEXT, UUID);
DROP FUNCTION IF EXISTS public.admin_unlock_player_pin(TEXT, UUID);

-- ---------------------------------------------------------------------------
-- assert_admin_code : conserve pour usage service/edge ; plus d’EXECUTE client
-- ---------------------------------------------------------------------------

REVOKE ALL ON FUNCTION public.assert_admin_code(TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.assert_admin_code(TEXT) FROM anon, authenticated;

-- ---------------------------------------------------------------------------
-- Auth admin : session + login / logout
-- ---------------------------------------------------------------------------

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

CREATE OR REPLACE FUNCTION public.login_admin(p_admin_code TEXT)
RETURNS TABLE (
  session_token TEXT
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  v_state public.admin_auth_state%ROWTYPE;
  stored_hash TEXT;
  v_raw BYTEA;
  v_token TEXT;
  v_hash BYTEA;
BEGIN
  SELECT a.*
  INTO v_state
  FROM public.admin_auth_state AS a
  WHERE a.id = TRUE
  FOR UPDATE;

  IF NOT FOUND THEN
    INSERT INTO public.admin_auth_state (id, failed_attempts, locked_until)
    VALUES (TRUE, 0, NULL)
    RETURNING * INTO v_state;
  END IF;

  IF v_state.locked_until IS NOT NULL
     AND v_state.locked_until > now() THEN
    RAISE EXCEPTION 'ADMIN_LOCKED'
      USING ERRCODE = '28000',
            DETAIL = 'Trop de tentatives. Réessaie dans 15 minutes.';
  END IF;

  SELECT s.value
  INTO stored_hash
  FROM public.app_settings AS s
  WHERE s.key = 'admin_code_hash';

  IF stored_hash IS NULL OR stored_hash = '' THEN
    RAISE EXCEPTION 'ADMIN_CODE_NOT_CONFIGURED'
      USING ERRCODE = 'P0001',
            DETAIL = 'Le hash du code administrateur n’a pas encore été défini.';
  END IF;

  IF p_admin_code IS NULL
     OR length(trim(p_admin_code)) = 0
     OR stored_hash <> extensions.crypt(trim(p_admin_code), stored_hash)
  THEN
    UPDATE public.admin_auth_state AS a
    SET
      failed_attempts = a.failed_attempts + 1,
      locked_until = CASE
        WHEN a.failed_attempts + 1 >= 5
          THEN now() + interval '15 minutes'
        ELSE a.locked_until
      END
    WHERE a.id = TRUE;

    RETURN;
  END IF;

  UPDATE public.admin_auth_state AS a
  SET
    failed_attempts = 0,
    locked_until = NULL
  WHERE a.id = TRUE;

  UPDATE public.admin_sessions AS s
  SET revoked_at = now()
  WHERE s.revoked_at IS NULL;

  v_raw := extensions.gen_random_bytes(32);
  v_token := encode(v_raw, 'hex');
  v_hash := public.hash_session_token(v_token);

  INSERT INTO public.admin_sessions (token_hash, expires_at)
  VALUES (v_hash, now() + interval '12 hours');

  RETURN QUERY
  SELECT v_token;
END;
$$;

CREATE OR REPLACE FUNCTION public.logout_admin(p_admin_session_token TEXT)
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
    v_hash := public.hash_session_token(p_admin_session_token);
  EXCEPTION
    WHEN OTHERS THEN
      RETURN FALSE;
  END;

  UPDATE public.admin_sessions AS s
  SET revoked_at = now()
  WHERE s.token_hash = v_hash
    AND s.revoked_at IS NULL;

  GET DIAGNOSTICS v_updated = ROW_COUNT;
  RETURN v_updated > 0;
END;
$$;

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

-- ---------------------------------------------------------------------------
-- RPC admin — participants
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.admin_get_players(p_admin_session_token TEXT)
RETURNS TABLE (
  id UUID,
  display_name TEXT,
  is_active BOOLEAN,
  created_at TIMESTAMPTZ
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
BEGIN
  PERFORM public.assert_admin_session(p_admin_session_token);

  RETURN QUERY
  SELECT
    pl.id,
    pl.display_name,
    pl.is_active,
    pl.created_at
  FROM public.players AS pl
  ORDER BY pl.display_name ASC;
END;
$$;

CREATE OR REPLACE FUNCTION public.admin_create_player(
  p_admin_session_token TEXT,
  p_display_name TEXT
)
RETURNS TABLE (
  id UUID,
  display_name TEXT,
  is_active BOOLEAN,
  created_at TIMESTAMPTZ
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  cleaned_name TEXT;
BEGIN
  PERFORM public.assert_admin_session(p_admin_session_token);
  cleaned_name := public.normalize_player_name(p_display_name);

  IF EXISTS (
    SELECT 1
    FROM public.players AS pl
    WHERE lower(pl.display_name) = lower(cleaned_name)
  ) THEN
    RAISE EXCEPTION 'DUPLICATE_PLAYER_NAME'
      USING ERRCODE = '23505',
            DETAIL = 'Ce pseudo est déjà utilisé.';
  END IF;

  RETURN QUERY
  INSERT INTO public.players AS pl (display_name, is_active)
  VALUES (cleaned_name, TRUE)
  RETURNING
    pl.id,
    pl.display_name,
    pl.is_active,
    pl.created_at;
END;
$$;

CREATE OR REPLACE FUNCTION public.admin_update_player_name(
  p_admin_session_token TEXT,
  p_player_id UUID,
  p_display_name TEXT
)
RETURNS TABLE (
  id UUID,
  display_name TEXT,
  is_active BOOLEAN,
  created_at TIMESTAMPTZ
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  cleaned_name TEXT;
BEGIN
  PERFORM public.assert_admin_session(p_admin_session_token);

  IF p_player_id IS NULL THEN
    RAISE EXCEPTION 'INVALID_PLAYER'
      USING ERRCODE = '22023',
            DETAIL = 'Identifiant joueur manquant.';
  END IF;

  cleaned_name := public.normalize_player_name(p_display_name);

  IF EXISTS (
    SELECT 1
    FROM public.players AS pl
    WHERE lower(pl.display_name) = lower(cleaned_name)
      AND pl.id <> p_player_id
  ) THEN
    RAISE EXCEPTION 'DUPLICATE_PLAYER_NAME'
      USING ERRCODE = '23505',
            DETAIL = 'Ce pseudo est déjà utilisé.';
  END IF;

  RETURN QUERY
  UPDATE public.players AS pl
  SET display_name = cleaned_name
  WHERE pl.id = p_player_id
  RETURNING
    pl.id,
    pl.display_name,
    pl.is_active,
    pl.created_at;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'INVALID_PLAYER'
      USING ERRCODE = '22023',
            DETAIL = 'Joueur introuvable.';
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION public.admin_set_player_active(
  p_admin_session_token TEXT,
  p_player_id UUID,
  p_is_active BOOLEAN
)
RETURNS TABLE (
  id UUID,
  display_name TEXT,
  is_active BOOLEAN,
  created_at TIMESTAMPTZ
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
BEGIN
  PERFORM public.assert_admin_session(p_admin_session_token);

  IF p_player_id IS NULL OR p_is_active IS NULL THEN
    RAISE EXCEPTION 'INVALID_INPUT'
      USING ERRCODE = '22023',
            DETAIL = 'Identifiant joueur ou état manquant.';
  END IF;

  RETURN QUERY
  UPDATE public.players AS pl
  SET is_active = p_is_active
  WHERE pl.id = p_player_id
  RETURNING
    pl.id,
    pl.display_name,
    pl.is_active,
    pl.created_at;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'INVALID_PLAYER'
      USING ERRCODE = '22023',
            DETAIL = 'Joueur introuvable.';
  END IF;
END;
$$;

-- ---------------------------------------------------------------------------
-- RPC admin — matchs (corps issus de fixture_download_sync + ordre match_list)
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.admin_get_matches(p_admin_session_token TEXT)
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
  updated_at TIMESTAMPTZ,
  source TEXT,
  last_synced_at TIMESTAMPTZ,
  manual_override BOOLEAN,
  source_home_team TEXT,
  source_away_team TEXT,
  source_kickoff_at TIMESTAMPTZ,
  source_home_score INTEGER,
  source_away_score INTEGER,
  source_status TEXT
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
BEGIN
  PERFORM public.assert_admin_session(p_admin_session_token);

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
    m.updated_at,
    m.source,
    m.last_synced_at,
    m.manual_override,
    m.source_home_team,
    m.source_away_team,
    m.source_kickoff_at,
    m.source_home_score,
    m.source_away_score,
    m.source_status
  FROM public.matches AS m
  ORDER BY m.round_number ASC, m.kickoff_at ASC, m.id ASC;
END;
$$;

CREATE OR REPLACE FUNCTION public.admin_create_match(
  p_admin_session_token TEXT,
  p_round_number INTEGER,
  p_home_team TEXT,
  p_away_team TEXT,
  p_kickoff_at TIMESTAMPTZ,
  p_status TEXT DEFAULT 'scheduled',
  p_home_score INTEGER DEFAULT NULL,
  p_away_score INTEGER DEFAULT NULL,
  p_external_id TEXT DEFAULT NULL
)
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
  updated_at TIMESTAMPTZ,
  source TEXT,
  last_synced_at TIMESTAMPTZ,
  manual_override BOOLEAN,
  source_home_team TEXT,
  source_away_team TEXT,
  source_kickoff_at TIMESTAMPTZ,
  source_home_score INTEGER,
  source_away_score INTEGER,
  source_status TEXT,
  recalculated_count INTEGER
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  home_clean TEXT;
  away_clean TEXT;
  status_clean TEXT;
  external_clean TEXT;
  new_id UUID;
  recalc INTEGER := 0;
BEGIN
  PERFORM public.assert_admin_session(p_admin_session_token);

  IF p_round_number IS NULL OR p_round_number < 1 OR p_round_number > 34 THEN
    RAISE EXCEPTION 'INVALID_ROUND'
      USING ERRCODE = '22023',
            DETAIL = 'Le numéro de journée doit être entre 1 et 34.';
  END IF;

  IF p_kickoff_at IS NULL THEN
    RAISE EXCEPTION 'INVALID_KICKOFF'
      USING ERRCODE = '22023',
            DETAIL = 'La date de coup d’envoi est obligatoire.';
  END IF;

  home_clean := trim(COALESCE(p_home_team, ''));
  away_clean := trim(COALESCE(p_away_team, ''));
  status_clean := COALESCE(nullif(trim(p_status), ''), 'scheduled');
  external_clean := nullif(trim(COALESCE(p_external_id, '')), '');

  IF status_clean NOT IN ('scheduled', 'live', 'finished', 'postponed', 'cancelled') THEN
    RAISE EXCEPTION 'INVALID_STATUS'
      USING ERRCODE = '22023',
            DETAIL = 'Statut de match invalide.';
  END IF;

  PERFORM public.assert_nantes_fixture(home_clean, away_clean);
  PERFORM public.assert_match_scores(status_clean, p_home_score, p_away_score);

  INSERT INTO public.matches AS m (
    external_id,
    round_number,
    home_team,
    away_team,
    kickoff_at,
    status,
    home_score,
    away_score,
    source,
    manual_override
  )
  VALUES (
    external_clean,
    p_round_number,
    home_clean,
    away_clean,
    p_kickoff_at,
    status_clean,
    p_home_score,
    p_away_score,
    'manual',
    FALSE
  )
  RETURNING m.id INTO new_id;

  IF status_clean = 'finished' THEN
    recalc := public.recalculate_points_for_match(new_id);
  END IF;

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
    m.updated_at,
    m.source,
    m.last_synced_at,
    m.manual_override,
    m.source_home_team,
    m.source_away_team,
    m.source_kickoff_at,
    m.source_home_score,
    m.source_away_score,
    m.source_status,
    recalc
  FROM public.matches AS m
  WHERE m.id = new_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.admin_update_match(
  p_admin_session_token TEXT,
  p_match_id UUID,
  p_round_number INTEGER,
  p_home_team TEXT,
  p_away_team TEXT,
  p_kickoff_at TIMESTAMPTZ,
  p_status TEXT,
  p_home_score INTEGER DEFAULT NULL,
  p_away_score INTEGER DEFAULT NULL,
  p_external_id TEXT DEFAULT NULL
)
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
  updated_at TIMESTAMPTZ,
  source TEXT,
  last_synced_at TIMESTAMPTZ,
  manual_override BOOLEAN,
  source_home_team TEXT,
  source_away_team TEXT,
  source_kickoff_at TIMESTAMPTZ,
  source_home_score INTEGER,
  source_away_score INTEGER,
  source_status TEXT,
  recalculated_count INTEGER
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  home_clean TEXT;
  away_clean TEXT;
  status_clean TEXT;
  external_clean TEXT;
  recalc INTEGER := 0;
BEGIN
  PERFORM public.assert_admin_session(p_admin_session_token);

  IF p_match_id IS NULL THEN
    RAISE EXCEPTION 'MATCH_NOT_FOUND'
      USING ERRCODE = 'P0002',
            DETAIL = 'Identifiant de match manquant.';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.matches AS m WHERE m.id = p_match_id
  ) THEN
    RAISE EXCEPTION 'MATCH_NOT_FOUND'
      USING ERRCODE = 'P0002',
            DETAIL = 'Match introuvable.';
  END IF;

  IF p_round_number IS NULL OR p_round_number < 1 OR p_round_number > 34 THEN
    RAISE EXCEPTION 'INVALID_ROUND'
      USING ERRCODE = '22023',
            DETAIL = 'Le numéro de journée doit être entre 1 et 34.';
  END IF;

  IF p_kickoff_at IS NULL THEN
    RAISE EXCEPTION 'INVALID_KICKOFF'
      USING ERRCODE = '22023',
            DETAIL = 'La date de coup d’envoi est obligatoire.';
  END IF;

  home_clean := trim(COALESCE(p_home_team, ''));
  away_clean := trim(COALESCE(p_away_team, ''));
  status_clean := trim(COALESCE(p_status, ''));
  external_clean := nullif(trim(COALESCE(p_external_id, '')), '');

  IF status_clean NOT IN ('scheduled', 'live', 'finished', 'postponed', 'cancelled') THEN
    RAISE EXCEPTION 'INVALID_STATUS'
      USING ERRCODE = '22023',
            DETAIL = 'Statut de match invalide.';
  END IF;

  PERFORM public.assert_nantes_fixture(home_clean, away_clean);
  PERFORM public.assert_match_scores(status_clean, p_home_score, p_away_score);

  UPDATE public.matches AS m
  SET
    external_id = external_clean,
    round_number = p_round_number,
    home_team = home_clean,
    away_team = away_clean,
    kickoff_at = p_kickoff_at,
    status = status_clean,
    home_score = CASE
      WHEN status_clean IN ('postponed', 'cancelled') THEN NULL
      ELSE p_home_score
    END,
    away_score = CASE
      WHEN status_clean IN ('postponed', 'cancelled') THEN NULL
      ELSE p_away_score
    END,
    manual_override = TRUE,
    updated_at = now()
  WHERE m.id = p_match_id;

  recalc := public.recalculate_points_for_match(p_match_id);

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
    m.updated_at,
    m.source,
    m.last_synced_at,
    m.manual_override,
    m.source_home_team,
    m.source_away_team,
    m.source_kickoff_at,
    m.source_home_score,
    m.source_away_score,
    m.source_status,
    recalc
  FROM public.matches AS m
  WHERE m.id = p_match_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.admin_set_match_result(
  p_admin_session_token TEXT,
  p_match_id UUID,
  p_home_score INTEGER,
  p_away_score INTEGER
)
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
  updated_at TIMESTAMPTZ,
  source TEXT,
  last_synced_at TIMESTAMPTZ,
  manual_override BOOLEAN,
  source_home_team TEXT,
  source_away_team TEXT,
  source_kickoff_at TIMESTAMPTZ,
  source_home_score INTEGER,
  source_away_score INTEGER,
  source_status TEXT,
  recalculated_count INTEGER
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  recalc INTEGER := 0;
BEGIN
  PERFORM public.assert_admin_session(p_admin_session_token);

  IF p_match_id IS NULL THEN
    RAISE EXCEPTION 'MATCH_NOT_FOUND'
      USING ERRCODE = 'P0002',
            DETAIL = 'Identifiant de match manquant.';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.matches AS m WHERE m.id = p_match_id
  ) THEN
    RAISE EXCEPTION 'MATCH_NOT_FOUND'
      USING ERRCODE = 'P0002',
            DETAIL = 'Match introuvable.';
  END IF;

  PERFORM public.assert_match_scores('finished', p_home_score, p_away_score);

  UPDATE public.matches AS m
  SET
    status = 'finished',
    home_score = p_home_score,
    away_score = p_away_score,
    manual_override = TRUE,
    updated_at = now()
  WHERE m.id = p_match_id;

  recalc := public.recalculate_points_for_match(p_match_id);

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
    m.updated_at,
    m.source,
    m.last_synced_at,
    m.manual_override,
    m.source_home_team,
    m.source_away_team,
    m.source_kickoff_at,
    m.source_home_score,
    m.source_away_score,
    m.source_status,
    recalc
  FROM public.matches AS m
  WHERE m.id = p_match_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.admin_clear_match_override(
  p_admin_session_token TEXT,
  p_match_id UUID
)
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
  updated_at TIMESTAMPTZ,
  source TEXT,
  last_synced_at TIMESTAMPTZ,
  manual_override BOOLEAN,
  source_home_team TEXT,
  source_away_team TEXT,
  source_kickoff_at TIMESTAMPTZ,
  source_home_score INTEGER,
  source_away_score INTEGER,
  source_status TEXT,
  recalculated_count INTEGER
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  match_row public.matches%ROWTYPE;
  next_status TEXT;
  next_home INTEGER;
  next_away INTEGER;
  recalc INTEGER := 0;
BEGIN
  PERFORM public.assert_admin_session(p_admin_session_token);

  SELECT m.*
  INTO match_row
  FROM public.matches AS m
  WHERE m.id = p_match_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'MATCH_NOT_FOUND'
      USING ERRCODE = 'P0002',
            DETAIL = 'Match introuvable.';
  END IF;

  next_status := match_row.status;
  next_home := match_row.home_score;
  next_away := match_row.away_score;

  IF match_row.source = 'fixturedownload'
     AND match_row.source_home_team IS NOT NULL
     AND match_row.source_away_team IS NOT NULL
     AND match_row.source_kickoff_at IS NOT NULL THEN
    next_status := COALESCE(match_row.source_status, match_row.status);
    next_home := match_row.source_home_score;
    next_away := match_row.source_away_score;

    IF match_row.status IN ('postponed', 'cancelled')
       AND COALESCE(match_row.source_status, 'scheduled') = 'scheduled' THEN
      -- Conserve report / annulation manuels tant que la source n’a pas de score.
      next_status := match_row.status;
      next_home := NULL;
      next_away := NULL;
    ELSIF match_row.status = 'finished'
          AND COALESCE(match_row.source_status, 'scheduled') = 'scheduled' THEN
      -- Ne jamais rétrograder un match terminé vers programmé.
      next_status := 'finished';
      next_home := match_row.home_score;
      next_away := match_row.away_score;
    END IF;

    UPDATE public.matches AS m
    SET
      home_team = match_row.source_home_team,
      away_team = match_row.source_away_team,
      kickoff_at = match_row.source_kickoff_at,
      status = next_status,
      home_score = next_home,
      away_score = next_away,
      manual_override = FALSE,
      updated_at = now()
    WHERE m.id = p_match_id;
  ELSE
    UPDATE public.matches AS m
    SET
      manual_override = FALSE,
      updated_at = now()
    WHERE m.id = p_match_id;
  END IF;

  recalc := public.recalculate_points_for_match(p_match_id);

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
    m.updated_at,
    m.source,
    m.last_synced_at,
    m.manual_override,
    m.source_home_team,
    m.source_away_team,
    m.source_kickoff_at,
    m.source_home_score,
    m.source_away_score,
    m.source_status,
    recalc
  FROM public.matches AS m
  WHERE m.id = p_match_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.admin_get_fixture_sync_meta(p_admin_session_token TEXT)
RETURNS TABLE (
  last_synced_at TIMESTAMPTZ,
  source_label TEXT
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  raw_value TEXT;
BEGIN
  PERFORM public.assert_admin_session(p_admin_session_token);

  SELECT s.value INTO raw_value
  FROM public.app_settings AS s
  WHERE s.key = 'fixture_sync_last_at';

  RETURN QUERY
  SELECT
    CASE
      WHEN raw_value IS NULL OR raw_value = '' THEN NULL
      ELSE raw_value::TIMESTAMPTZ
    END,
    'Fixture Download'::TEXT;
END;
$$;

CREATE OR REPLACE FUNCTION public.admin_commit_fixture_sync(
  p_admin_session_token TEXT,
  p_plan JSONB
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  synced_at TIMESTAMPTZ;
  create_item JSONB;
  update_item JSONB;
  new_id UUID;
  points_recalculated INTEGER := 0;
  recalc INTEGER;
  created_count INTEGER := 0;
  updated_count INTEGER := 0;
  unchanged_count INTEGER := 0;
  new_results_count INTEGER := 0;
  protected_count INTEGER := 0;
BEGIN
  PERFORM public.assert_admin_session(p_admin_session_token);

  IF p_plan IS NULL OR jsonb_typeof(p_plan) <> 'object' THEN
    RAISE EXCEPTION 'INVALID_SYNC_PLAN'
      USING ERRCODE = '22023',
            DETAIL = 'Plan de synchronisation invalide.';
  END IF;

  IF COALESCE(jsonb_array_length(p_plan->'conflicts'), 0) > 0 THEN
    RAISE EXCEPTION 'SYNC_CONFLICT'
      USING ERRCODE = 'P0001',
            DETAIL = 'Des conflits empêchent la synchronisation.';
  END IF;

  synced_at := COALESCE((p_plan->>'synced_at')::TIMESTAMPTZ, now());

  FOR create_item IN
    SELECT value FROM jsonb_array_elements(COALESCE(p_plan->'creates', '[]'::jsonb))
  LOOP
    INSERT INTO public.matches (
      external_id,
      round_number,
      home_team,
      away_team,
      kickoff_at,
      kickoff_time_confirmed,
      status,
      home_score,
      away_score,
      source,
      last_synced_at,
      manual_override,
      source_home_team,
      source_away_team,
      source_kickoff_at,
      source_home_score,
      source_away_score,
      source_status
    )
    VALUES (
      create_item->>'external_id',
      (create_item->>'round_number')::INTEGER,
      create_item->>'home_team',
      create_item->>'away_team',
      (create_item->>'kickoff_at')::TIMESTAMPTZ,
      CASE
        WHEN create_item->>'status' = 'finished' THEN TRUE
        WHEN public.is_paris_midnight_kickoff((create_item->>'kickoff_at')::TIMESTAMPTZ)
          THEN FALSE
        ELSE TRUE
      END,
      create_item->>'status',
      NULLIF(create_item->>'home_score', '')::INTEGER,
      NULLIF(create_item->>'away_score', '')::INTEGER,
      'fixturedownload',
      synced_at,
      FALSE,
      create_item->>'home_team',
      create_item->>'away_team',
      (create_item->>'kickoff_at')::TIMESTAMPTZ,
      NULLIF(create_item->>'home_score', '')::INTEGER,
      NULLIF(create_item->>'away_score', '')::INTEGER,
      create_item->>'status'
    )
    RETURNING id INTO new_id;

    created_count := created_count + 1;

    IF create_item->>'status' = 'finished' THEN
      new_results_count := new_results_count + 1;
      recalc := public.recalculate_points_for_match(new_id);
      points_recalculated := points_recalculated + recalc;
    END IF;
  END LOOP;

  FOR update_item IN
    SELECT value FROM jsonb_array_elements(COALESCE(p_plan->'updates', '[]'::jsonb))
  LOOP
    IF COALESCE((update_item->>'protected')::BOOLEAN, FALSE) THEN
      protected_count := protected_count + 1;

      UPDATE public.matches AS m
      SET
        external_id = update_item->>'external_id',
        source = 'fixturedownload',
        last_synced_at = synced_at,
        source_home_team = update_item->>'source_home_team',
        source_away_team = update_item->>'source_away_team',
        source_kickoff_at = (update_item->>'source_kickoff_at')::TIMESTAMPTZ,
        source_home_score = NULLIF(update_item->>'source_home_score', '')::INTEGER,
        source_away_score = NULLIF(update_item->>'source_away_score', '')::INTEGER,
        source_status = update_item->>'source_status',
        updated_at = now()
      WHERE m.id = (update_item->>'id')::UUID;
    ELSIF COALESCE((update_item->>'unchanged')::BOOLEAN, FALSE) THEN
      unchanged_count := unchanged_count + 1;

      UPDATE public.matches AS m
      SET
        external_id = update_item->>'external_id',
        source = 'fixturedownload',
        last_synced_at = synced_at,
        source_home_team = update_item->>'source_home_team',
        source_away_team = update_item->>'source_away_team',
        source_kickoff_at = (update_item->>'source_kickoff_at')::TIMESTAMPTZ,
        source_home_score = NULLIF(update_item->>'source_home_score', '')::INTEGER,
        source_away_score = NULLIF(update_item->>'source_away_score', '')::INTEGER,
        source_status = update_item->>'source_status',
        updated_at = now()
      WHERE m.id = (update_item->>'id')::UUID;
    ELSE
      updated_count := updated_count + 1;

      IF COALESCE((update_item->>'new_result')::BOOLEAN, FALSE) THEN
        new_results_count := new_results_count + 1;
      END IF;

      UPDATE public.matches AS m
      SET
        external_id = update_item->>'external_id',
        source = 'fixturedownload',
        round_number = (update_item->>'round_number')::INTEGER,
        home_team = update_item->>'home_team',
        away_team = update_item->>'away_team',
        kickoff_at = (update_item->>'kickoff_at')::TIMESTAMPTZ,
        kickoff_time_confirmed = CASE
          WHEN update_item->>'status' = 'finished' THEN TRUE
          WHEN public.is_paris_midnight_kickoff((update_item->>'kickoff_at')::TIMESTAMPTZ)
            THEN FALSE
          ELSE TRUE
        END,
        status = update_item->>'status',
        home_score = NULLIF(update_item->>'home_score', '')::INTEGER,
        away_score = NULLIF(update_item->>'away_score', '')::INTEGER,
        last_synced_at = synced_at,
        source_home_team = update_item->>'source_home_team',
        source_away_team = update_item->>'source_away_team',
        source_kickoff_at = (update_item->>'source_kickoff_at')::TIMESTAMPTZ,
        source_home_score = NULLIF(update_item->>'source_home_score', '')::INTEGER,
        source_away_score = NULLIF(update_item->>'source_away_score', '')::INTEGER,
        source_status = update_item->>'source_status',
        updated_at = now()
      WHERE m.id = (update_item->>'id')::UUID;

      IF COALESCE((update_item->>'recalculate')::BOOLEAN, FALSE) THEN
        recalc := public.recalculate_points_for_match((update_item->>'id')::UUID);
        points_recalculated := points_recalculated + recalc;
      END IF;
    END IF;
  END LOOP;

  INSERT INTO public.app_settings (key, value)
  VALUES ('fixture_sync_last_at', synced_at::TEXT)
  ON CONFLICT (key) DO UPDATE
  SET
    value = EXCLUDED.value,
    updated_at = now();

  RETURN jsonb_build_object(
    'created', created_count,
    'updated', updated_count,
    'unchanged', unchanged_count,
    'new_results', new_results_count,
    'points_recalculated', points_recalculated,
    'conflicts', '[]'::jsonb,
    'protected', protected_count,
    'last_synced_at', synced_at
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.admin_get_stats(p_admin_session_token TEXT)
RETURNS TABLE (
  players_count BIGINT,
  active_players_count BIGINT,
  matches_count BIGINT,
  finished_matches_count BIGINT,
  supabase_ok BOOLEAN
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
BEGIN
  PERFORM public.assert_admin_session(p_admin_session_token);

  RETURN QUERY
  SELECT
    (SELECT count(*) FROM public.players AS pl)::BIGINT,
    (SELECT count(*) FROM public.players AS pl WHERE pl.is_active = TRUE)::BIGINT,
    (SELECT count(*) FROM public.matches AS m)::BIGINT,
    (
      SELECT count(*)
      FROM public.matches AS m
      WHERE m.status = 'finished'
    )::BIGINT,
    TRUE;
END;
$$;

-- ---------------------------------------------------------------------------
-- Code d’accès commun + PIN joueur
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.admin_update_access_code(
  p_admin_session_token TEXT,
  p_new_access_code TEXT
)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  cleaned TEXT;
  existing_key TEXT;
  updated_rows INTEGER;
BEGIN
  PERFORM public.assert_admin_session(p_admin_session_token);

  cleaned := trim(COALESCE(p_new_access_code, ''));

  IF cleaned = '' THEN
    RAISE EXCEPTION 'INVALID_ACCESS_CODE'
      USING ERRCODE = '22023',
            DETAIL = 'Le nouveau code d’accès est vide.';
  END IF;

  IF char_length(cleaned) < 4 OR char_length(cleaned) > 64 THEN
    RAISE EXCEPTION 'INVALID_ACCESS_CODE_LENGTH'
      USING ERRCODE = '22023',
            DETAIL = 'Le code d’accès doit contenir entre 4 et 64 caractères.';
  END IF;

  SELECT s.key
  INTO existing_key
  FROM public.app_settings AS s
  WHERE s.key = 'access_code_hash';

  IF existing_key IS NULL THEN
    RAISE EXCEPTION 'ACCESS_CODE_NOT_CONFIGURED'
      USING ERRCODE = 'P0001',
            DETAIL = 'La clé access_code_hash est absente.';
  END IF;

  UPDATE public.app_settings AS s
  SET
    value = extensions.crypt(cleaned, extensions.gen_salt('bf')),
    updated_at = now()
  WHERE s.key = 'access_code_hash';

  GET DIAGNOSTICS updated_rows = ROW_COUNT;

  IF updated_rows <> 1 THEN
    RAISE EXCEPTION 'ACCESS_CODE_NOT_CONFIGURED'
      USING ERRCODE = 'P0001',
            DETAIL = 'Impossible de mettre à jour access_code_hash.';
  END IF;

  RETURN TRUE;
END;
$$;

CREATE OR REPLACE FUNCTION public.admin_reset_player_pin(
  p_admin_session_token TEXT,
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
  PERFORM public.assert_admin_session(p_admin_session_token);

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
  p_admin_session_token TEXT,
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
  PERFORM public.assert_admin_session(p_admin_session_token);

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
-- Privileges
-- ---------------------------------------------------------------------------

REVOKE ALL ON FUNCTION public.login_admin(TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.logout_admin(TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.verify_admin_code(TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.admin_get_players(TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.admin_create_player(TEXT, TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.admin_update_player_name(TEXT, UUID, TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.admin_set_player_active(TEXT, UUID, BOOLEAN) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.admin_get_matches(TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.admin_create_match(TEXT, INTEGER, TEXT, TEXT, TIMESTAMPTZ, TEXT, INTEGER, INTEGER, TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.admin_update_match(TEXT, UUID, INTEGER, TEXT, TEXT, TIMESTAMPTZ, TEXT, INTEGER, INTEGER, TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.admin_set_match_result(TEXT, UUID, INTEGER, INTEGER) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.admin_get_stats(TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.admin_clear_match_override(TEXT, UUID) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.admin_get_fixture_sync_meta(TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.admin_commit_fixture_sync(TEXT, JSONB) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.admin_update_access_code(TEXT, TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.admin_reset_player_pin(TEXT, UUID) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.admin_unlock_player_pin(TEXT, UUID) FROM PUBLIC;

GRANT EXECUTE ON FUNCTION public.login_admin(TEXT) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.logout_admin(TEXT) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.verify_admin_code(TEXT) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.admin_get_players(TEXT) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.admin_create_player(TEXT, TEXT) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.admin_update_player_name(TEXT, UUID, TEXT) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.admin_set_player_active(TEXT, UUID, BOOLEAN) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.admin_get_matches(TEXT) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.admin_create_match(TEXT, INTEGER, TEXT, TEXT, TIMESTAMPTZ, TEXT, INTEGER, INTEGER, TEXT) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.admin_update_match(TEXT, UUID, INTEGER, TEXT, TEXT, TIMESTAMPTZ, TEXT, INTEGER, INTEGER, TEXT) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.admin_set_match_result(TEXT, UUID, INTEGER, INTEGER) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.admin_get_stats(TEXT) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.admin_clear_match_override(TEXT, UUID) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.admin_get_fixture_sync_meta(TEXT) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.admin_commit_fixture_sync(TEXT, JSONB) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.admin_update_access_code(TEXT, TEXT) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.admin_reset_player_pin(TEXT, UUID) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.admin_unlock_player_pin(TEXT, UUID) TO anon, authenticated;
