-- Correction : ambiguïté player_id / match_id dans upsert_prediction
-- Cause : RETURNS TABLE expose des variables PL/pgSQL du même nom que les colonnes,
-- ce qui rend ON CONFLICT (player_id, match_id) et RETURNING ambigus.
-- Aucune table ni donnée n’est supprimée.

-- ---------------------------------------------------------------------------
-- S’assurer d’une contrainte unique nommée pour ON CONFLICT ON CONSTRAINT
-- ---------------------------------------------------------------------------

DO $$
DECLARE
  existing_name text;
BEGIN
  SELECT c.conname
  INTO existing_name
  FROM pg_constraint AS c
  INNER JOIN pg_class AS t ON t.oid = c.conrelid
  INNER JOIN pg_namespace AS n ON n.oid = t.relnamespace
  WHERE n.nspname = 'public'
    AND t.relname = 'predictions'
    AND c.contype = 'u'
    AND pg_get_constraintdef(c.oid) ILIKE '%(player_id, match_id)%'
  LIMIT 1;

  IF existing_name IS NULL THEN
    ALTER TABLE public.predictions
      ADD CONSTRAINT predictions_player_match_unique UNIQUE (player_id, match_id);
  ELSIF existing_name <> 'predictions_player_match_unique' THEN
    EXECUTE format(
      'ALTER TABLE public.predictions RENAME CONSTRAINT %I TO predictions_player_match_unique',
      existing_name
    );
  END IF;
END;
$$;

-- ---------------------------------------------------------------------------
-- Recréer upsert_prediction (même signature / même nom RPC)
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

-- Droits d’exécution (reprise défensive, idempotente)
GRANT EXECUTE ON FUNCTION public.upsert_prediction(TEXT, UUID, UUID, INTEGER, INTEGER)
  TO anon, authenticated;

-- ---------------------------------------------------------------------------
-- Audit / durcissement léger des autres RPC RETURNS TABLE concernées
-- (mêmes noms OUT que des colonnes : forcer use_column + alias)
-- ---------------------------------------------------------------------------

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

GRANT EXECUTE ON FUNCTION public.get_my_predictions(TEXT, UUID) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_visible_predictions(TEXT, UUID) TO anon, authenticated;
