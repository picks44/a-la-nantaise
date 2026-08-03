-- Administration : code admin distinct + RPC de gestion
-- Aucune table ni donnée existante n’est supprimée.

-- ---------------------------------------------------------------------------
-- Paramètre admin_code_hash (placeholder vide jusqu’à configuration)
-- ---------------------------------------------------------------------------

INSERT INTO public.app_settings (key, value)
VALUES ('admin_code_hash', '')
ON CONFLICT (key) DO NOTHING;

-- Unicité pseudo insensible à la casse (conserve les lignes existantes)
CREATE UNIQUE INDEX IF NOT EXISTS players_display_name_lower_uidx
  ON public.players (lower(trim(display_name)));

-- ---------------------------------------------------------------------------
-- Helpers admin
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.assert_admin_code(p_admin_code TEXT)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  stored_hash TEXT;
BEGIN
  IF p_admin_code IS NULL OR length(trim(p_admin_code)) = 0 THEN
    RAISE EXCEPTION 'INVALID_ADMIN_CODE'
      USING ERRCODE = '28000',
            DETAIL = 'Le code administrateur est manquant.';
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

  IF stored_hash <> crypt(trim(p_admin_code), stored_hash) THEN
    RAISE EXCEPTION 'INVALID_ADMIN_CODE'
      USING ERRCODE = '28000',
            DETAIL = 'Code administrateur incorrect.';
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION public.verify_admin_code(p_admin_code TEXT)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
BEGIN
  PERFORM public.assert_admin_code(p_admin_code);
  RETURN TRUE;
EXCEPTION
  WHEN OTHERS THEN
    IF SQLERRM LIKE 'ADMIN_CODE_NOT_CONFIGURED%' THEN
      RAISE;
    END IF;
    RETURN FALSE;
END;
$$;

CREATE OR REPLACE FUNCTION public.normalize_player_name(p_display_name TEXT)
RETURNS TEXT
LANGUAGE plpgsql
IMMUTABLE
SET search_path = public
AS $$
DECLARE
  cleaned TEXT;
BEGIN
  cleaned := trim(COALESCE(p_display_name, ''));

  IF length(cleaned) < 2 OR length(cleaned) > 30 THEN
    RAISE EXCEPTION 'INVALID_PLAYER_NAME'
      USING ERRCODE = '22023',
            DETAIL = 'Le pseudo doit contenir entre 2 et 30 caractères.';
  END IF;

  RETURN cleaned;
END;
$$;

CREATE OR REPLACE FUNCTION public.assert_nantes_fixture(
  p_home_team TEXT,
  p_away_team TEXT
)
RETURNS VOID
LANGUAGE plpgsql
IMMUTABLE
SET search_path = public
AS $$
DECLARE
  home_clean TEXT := trim(COALESCE(p_home_team, ''));
  away_clean TEXT := trim(COALESCE(p_away_team, ''));
  nantes_count INTEGER;
BEGIN
  IF home_clean = '' OR away_clean = '' THEN
    RAISE EXCEPTION 'INVALID_TEAM_NAME'
      USING ERRCODE = '22023',
            DETAIL = 'Les noms d’équipes sont obligatoires.';
  END IF;

  nantes_count :=
    (CASE WHEN lower(home_clean) = lower('FC Nantes') THEN 1 ELSE 0 END)
    + (CASE WHEN lower(away_clean) = lower('FC Nantes') THEN 1 ELSE 0 END);

  IF nantes_count <> 1 THEN
    RAISE EXCEPTION 'INVALID_NANTES_FIXTURE'
      USING ERRCODE = '22023',
            DETAIL = 'Exactement une des deux équipes doit être le FC Nantes.';
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION public.assert_match_scores(
  p_status TEXT,
  p_home_score INTEGER,
  p_away_score INTEGER
)
RETURNS VOID
LANGUAGE plpgsql
IMMUTABLE
SET search_path = public
AS $$
BEGIN
  IF p_status = 'finished' THEN
    IF p_home_score IS NULL OR p_away_score IS NULL THEN
      RAISE EXCEPTION 'INCOMPLETE_RESULT'
        USING ERRCODE = '22023',
              DETAIL = 'Un match terminé doit avoir ses deux scores.';
    END IF;
  END IF;

  IF p_home_score IS NOT NULL AND (p_home_score < 0 OR p_home_score > 15) THEN
    RAISE EXCEPTION 'INVALID_SCORE'
      USING ERRCODE = '22023',
            DETAIL = 'Les scores doivent être des entiers entre 0 et 15.';
  END IF;

  IF p_away_score IS NOT NULL AND (p_away_score < 0 OR p_away_score > 15) THEN
    RAISE EXCEPTION 'INVALID_SCORE'
      USING ERRCODE = '22023',
            DETAIL = 'Les scores doivent être des entiers entre 0 et 15.';
  END IF;

  IF (p_home_score IS NULL) <> (p_away_score IS NULL) THEN
    RAISE EXCEPTION 'INCOMPLETE_RESULT'
      USING ERRCODE = '22023',
            DETAIL = 'Les deux scores doivent être renseignés ensemble.';
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION public.recalculate_points_for_match(p_match_id UUID)
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  match_row public.matches%ROWTYPE;
  v_count INTEGER := 0;
