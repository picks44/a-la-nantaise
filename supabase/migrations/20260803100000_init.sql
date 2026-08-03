-- À la Nantaise — schéma initial, RLS et RPC
-- Accès frontend : clé anon uniquement, via fonctions SECURITY DEFINER.
-- Aucune Auth Supabase. Le code commun est stocké uniquement sous forme de hash bcrypt.

CREATE EXTENSION IF NOT EXISTS pgcrypto WITH SCHEMA extensions;

-- ---------------------------------------------------------------------------
-- Tables
-- ---------------------------------------------------------------------------

CREATE TABLE public.players (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  display_name TEXT NOT NULL,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT players_display_name_not_blank CHECK (length(trim(display_name)) > 0)
);

CREATE TABLE public.matches (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  external_id TEXT UNIQUE,
  round_number INTEGER NOT NULL CHECK (round_number > 0),
  home_team TEXT NOT NULL CHECK (length(trim(home_team)) > 0),
  away_team TEXT NOT NULL CHECK (length(trim(away_team)) > 0),
  kickoff_at TIMESTAMPTZ NOT NULL,
  status TEXT NOT NULL DEFAULT 'scheduled'
    CHECK (status IN ('scheduled', 'live', 'finished', 'postponed', 'cancelled')),
  home_score INTEGER
    CHECK (home_score IS NULL OR (home_score >= 0 AND home_score <= 15)),
  away_score INTEGER
    CHECK (away_score IS NULL OR (away_score >= 0 AND away_score <= 15)),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT matches_scores_both_or_neither CHECK (
    (home_score IS NULL AND away_score IS NULL)
    OR (home_score IS NOT NULL AND away_score IS NOT NULL)
  )
);

CREATE TABLE public.predictions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  player_id UUID NOT NULL REFERENCES public.players (id) ON DELETE CASCADE,
  match_id UUID NOT NULL REFERENCES public.matches (id) ON DELETE CASCADE,
  predicted_home_score INTEGER NOT NULL
    CHECK (predicted_home_score >= 0 AND predicted_home_score <= 15),
  predicted_away_score INTEGER NOT NULL
    CHECK (predicted_away_score >= 0 AND predicted_away_score <= 15),
  points INTEGER CHECK (points IS NULL OR points IN (0, 1, 3)),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT predictions_player_match_unique UNIQUE (player_id, match_id)
);

CREATE TABLE public.app_settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL DEFAULT '',
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX predictions_match_id_idx ON public.predictions (match_id);
CREATE INDEX predictions_player_id_idx ON public.predictions (player_id);
CREATE INDEX matches_kickoff_at_idx ON public.matches (kickoff_at);

-- Placeholdér pour le hash du code commun (ne jamais y mettre le code en clair).
INSERT INTO public.app_settings (key, value)
VALUES ('access_code_hash', '');

-- ---------------------------------------------------------------------------
-- Triggers updated_at
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.set_updated_at()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

CREATE TRIGGER matches_set_updated_at
  BEFORE UPDATE ON public.matches
  FOR EACH ROW
  EXECUTE FUNCTION public.set_updated_at();

CREATE TRIGGER predictions_set_updated_at
  BEFORE UPDATE ON public.predictions
  FOR EACH ROW
  EXECUTE FUNCTION public.set_updated_at();

CREATE TRIGGER app_settings_set_updated_at
  BEFORE UPDATE ON public.app_settings
  FOR EACH ROW
  EXECUTE FUNCTION public.set_updated_at();

-- ---------------------------------------------------------------------------
-- RLS : accès direct anonyme refusé (aucune policy)
-- ---------------------------------------------------------------------------

ALTER TABLE public.players ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.matches ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.predictions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.app_settings ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public.players FROM PUBLIC, anon, authenticated;
REVOKE ALL ON TABLE public.matches FROM PUBLIC, anon, authenticated;
REVOKE ALL ON TABLE public.predictions FROM PUBLIC, anon, authenticated;
REVOKE ALL ON TABLE public.app_settings FROM PUBLIC, anon, authenticated;

