-- =============================================================================
-- Réconciliation RPC/fonctions — état attendu après 20260803160000
-- =============================================================================
-- Fichier HORS supabase/migrations (ne pas traiter comme migration applicative).
--
-- Contexte : tables/colonnes/contraintes/index/triggers/RLS/app_settings déjà
-- présents sur la base distante ; fonctions/RPC absentes (sauf set_updated_at).
--
-- Ce script :
--   - est transactionnel ;
--   - installe/remplace UNIQUEMENT les fonctions + GRANT/REVOKE associés ;
--   - rejoue l’ordre historique 100000 → 120000 → 130000 → 140000 → 150000 → 160000
--     pour les corps/signatures stables ;
--   - pour admin_get_matches / admin_create_match / admin_update_match /
--     admin_set_match_result (RETURNS TABLE enrichi) : UNIQUEMENT la version
--     finale, précédée d’un DROP (évite l’échec PostgreSQL « cannot change
--     return type » si une signature enrichie existe déjà) ;
--   - admin_get_matches final = 150000 (20 colonnes + ORDER BY round/kickoff/id) ;
--   - applique un durcissement EXECUTE (REVOKE PUBLIC) sur les 30 fonctions finales ;
--   - n’inclut PAS 20260803170000_web_push ;
--   - ne recrée PAS les tables, colonnes, index, triggers, RLS, ni INSERT app_settings ;
--   - ne contient aucun secret en clair.
--
-- Prérequis : extension pgcrypto (schema extensions) déjà disponible (IF NOT EXISTS ci-dessous).
-- Exécution : coller dans Supabase SQL Editor, vérifier, puis Run (manuel).
-- Ne PAS exécuter depuis un agent sans validation propriétaire.
-- Ne PAS marquer les migrations appliquées tant que ce script n’a pas réussi.
-- =============================================================================

BEGIN;

CREATE EXTENSION IF NOT EXISTS pgcrypto WITH SCHEMA extensions;

-- ---------------------------------------------------------------------------
-- [20260803100000_init] fonctions only
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
-- [20260803120000_fix_upsert_prediction_ambiguity] fonctions only
-- ---------------------------------------------------------------------------

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
#variable_conflict use_column
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
    SELECT 1
    FROM public.players AS pl
    WHERE pl.id = p_player_id
      AND pl.is_active = TRUE
  ) THEN
    RAISE EXCEPTION 'INVALID_PLAYER'
      USING ERRCODE = '22023',
            DETAIL = 'Joueur introuvable ou inactif.';
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
      p_player_id,
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
#variable_conflict use_column
BEGIN
  PERFORM public.assert_access_code(p_access_code);

  IF p_player_id IS NULL THEN
    RAISE EXCEPTION 'INVALID_PLAYER'
      USING ERRCODE = '22023',
            DETAIL = 'Identifiant joueur manquant.';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM public.players AS pl
    WHERE pl.id = p_player_id
      AND pl.is_active = TRUE
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
  FROM public.predictions AS pr
  WHERE pr.player_id = p_player_id
  ORDER BY pr.created_at ASC;
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
#variable_conflict use_column
BEGIN
  PERFORM public.assert_access_code(p_access_code);

  IF p_player_id IS NULL THEN
    RAISE EXCEPTION 'INVALID_PLAYER'
      USING ERRCODE = '22023',
            DETAIL = 'Identifiant joueur manquant.';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM public.players AS pl
    WHERE pl.id = p_player_id
      AND pl.is_active = TRUE
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
  FROM public.predictions AS pr
  INNER JOIN public.matches AS m ON m.id = pr.match_id
  WHERE pr.player_id = p_player_id
     OR m.kickoff_at <= now()
  ORDER BY pr.created_at ASC;
END;
$$;

-- ---------------------------------------------------------------------------
-- [20260803130000_admin_rpcs] fonctions only
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
-- [20260803140000_fixture_download_sync] fonctions only
-- ---------------------------------------------------------------------------

DROP FUNCTION IF EXISTS public.admin_create_match(TEXT, INTEGER, TEXT, TEXT, TIMESTAMPTZ, TEXT, INTEGER, INTEGER, TEXT);