BEGIN
  SELECT m.*
  INTO match_row
  FROM public.matches AS m
  WHERE m.id = p_match_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'MATCH_NOT_FOUND'
      USING ERRCODE = 'P0002',
            DETAIL = 'Match introuvable.';
  END IF;

  IF match_row.status <> 'finished'
     OR match_row.home_score IS NULL
     OR match_row.away_score IS NULL THEN
    UPDATE public.predictions AS pr
    SET
      points = NULL,
      updated_at = now()
    WHERE pr.match_id = p_match_id;

    GET DIAGNOSTICS v_count = ROW_COUNT;
    RETURN v_count;
  END IF;

  UPDATE public.predictions AS pr
  SET
    points = public.compute_prediction_points(
      pr.predicted_home_score,
      pr.predicted_away_score,
      match_row.home_score,
      match_row.away_score
    ),
    updated_at = now()
  WHERE pr.match_id = p_match_id;

  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN v_count;
END;
$$;

-- ---------------------------------------------------------------------------
-- Classement : inclure les inactifs qui ont déjà des points
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.get_ranking(p_access_code TEXT)
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
  PERFORM public.assert_access_code(p_access_code);

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
     OR EXISTS (
       SELECT 1
       FROM public.predictions AS pr2
       WHERE pr2.player_id = p.id
         AND pr2.points IS NOT NULL
         AND pr2.points > 0
     )
  GROUP BY p.id, p.display_name
  ORDER BY points DESC, exact_scores DESC, p.display_name ASC;
END;
$$;

-- ---------------------------------------------------------------------------
-- RPC admin — participants
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.admin_get_players(p_admin_code TEXT)
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
  PERFORM public.assert_admin_code(p_admin_code);

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
  p_admin_code TEXT,
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
  PERFORM public.assert_admin_code(p_admin_code);
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
  p_admin_code TEXT,
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
  PERFORM public.assert_admin_code(p_admin_code);

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
  p_admin_code TEXT,
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
  PERFORM public.assert_admin_code(p_admin_code);

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
-- RPC admin — matchs
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.admin_get_matches(p_admin_code TEXT)
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
  PERFORM public.assert_admin_code(p_admin_code);

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
  ORDER BY m.kickoff_at ASC;
END;
$$;

CREATE OR REPLACE FUNCTION public.admin_create_match(
  p_admin_code TEXT,
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
  PERFORM public.assert_admin_code(p_admin_code);

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
    away_score
  )
  VALUES (
    external_clean,
    p_round_number,
    home_clean,
    away_clean,
    p_kickoff_at,
    status_clean,
    p_home_score,
    p_away_score
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
    recalc
  FROM public.matches AS m
  WHERE m.id = new_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.admin_update_match(
  p_admin_code TEXT,
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
  PERFORM public.assert_admin_code(p_admin_code);

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
    recalc
  FROM public.matches AS m
  WHERE m.id = p_match_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.admin_set_match_result(
  p_admin_code TEXT,
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
  recalculated_count INTEGER
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  recalc INTEGER := 0;
BEGIN
  PERFORM public.assert_admin_code(p_admin_code);

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
    recalc
  FROM public.matches AS m
  WHERE m.id = p_match_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.admin_get_stats(p_admin_code TEXT)
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
  PERFORM public.assert_admin_code(p_admin_code);

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
-- Droits d’exécution
-- ---------------------------------------------------------------------------

REVOKE ALL ON FUNCTION public.assert_admin_code(TEXT) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.normalize_player_name(TEXT) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.assert_nantes_fixture(TEXT, TEXT) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.assert_match_scores(TEXT, INTEGER, INTEGER) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.recalculate_points_for_match(UUID) FROM PUBLIC, anon, authenticated;

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
GRANT EXECUTE ON FUNCTION public.get_ranking(TEXT) TO anon, authenticated;