-- ---------------------------------------------------------------------------
-- Helpers internes
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.assert_access_code(p_access_code TEXT)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  stored_hash TEXT;
BEGIN
  IF p_access_code IS NULL OR length(trim(p_access_code)) = 0 THEN
    RAISE EXCEPTION 'INVALID_ACCESS_CODE'
      USING ERRCODE = '28000',
            DETAIL = 'Le code d’accès est manquant.';
  END IF;

  SELECT value INTO stored_hash
  FROM public.app_settings
  WHERE key = 'access_code_hash';

  IF stored_hash IS NULL OR stored_hash = '' THEN
    RAISE EXCEPTION 'ACCESS_CODE_NOT_CONFIGURED'
      USING ERRCODE = 'P0001',
            DETAIL = 'Le hash du code commun n’a pas encore été défini.';
  END IF;

  IF stored_hash <> crypt(trim(p_access_code), stored_hash) THEN
    RAISE EXCEPTION 'INVALID_ACCESS_CODE'
      USING ERRCODE = '28000',
            DETAIL = 'Code d’accès incorrect.';
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION public.compute_prediction_points(
  p_predicted_home INTEGER,
  p_predicted_away INTEGER,
  p_home_score INTEGER,
  p_away_score INTEGER
)
RETURNS INTEGER
LANGUAGE plpgsql
IMMUTABLE
SET search_path = public
AS $$
BEGIN
  IF p_home_score IS NULL OR p_away_score IS NULL THEN
    RETURN NULL;
  END IF;

  IF p_predicted_home = p_home_score AND p_predicted_away = p_away_score THEN
    RETURN 3;
  END IF;

  IF sign(p_predicted_home - p_predicted_away) = sign(p_home_score - p_away_score) THEN
    RETURN 1;
  END IF;

  RETURN 0;
END;
$$;

-- ---------------------------------------------------------------------------
-- RPC publiques
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.verify_access_code(p_access_code TEXT)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
BEGIN
  PERFORM public.assert_access_code(p_access_code);
  RETURN TRUE;
EXCEPTION
  WHEN OTHERS THEN
    IF SQLERRM LIKE 'ACCESS_CODE_NOT_CONFIGURED%' THEN
      RAISE;
    END IF;
    RETURN FALSE;
END;
$$;

CREATE OR REPLACE FUNCTION public.get_active_players(p_access_code TEXT)
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
  PERFORM public.assert_access_code(p_access_code);

  RETURN QUERY
  SELECT p.id, p.display_name, p.is_active, p.created_at
  FROM public.players p
  WHERE p.is_active = TRUE
  ORDER BY p.display_name ASC;
END;
$$;

CREATE OR REPLACE FUNCTION public.get_matches(p_access_code TEXT)
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
  PERFORM public.assert_access_code(p_access_code);

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
  FROM public.matches m
  ORDER BY m.kickoff_at ASC;
END;
$$;

CREATE OR REPLACE FUNCTION public.get_my_predictions(
  p_access_code TEXT,
  p_player_id UUID
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
BEGIN
  PERFORM public.assert_access_code(p_access_code);

  IF p_player_id IS NULL THEN
    RAISE EXCEPTION 'INVALID_PLAYER'
      USING ERRCODE = '22023',
            DETAIL = 'Identifiant joueur manquant.';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.players pl
    WHERE pl.id = p_player_id AND pl.is_active = TRUE
  ) THEN
    RAISE EXCEPTION 'INVALID_PLAYER'
      USING ERRCODE = '22023',
            DETAIL = 'Joueur introuvable ou inactif.';
  END IF;

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
  FROM public.predictions pr
  WHERE pr.player_id = p_player_id
  ORDER BY pr.created_at ASC;
END;
$$;