CREATE FUNCTION public.admin_create_match(
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

DROP FUNCTION IF EXISTS public.admin_update_match(TEXT, UUID, INTEGER, TEXT, TEXT, TIMESTAMPTZ, TEXT, INTEGER, INTEGER, TEXT);

CREATE FUNCTION public.admin_update_match(
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

DROP FUNCTION IF EXISTS public.admin_set_match_result(TEXT, UUID, INTEGER, INTEGER);

CREATE FUNCTION public.admin_set_match_result(
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
  p_admin_code TEXT,
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
  PERFORM public.assert_admin_code(p_admin_code);

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

CREATE OR REPLACE FUNCTION public.admin_get_fixture_sync_meta(p_admin_code TEXT)
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
  PERFORM public.assert_admin_code(p_admin_code);

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
  p_admin_code TEXT,
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
  PERFORM public.assert_admin_code(p_admin_code);

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

-- ---------------------------------------------------------------------------
-- [20260803150000_match_list_order] fonctions only
-- ---------------------------------------------------------------------------

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
  FROM public.matches AS m
  ORDER BY m.round_number ASC, m.kickoff_at ASC, m.id ASC;
END;
$$;

DROP FUNCTION IF EXISTS public.admin_get_matches(TEXT);

CREATE FUNCTION public.admin_get_matches(p_admin_code TEXT)
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

-- ---------------------------------------------------------------------------
-- [20260803160000_admin_update_access_code] fonctions only
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.admin_update_access_code(
  p_admin_code TEXT,
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
  PERFORM public.assert_admin_code(p_admin_code);

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

-- ---------------------------------------------------------------------------
-- Durcissement final des privilèges EXECUTE (30 fonctions)
-- Aligné sur 20260803165000_harden_function_execute_privileges.sql
-- ---------------------------------------------------------------------------

-- REVOKE PUBLIC + GRANT applicatifs

-- Helpers / internes : aucun EXECUTE pour PUBLIC / anon / authenticated
REVOKE ALL ON FUNCTION public.set_updated_at() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.set_updated_at() FROM anon, authenticated;
REVOKE ALL ON FUNCTION public.assert_access_code(TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.assert_access_code(TEXT) FROM anon, authenticated;
REVOKE ALL ON FUNCTION public.compute_prediction_points(INTEGER, INTEGER, INTEGER, INTEGER) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.compute_prediction_points(INTEGER, INTEGER, INTEGER, INTEGER) FROM anon, authenticated;
REVOKE ALL ON FUNCTION public.assert_admin_code(TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.assert_admin_code(TEXT) FROM anon, authenticated;
REVOKE ALL ON FUNCTION public.normalize_player_name(TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.normalize_player_name(TEXT) FROM anon, authenticated;
REVOKE ALL ON FUNCTION public.assert_nantes_fixture(TEXT, TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.assert_nantes_fixture(TEXT, TEXT) FROM anon, authenticated;
REVOKE ALL ON FUNCTION public.assert_match_scores(TEXT, INTEGER, INTEGER) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.assert_match_scores(TEXT, INTEGER, INTEGER) FROM anon, authenticated;
REVOKE ALL ON FUNCTION public.recalculate_points_for_match(UUID) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.recalculate_points_for_match(UUID) FROM anon, authenticated;

-- RPC applicatives : PUBLIC interdit ; anon + authenticated uniquement
REVOKE ALL ON FUNCTION public.verify_access_code(TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.verify_access_code(TEXT) TO anon, authenticated;
REVOKE ALL ON FUNCTION public.get_active_players(TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_active_players(TEXT) TO anon, authenticated;
REVOKE ALL ON FUNCTION public.get_matches(TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_matches(TEXT) TO anon, authenticated;
REVOKE ALL ON FUNCTION public.get_my_predictions(TEXT, UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_my_predictions(TEXT, UUID) TO anon, authenticated;
REVOKE ALL ON FUNCTION public.upsert_prediction(TEXT, UUID, UUID, INTEGER, INTEGER) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.upsert_prediction(TEXT, UUID, UUID, INTEGER, INTEGER) TO anon, authenticated;
REVOKE ALL ON FUNCTION public.get_visible_predictions(TEXT, UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_visible_predictions(TEXT, UUID) TO anon, authenticated;
REVOKE ALL ON FUNCTION public.get_ranking(TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_ranking(TEXT) TO anon, authenticated;
REVOKE ALL ON FUNCTION public.recalculate_match_points(TEXT, UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.recalculate_match_points(TEXT, UUID) TO anon, authenticated;
REVOKE ALL ON FUNCTION public.verify_admin_code(TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.verify_admin_code(TEXT) TO anon, authenticated;
REVOKE ALL ON FUNCTION public.admin_get_players(TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.admin_get_players(TEXT) TO anon, authenticated;
REVOKE ALL ON FUNCTION public.admin_create_player(TEXT, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.admin_create_player(TEXT, TEXT) TO anon, authenticated;
REVOKE ALL ON FUNCTION public.admin_update_player_name(TEXT, UUID, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.admin_update_player_name(TEXT, UUID, TEXT) TO anon, authenticated;
REVOKE ALL ON FUNCTION public.admin_set_player_active(TEXT, UUID, BOOLEAN) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.admin_set_player_active(TEXT, UUID, BOOLEAN) TO anon, authenticated;
REVOKE ALL ON FUNCTION public.admin_get_matches(TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.admin_get_matches(TEXT) TO anon, authenticated;
REVOKE ALL ON FUNCTION public.admin_create_match(TEXT, INTEGER, TEXT, TEXT, TIMESTAMPTZ, TEXT, INTEGER, INTEGER, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.admin_create_match(TEXT, INTEGER, TEXT, TEXT, TIMESTAMPTZ, TEXT, INTEGER, INTEGER, TEXT) TO anon, authenticated;
REVOKE ALL ON FUNCTION public.admin_update_match(TEXT, UUID, INTEGER, TEXT, TEXT, TIMESTAMPTZ, TEXT, INTEGER, INTEGER, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.admin_update_match(TEXT, UUID, INTEGER, TEXT, TEXT, TIMESTAMPTZ, TEXT, INTEGER, INTEGER, TEXT) TO anon, authenticated;
REVOKE ALL ON FUNCTION public.admin_set_match_result(TEXT, UUID, INTEGER, INTEGER) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.admin_set_match_result(TEXT, UUID, INTEGER, INTEGER) TO anon, authenticated;
REVOKE ALL ON FUNCTION public.admin_get_stats(TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.admin_get_stats(TEXT) TO anon, authenticated;
REVOKE ALL ON FUNCTION public.admin_clear_match_override(TEXT, UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.admin_clear_match_override(TEXT, UUID) TO anon, authenticated;
REVOKE ALL ON FUNCTION public.admin_get_fixture_sync_meta(TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.admin_get_fixture_sync_meta(TEXT) TO anon, authenticated;
REVOKE ALL ON FUNCTION public.admin_commit_fixture_sync(TEXT, JSONB) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.admin_commit_fixture_sync(TEXT, JSONB) TO anon, authenticated;
REVOKE ALL ON FUNCTION public.admin_update_access_code(TEXT, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.admin_update_access_code(TEXT, TEXT) TO anon, authenticated;

COMMIT;