CREATE OR REPLACE FUNCTION public.upsert_prediction(
  p_access_code TEXT,
  p_player_id UUID,
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
DECLARE
  match_row public.matches%ROWTYPE;
BEGIN
  PERFORM public.assert_access_code(p_access_code);

  IF p_player_id IS NULL OR p_match_id IS NULL THEN
    RAISE EXCEPTION 'INVALID_INPUT'
      USING ERRCODE = '22023',
            DETAIL = 'Joueur ou match manquant.';
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

  IF NOT EXISTS (
    SELECT 1 FROM public.players pl
    WHERE pl.id = p_player_id AND pl.is_active = TRUE
  ) THEN
    RAISE EXCEPTION 'INVALID_PLAYER'
      USING ERRCODE = '22023',
            DETAIL = 'Joueur introuvable ou inactif.';
  END IF;

  SELECT * INTO match_row
  FROM public.matches m
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
    INSERT INTO public.predictions (
      player_id,
      match_id,
      predicted_home_score,
      predicted_away_score
    )
    VALUES (
      p_player_id,
      p_match_id,
      p_predicted_home_score,
      p_predicted_away_score
    )
    ON CONFLICT (player_id, match_id)
    DO UPDATE SET
      predicted_home_score = EXCLUDED.predicted_home_score,
      predicted_away_score = EXCLUDED.predicted_away_score,
      points = NULL,
      updated_at = now()
    WHERE (
      SELECT m2.kickoff_at > now()
      FROM public.matches m2
      WHERE m2.id = EXCLUDED.match_id
    )
    RETURNING
      id,
      player_id,
      match_id,
      predicted_home_score,
      predicted_away_score,
      points,
      created_at,
      updated_at
  )
  SELECT * FROM upserted;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'MATCH_LOCKED'
      USING ERRCODE = 'P0001',
            DETAIL = 'Le match a commencé : les pronostics sont verrouillés.';
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION public.get_visible_predictions(
  p_access_code TEXT,
  p_player_id UUID
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
BEGIN
  PERFORM public.assert_access_code(p_access_code);

  IF p_player_id IS NULL THEN
    RAISE EXCEPTION 'INVALID_PLAYER'
      USING ERRCODE = '22023',
            DETAIL = 'Identifiant joueur manquant.';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.players pl
    WHERE pl.id = p_player_id AND pl.is_active = TRUE
  ) THEN
    RAISE EXCEPTION 'INVALID_PLAYER'
      USING ERRCODE = '22023',
            DETAIL = 'Joueur introuvable ou inactif.';
  END IF;

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
  FROM public.predictions pr
  INNER JOIN public.matches m ON m.id = pr.match_id
  WHERE pr.player_id = p_player_id
     OR m.kickoff_at <= now()
  ORDER BY pr.created_at ASC;
END;
$$;

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
  FROM public.players p
  LEFT JOIN public.predictions pr
    ON pr.player_id = p.id
   AND pr.points IS NOT NULL
  WHERE p.is_active = TRUE
  GROUP BY p.id, p.display_name
  ORDER BY points DESC, exact_scores DESC, p.display_name ASC;
END;
$$;

CREATE OR REPLACE FUNCTION public.recalculate_match_points(
  p_access_code TEXT,
  p_match_id UUID
)
RETURNS TABLE (
  updated_count INTEGER
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  match_row public.matches%ROWTYPE;
  v_count INTEGER := 0;
BEGIN
  PERFORM public.assert_access_code(p_access_code);

  IF p_match_id IS NULL THEN
    RAISE EXCEPTION 'INVALID_INPUT'
      USING ERRCODE = '22023',
            DETAIL = 'Identifiant de match manquant.';
  END IF;

  SELECT * INTO match_row
  FROM public.matches m
  WHERE m.id = p_match_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'MATCH_NOT_FOUND'
      USING ERRCODE = 'P0002',
            DETAIL = 'Match introuvable.';
  END IF;

  IF match_row.status <> 'finished'
     OR match_row.home_score IS NULL
     OR match_row.away_score IS NULL THEN
    RAISE EXCEPTION 'MATCH_NOT_FINISHED'
      USING ERRCODE = 'P0001',
            DETAIL = 'Le match doit être terminé avec un score pour calculer les points.';
  END IF;

  UPDATE public.predictions pr
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

  RETURN QUERY SELECT v_count;
END;
$$;

-- ---------------------------------------------------------------------------
-- Droits d’exécution RPC pour la clé anon
-- ---------------------------------------------------------------------------

REVOKE ALL ON FUNCTION public.assert_access_code(TEXT) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.compute_prediction_points(INTEGER, INTEGER, INTEGER, INTEGER) FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.verify_access_code(TEXT) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_active_players(TEXT) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_matches(TEXT) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_my_predictions(TEXT, UUID) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.upsert_prediction(TEXT, UUID, UUID, INTEGER, INTEGER) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_visible_predictions(TEXT, UUID) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_ranking(TEXT) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.recalculate_match_points(TEXT, UUID) TO anon, authenticated;
