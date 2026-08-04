-- Saison explicite + révélation collective + trophées / séries

CREATE TABLE IF NOT EXISTS public.seasons (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  slug TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  starts_at TIMESTAMPTZ,
  ends_at TIMESTAMPTZ,
  is_active BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.seasons ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.seasons FROM PUBLIC;
REVOKE ALL ON TABLE public.seasons FROM anon, authenticated;

DROP TRIGGER IF EXISTS seasons_set_updated_at ON public.seasons;
CREATE TRIGGER seasons_set_updated_at
BEFORE UPDATE ON public.seasons
FOR EACH ROW
EXECUTE FUNCTION public.set_updated_at();

ALTER TABLE public.matches
  ADD COLUMN IF NOT EXISTS season_id UUID;

DO $$
DECLARE
  v_season_id UUID;
  v_min_kickoff TIMESTAMPTZ;
  v_max_kickoff TIMESTAMPTZ;
  v_start_year INTEGER;
  v_end_year INTEGER;
  v_slug TEXT;
  v_name TEXT;
BEGIN
  SELECT min(m.kickoff_at), max(m.kickoff_at)
  INTO v_min_kickoff, v_max_kickoff
  FROM public.matches AS m;

  IF v_min_kickoff IS NULL THEN
    v_start_year := EXTRACT(YEAR FROM now())::INTEGER;
    v_end_year := v_start_year + 1;
  ELSE
    v_start_year := EXTRACT(YEAR FROM timezone('Europe/Paris', v_min_kickoff))::INTEGER;
    v_end_year := EXTRACT(YEAR FROM timezone('Europe/Paris', COALESCE(v_max_kickoff, v_min_kickoff)))::INTEGER;
    IF v_end_year < v_start_year THEN
      v_end_year := v_start_year;
    END IF;
  END IF;

  v_slug := format('season-%s-%s', v_start_year, v_end_year);
  v_name := format('Saison %s/%s', v_start_year, right(v_end_year::text, 2));

  INSERT INTO public.seasons (slug, name, starts_at, ends_at, is_active)
  VALUES (v_slug, v_name, v_min_kickoff, v_max_kickoff, TRUE)
  ON CONFLICT (slug) DO UPDATE
  SET
    name = EXCLUDED.name,
    starts_at = COALESCE(public.seasons.starts_at, EXCLUDED.starts_at),
    ends_at = COALESCE(public.seasons.ends_at, EXCLUDED.ends_at),
    is_active = TRUE,
    updated_at = now()
  RETURNING id INTO v_season_id;

  UPDATE public.seasons
  SET is_active = (id = v_season_id)
  WHERE is_active IS DISTINCT FROM (id = v_season_id);

  UPDATE public.matches AS m
  SET season_id = v_season_id
  WHERE m.season_id IS NULL;
END;
$$;

ALTER TABLE public.matches
  ALTER COLUMN season_id SET NOT NULL;

ALTER TABLE public.matches
  DROP CONSTRAINT IF EXISTS matches_season_id_fkey;

ALTER TABLE public.matches
  ADD CONSTRAINT matches_season_id_fkey
  FOREIGN KEY (season_id) REFERENCES public.seasons (id) ON DELETE RESTRICT;

CREATE INDEX IF NOT EXISTS matches_season_id_idx
  ON public.matches (season_id, kickoff_at, id);

CREATE UNIQUE INDEX IF NOT EXISTS seasons_single_active_idx
  ON public.seasons ((is_active))
  WHERE is_active = TRUE;

CREATE TABLE IF NOT EXISTS public.trophy_definitions (
  key TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  description TEXT NOT NULL,
  icon TEXT NOT NULL,
  is_repeatable BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.trophy_definitions ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.trophy_definitions FROM PUBLIC;
REVOKE ALL ON TABLE public.trophy_definitions FROM anon, authenticated;

DROP TRIGGER IF EXISTS trophy_definitions_set_updated_at ON public.trophy_definitions;
CREATE TRIGGER trophy_definitions_set_updated_at
BEFORE UPDATE ON public.trophy_definitions
FOR EACH ROW
EXECUTE FUNCTION public.set_updated_at();

INSERT INTO public.trophy_definitions (key, name, description, icon, is_repeatable)
VALUES
  ('first_participation', 'Première participation', 'Premier pronostic valide enregistré sur la saison.', 'sparkles', FALSE),
  ('first_exact_score', 'Score exact', 'Premier score exact trouvé sur la saison.', 'target', FALSE),
  ('double_precision', 'Double précision', 'Deux scores exacts consécutifs parmi les matchs pronostiqués.', 'medal', FALSE),
  ('bien_vu', 'Bien vu', 'Trois bonnes issues consécutives parmi les matchs pronostiqués.', 'eye', FALSE),
  ('fidele_au_poste', 'Fidèle au poste', 'Cinq matchs éligibles consécutifs pronostiqués sans absence.', 'calendar-check', FALSE),
  ('serie_en_or', 'Série en or', 'Dix matchs éligibles consécutifs pronostiqués sans absence.', 'crown', FALSE),
  ('champion_de_la_journee', 'Champion de la journée', 'Meilleur total de points sur une journée terminée.', 'trophy', TRUE),
  ('seul_contre_tous', 'Seul contre tous', 'Seul joueur sur une issue différente du groupe, et issue correcte.', 'shield', TRUE)
ON CONFLICT (key) DO UPDATE
SET
  name = EXCLUDED.name,
  description = EXCLUDED.description,
  icon = EXCLUDED.icon,
  is_repeatable = EXCLUDED.is_repeatable,
  updated_at = now();

CREATE TABLE IF NOT EXISTS public.player_trophies (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  award_key TEXT NOT NULL UNIQUE,
  player_id UUID NOT NULL REFERENCES public.players (id) ON DELETE CASCADE,
  season_id UUID NOT NULL REFERENCES public.seasons (id) ON DELETE CASCADE,
  trophy_key TEXT NOT NULL REFERENCES public.trophy_definitions (key) ON DELETE RESTRICT,
  source_match_id UUID REFERENCES public.matches (id) ON DELETE SET NULL,
  source_round_number INTEGER,
  awarded_at TIMESTAMPTZ NOT NULL,
  rule_version INTEGER NOT NULL DEFAULT 1,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  invalidated_at TIMESTAMPTZ,
  invalidation_reason TEXT,
  presented_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.player_trophies ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.player_trophies FROM PUBLIC;
REVOKE ALL ON TABLE public.player_trophies FROM anon, authenticated;

DROP TRIGGER IF EXISTS player_trophies_set_updated_at ON public.player_trophies;
CREATE TRIGGER player_trophies_set_updated_at
BEFORE UPDATE ON public.player_trophies
FOR EACH ROW
EXECUTE FUNCTION public.set_updated_at();

CREATE INDEX IF NOT EXISTS player_trophies_player_season_idx
  ON public.player_trophies (player_id, season_id, awarded_at, id);

CREATE INDEX IF NOT EXISTS player_trophies_active_idx
  ON public.player_trophies (season_id, is_active, presented_at);

CREATE TABLE IF NOT EXISTS public.player_season_stats (
  player_id UUID NOT NULL REFERENCES public.players (id) ON DELETE CASCADE,
  season_id UUID NOT NULL REFERENCES public.seasons (id) ON DELETE CASCADE,
  current_prediction_streak INTEGER NOT NULL DEFAULT 0,
  best_prediction_streak INTEGER NOT NULL DEFAULT 0,
  current_good_result_streak INTEGER NOT NULL DEFAULT 0,
  best_good_result_streak INTEGER NOT NULL DEFAULT 0,
  current_exact_streak INTEGER NOT NULL DEFAULT 0,
  best_exact_streak INTEGER NOT NULL DEFAULT 0,
  total_exact_scores INTEGER NOT NULL DEFAULT 0,
  trophies_count INTEGER NOT NULL DEFAULT 0,
  recalculated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (player_id, season_id)
);

ALTER TABLE public.player_season_stats ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.player_season_stats FROM PUBLIC;
REVOKE ALL ON TABLE public.player_season_stats FROM anon, authenticated;

DROP TRIGGER IF EXISTS player_season_stats_set_updated_at ON public.player_season_stats;
CREATE TRIGGER player_season_stats_set_updated_at
BEFORE UPDATE ON public.player_season_stats
FOR EACH ROW
EXECUTE FUNCTION public.set_updated_at();

CREATE OR REPLACE FUNCTION public.get_active_season_id()
RETURNS UUID
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_season_id UUID;
BEGIN
  SELECT s.id
  INTO v_season_id
  FROM public.seasons AS s
  WHERE s.is_active = TRUE
  ORDER BY s.created_at DESC, s.id DESC
  LIMIT 1;

  IF v_season_id IS NULL THEN
    RAISE EXCEPTION 'SEASON_NOT_FOUND'
      USING ERRCODE = 'P0002',
            DETAIL = 'Aucune saison active.';
  END IF;

  RETURN v_season_id;
END;
$$;

REVOKE ALL ON FUNCTION public.get_active_season_id() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.get_active_season_id() FROM anon, authenticated;

CREATE OR REPLACE FUNCTION public.assert_season_exists(p_season_id UUID)
RETURNS UUID
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF p_season_id IS NULL THEN
    RAISE EXCEPTION 'SEASON_NOT_FOUND'
      USING ERRCODE = '22023',
            DETAIL = 'Saison manquante.';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM public.seasons AS s
    WHERE s.id = p_season_id
  ) THEN
    RAISE EXCEPTION 'SEASON_NOT_FOUND'
      USING ERRCODE = 'P0002',
            DETAIL = 'Saison introuvable.';
  END IF;

  RETURN p_season_id;
END;
$$;

REVOKE ALL ON FUNCTION public.assert_season_exists(UUID) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.assert_season_exists(UUID) FROM anon, authenticated;

ALTER TABLE public.matches
  ALTER COLUMN season_id SET DEFAULT public.get_active_season_id();

CREATE OR REPLACE FUNCTION public.get_active_season(p_session_token TEXT)
RETURNS TABLE (
  id UUID,
  slug TEXT,
  name TEXT,
  starts_at TIMESTAMPTZ,
  ends_at TIMESTAMPTZ,
  is_active BOOLEAN
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  v_season_id UUID;
BEGIN
  PERFORM public.assert_player_session(p_session_token);
  v_season_id := public.get_active_season_id();

  RETURN QUERY
  SELECT
    s.id,
    s.slug,
    s.name,
    s.starts_at,
    s.ends_at,
    s.is_active
  FROM public.seasons AS s
  WHERE s.id = v_season_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.get_matches_for_season(
  p_session_token TEXT,
  p_season_id UUID
)
RETURNS TABLE (
  id UUID,
  season_id UUID,
  external_id TEXT,
  round_number INTEGER,
  home_team TEXT,
  away_team TEXT,
  kickoff_at TIMESTAMPTZ,
  kickoff_time_confirmed BOOLEAN,
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
  PERFORM public.assert_season_exists(p_season_id);

  RETURN QUERY
  SELECT
    m.id,
    m.season_id,
    m.external_id,
    m.round_number,
    m.home_team,
    m.away_team,
    m.kickoff_at,
    m.kickoff_time_confirmed,
    m.status,
    m.home_score,
    m.away_score,
    m.created_at,
    m.updated_at
  FROM public.matches AS m
  WHERE m.season_id = p_season_id
  ORDER BY m.kickoff_at ASC, m.round_number ASC, m.home_team ASC, m.away_team ASC, m.id ASC;
END;
$$;

CREATE OR REPLACE FUNCTION public.get_matches(p_session_token TEXT)
RETURNS TABLE (
  id UUID,
  external_id TEXT,
  round_number INTEGER,
  home_team TEXT,
  away_team TEXT,
  kickoff_at TIMESTAMPTZ,
  kickoff_time_confirmed BOOLEAN,
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
DECLARE
  v_season_id UUID;
BEGIN
  PERFORM public.assert_player_session(p_session_token);
  v_season_id := public.get_active_season_id();

  RETURN QUERY
  SELECT
    m.id,
    m.external_id,
    m.round_number,
    m.home_team,
    m.away_team,
    m.kickoff_at,
    m.kickoff_time_confirmed,
    m.status,
    m.home_score,
    m.away_score,
    m.created_at,
    m.updated_at
  FROM public.matches AS m
  WHERE m.season_id = v_season_id
  ORDER BY m.kickoff_at ASC, m.round_number ASC, m.home_team ASC, m.away_team ASC, m.id ASC;
END;
$$;

CREATE OR REPLACE FUNCTION public.get_season_ranking(
  p_session_token TEXT,
  p_season_id UUID
)
RETURNS TABLE (
  id UUID,
  display_name TEXT,
  is_active BOOLEAN,
  points BIGINT,
  exact_scores BIGINT,
  good_results BIGINT,
  scored_predictions BIGINT,
  success_rate NUMERIC,
  gap_to_leader BIGINT
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
BEGIN
  PERFORM public.assert_player_session(p_session_token);
  PERFORM public.assert_season_exists(p_season_id);

  RETURN QUERY
  WITH season_matches AS (
    SELECT m.id
    FROM public.matches AS m
    WHERE m.season_id = p_season_id
  ),
  aggregates AS (
    SELECT
      p.id,
      p.display_name,
      p.is_active,
      COALESCE(SUM(pr.points) FILTER (WHERE sm.id IS NOT NULL), 0)::BIGINT AS points,
      COALESCE(COUNT(*) FILTER (WHERE sm.id IS NOT NULL AND pr.points = 3), 0)::BIGINT AS exact_scores,
      COALESCE(COUNT(*) FILTER (WHERE sm.id IS NOT NULL AND pr.points = 1), 0)::BIGINT AS good_results,
      COALESCE(COUNT(pr.points) FILTER (WHERE sm.id IS NOT NULL), 0)::BIGINT AS scored_predictions
    FROM public.players AS p
    LEFT JOIN public.predictions AS pr
      ON pr.player_id = p.id
    LEFT JOIN season_matches AS sm
      ON sm.id = pr.match_id
    WHERE sm.id IS NOT NULL
       OR p.is_active = TRUE
       OR EXISTS (
         SELECT 1
         FROM public.predictions AS pr2
         INNER JOIN public.matches AS m2 ON m2.id = pr2.match_id
         WHERE pr2.player_id = p.id
           AND m2.season_id = p_season_id
           AND pr2.points IS NOT NULL
           AND pr2.points > 0
       )
    GROUP BY p.id, p.display_name, p.is_active
  )
  SELECT
    a.id,
    a.display_name,
    a.is_active,
    a.points,
    a.exact_scores,
    a.good_results,
    a.scored_predictions,
    CASE
      WHEN a.scored_predictions = 0 THEN NULL
      ELSE ROUND(
        (100.0 * (a.exact_scores + a.good_results)::NUMERIC)
          / a.scored_predictions::NUMERIC,
        1
      )
    END AS success_rate,
    (SELECT MAX(b.points) FROM aggregates AS b) - a.points AS gap_to_leader
  FROM aggregates AS a
  ORDER BY a.points DESC, a.exact_scores DESC, a.display_name ASC;
END;
$$;

CREATE OR REPLACE FUNCTION public.get_ranking(p_session_token TEXT)
RETURNS TABLE (
  id UUID,
  display_name TEXT,
  is_active BOOLEAN,
  points BIGINT,
  exact_scores BIGINT,
  good_results BIGINT,
  scored_predictions BIGINT,
  success_rate NUMERIC,
  gap_to_leader BIGINT
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
BEGIN
  RETURN QUERY
  SELECT *
  FROM public.get_season_ranking(
    p_session_token,
    public.get_active_season_id()
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.get_season_round_participation(
  p_session_token TEXT,
  p_season_id UUID,
  p_round_number INTEGER
)
RETURNS TABLE (
  player_id UUID,
  display_name TEXT,
  round_number INTEGER,
  status TEXT,
  predicted_count BIGINT,
  expected_count BIGINT
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
BEGIN
  PERFORM public.assert_player_session(p_session_token);
  PERFORM public.assert_season_exists(p_season_id);

  IF p_round_number IS NULL OR p_round_number < 1 THEN
    RAISE EXCEPTION 'INVALID_ROUND'
      USING ERRCODE = '22023',
            DETAIL = 'Numéro de journée invalide.';
  END IF;

  RETURN QUERY
  WITH expected_matches AS (
    SELECT
      m.id,
      m.kickoff_at
    FROM public.matches AS m
    WHERE m.season_id = p_season_id
      AND m.round_number = p_round_number
      AND m.status NOT IN ('cancelled', 'postponed')
      AND m.kickoff_time_confirmed = TRUE
  ),
  active_players AS (
    SELECT
      p.id,
      p.display_name,
      p.created_at
    FROM public.players AS p
    WHERE p.is_active = TRUE
  ),
  player_expected AS (
    SELECT
      ap.id AS player_id,
      ap.display_name,
      em.id AS match_id
    FROM active_players AS ap
    INNER JOIN expected_matches AS em
      ON ap.created_at < em.kickoff_at
  ),
  counts AS (
    SELECT
      ap.id AS player_id,
      ap.display_name,
      (
        SELECT COUNT(*)::BIGINT
        FROM player_expected AS pe
        WHERE pe.player_id = ap.id
      ) AS expected_count,
      (
        SELECT COUNT(*)::BIGINT
        FROM player_expected AS pe
        INNER JOIN public.predictions AS pr
          ON pr.player_id = pe.player_id
         AND pr.match_id = pe.match_id
        WHERE pe.player_id = ap.id
      ) AS predicted_count
    FROM active_players AS ap
  )
  SELECT
    c.player_id,
    c.display_name,
    p_round_number AS round_number,
    CASE
      WHEN c.expected_count = 0 THEN 'not_applicable'
      WHEN c.predicted_count = 0 THEN 'missing'
      WHEN c.predicted_count >= c.expected_count THEN 'complete'
      ELSE 'partial'
    END AS status,
    c.predicted_count,
    c.expected_count
  FROM counts AS c
  ORDER BY c.display_name ASC;
END;
$$;

CREATE OR REPLACE FUNCTION public.get_round_participation(
  p_session_token TEXT,
  p_round_number INTEGER
)
RETURNS TABLE (
  player_id UUID,
  display_name TEXT,
  round_number INTEGER,
  status TEXT,
  predicted_count BIGINT,
  expected_count BIGINT
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
BEGIN
  RETURN QUERY
  SELECT *
  FROM public.get_season_round_participation(
    p_session_token,
    public.get_active_season_id(),
    p_round_number
  );
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
  v_season_id UUID;
BEGIN
  v_player_id := public.assert_player_session(p_session_token);
  v_season_id := public.get_active_season_id();

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
  WHERE m.season_id = v_season_id
    AND (
      pr.player_id = v_player_id
      OR m.kickoff_at <= now()
    )
  ORDER BY pr.created_at ASC;
END;
$$;

CREATE OR REPLACE FUNCTION public.recalculate_season_achievements(p_season_id UUID)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  v_now TIMESTAMPTZ := now();
BEGIN
  PERFORM public.assert_season_exists(p_season_id);

  -- Recalcule les points du scope de saison sans modifier les règles existantes.
  UPDATE public.predictions AS pr
  SET
    points = CASE
      WHEN m.status = 'finished'
       AND m.home_score IS NOT NULL
       AND m.away_score IS NOT NULL
      THEN public.compute_prediction_points(
        pr.predicted_home_score,
        pr.predicted_away_score,
        m.home_score,
        m.away_score
      )
      ELSE NULL
    END,
    updated_at = CASE
      WHEN pr.points IS DISTINCT FROM CASE
        WHEN m.status = 'finished'
         AND m.home_score IS NOT NULL
         AND m.away_score IS NOT NULL
        THEN public.compute_prediction_points(
          pr.predicted_home_score,
          pr.predicted_away_score,
          m.home_score,
          m.away_score
        )
        ELSE NULL
      END THEN now()
      ELSE pr.updated_at
    END
  FROM public.matches AS m
  WHERE m.id = pr.match_id
    AND m.season_id = p_season_id;

  DELETE FROM public.player_season_stats AS pss
  WHERE pss.season_id = p_season_id;

  WITH participation_matches AS (
    SELECT
      m.id,
      m.round_number,
      m.kickoff_at,
      m.status
    FROM public.matches AS m
    WHERE m.season_id = p_season_id
      AND m.status <> 'cancelled'
      AND m.kickoff_at <= v_now
  ),
  player_pool AS (
    SELECT
      p.id AS player_id,
      p.created_at
    FROM public.players AS p
  ),
  participation_status AS (
    SELECT
      pp.player_id,
      pm.id AS match_id,
      pm.round_number,
      pm.kickoff_at,
      pm.status,
      pr.id AS prediction_id,
      pr.points
    FROM player_pool AS pp
    INNER JOIN participation_matches AS pm
      ON pp.created_at < pm.kickoff_at
    LEFT JOIN public.predictions AS pr
      ON pr.player_id = pp.player_id
     AND pr.match_id = pm.id
  ),
  participation_rows AS (
    SELECT
      ps.player_id,
      ps.match_id,
      ps.round_number,
      ps.kickoff_at,
      (ps.prediction_id IS NOT NULL) AS has_prediction
    FROM participation_status AS ps
  ),
  participation_grouped AS (
    SELECT
      pr.*,
      SUM(CASE WHEN pr.has_prediction THEN 0 ELSE 1 END) OVER (
        PARTITION BY pr.player_id
        ORDER BY pr.kickoff_at, pr.match_id
      ) AS prediction_group
    FROM participation_rows AS pr
  ),
  participation_annotated AS (
    SELECT
      pg.player_id,
      pg.match_id,
      pg.round_number,
      pg.kickoff_at,
      pg.has_prediction,
      CASE
        WHEN pg.has_prediction
        THEN row_number() OVER (
          PARTITION BY pg.player_id, pg.prediction_group
          ORDER BY pg.kickoff_at, pg.match_id
        )
        ELSE 0
      END AS prediction_run,
      0 AS good_run,
      0 AS exact_run
    FROM participation_grouped AS pg
  ),
  scored_predictions AS (
    SELECT
      pr.player_id,
      pr.match_id,
      m.round_number,
      m.kickoff_at,
      pr.points,
      CASE WHEN pr.points IN (1, 3) THEN TRUE ELSE FALSE END AS good_result,
      CASE WHEN pr.points = 3 THEN TRUE ELSE FALSE END AS exact_score
    FROM public.predictions AS pr
    INNER JOIN public.matches AS m ON m.id = pr.match_id
    WHERE m.season_id = p_season_id
      AND m.status = 'finished'
      AND pr.points IS NOT NULL
  ),
  scored_grouped AS (
    SELECT
      sp.*,
      SUM(CASE WHEN sp.good_result THEN 0 ELSE 1 END) OVER (
        PARTITION BY sp.player_id
        ORDER BY sp.kickoff_at, sp.match_id
      ) AS good_group,
      SUM(CASE WHEN sp.exact_score THEN 0 ELSE 1 END) OVER (
        PARTITION BY sp.player_id
        ORDER BY sp.kickoff_at, sp.match_id
      ) AS exact_group
    FROM scored_predictions AS sp
  ),
  scored_annotated AS (
    SELECT
      sg.*,
      CASE
        WHEN sg.good_result
        THEN row_number() OVER (
          PARTITION BY sg.player_id, sg.good_group
          ORDER BY sg.kickoff_at, sg.match_id
        )
        ELSE 0
      END AS good_run,
      CASE
        WHEN sg.exact_score
        THEN row_number() OVER (
          PARTITION BY sg.player_id, sg.exact_group
          ORDER BY sg.kickoff_at, sg.match_id
        )
        ELSE 0
      END AS exact_run
    FROM scored_grouped AS sg
  ),
  current_rows AS (
    SELECT
      p.id AS player_id,
      COALESCE(pa.current_prediction_streak, 0) AS current_prediction_streak,
      COALESCE(sa.current_good_result_streak, 0) AS current_good_result_streak,
      COALESCE(sa.current_exact_streak, 0) AS current_exact_streak
    FROM public.players AS p
    LEFT JOIN (
      SELECT DISTINCT ON (a.player_id)
        a.player_id,
        a.prediction_run AS current_prediction_streak
      FROM participation_annotated AS a
      ORDER BY a.player_id, a.kickoff_at DESC, a.match_id DESC
    ) AS pa
      ON pa.player_id = p.id
    LEFT JOIN (
      SELECT DISTINCT ON (a.player_id)
        a.player_id,
        a.good_run AS current_good_result_streak,
        a.exact_run AS current_exact_streak
      FROM scored_annotated AS a
      ORDER BY a.player_id, a.kickoff_at DESC, a.match_id DESC
    ) AS sa
      ON sa.player_id = p.id
  ),
  best_rows AS (
    SELECT
      p.id AS player_id,
      COALESCE(pa.best_prediction_streak, 0) AS best_prediction_streak,
      COALESCE(sa.best_good_result_streak, 0) AS best_good_result_streak,
      COALESCE(sa.best_exact_streak, 0) AS best_exact_streak,
      COALESCE(sa.total_exact_scores, 0) AS total_exact_scores
    FROM public.players AS p
    LEFT JOIN (
      SELECT
        a.player_id,
        MAX(a.prediction_run) AS best_prediction_streak
      FROM participation_annotated AS a
      GROUP BY a.player_id
    ) AS pa
      ON pa.player_id = p.id
    LEFT JOIN (
      SELECT
        a.player_id,
        MAX(a.good_run) AS best_good_result_streak,
        MAX(a.exact_run) AS best_exact_streak,
        COUNT(*) FILTER (WHERE a.exact_score) AS total_exact_scores
      FROM scored_annotated AS a
      GROUP BY a.player_id
    ) AS sa
      ON sa.player_id = p.id
  ),
  trophy_counts AS (
    SELECT
      pt.player_id,
      COUNT(*)::INTEGER AS trophies_count
    FROM public.player_trophies AS pt
    WHERE pt.season_id = p_season_id
      AND pt.is_active = TRUE
    GROUP BY pt.player_id
  )
  INSERT INTO public.player_season_stats (
    player_id,
    season_id,
    current_prediction_streak,
    best_prediction_streak,
    current_good_result_streak,
    best_good_result_streak,
    current_exact_streak,
    best_exact_streak,
    total_exact_scores,
    trophies_count,
    recalculated_at
  )
  SELECT
    p.id AS player_id,
    p_season_id,
    COALESCE(cr.current_prediction_streak, 0),
    COALESCE(br.best_prediction_streak, 0),
    COALESCE(cr.current_good_result_streak, 0),
    COALESCE(br.best_good_result_streak, 0),
    COALESCE(cr.current_exact_streak, 0),
    COALESCE(br.best_exact_streak, 0),
    COALESCE(br.total_exact_scores, 0),
    COALESCE(tc.trophies_count, 0),
    v_now
  FROM public.players AS p
  LEFT JOIN current_rows AS cr
    ON cr.player_id = p.id
  LEFT JOIN best_rows AS br
    ON br.player_id = p.id
  LEFT JOIN trophy_counts AS tc
    ON tc.player_id = p.id;

  DROP TABLE IF EXISTS tmp_desired_trophies;

  CREATE TEMP TABLE tmp_desired_trophies (
    award_key TEXT PRIMARY KEY,
    player_id UUID NOT NULL,
    season_id UUID NOT NULL,
    trophy_key TEXT NOT NULL,
    source_match_id UUID,
    source_round_number INTEGER,
    awarded_at TIMESTAMPTZ NOT NULL,
    rule_version INTEGER NOT NULL
  ) ON COMMIT DROP;

  INSERT INTO tmp_desired_trophies (
    award_key,
    player_id,
    season_id,
    trophy_key,
    source_match_id,
    source_round_number,
    awarded_at,
    rule_version
  )
  WITH all_predictions AS (
    SELECT
      pr.player_id,
      pr.match_id,
      m.round_number,
      m.kickoff_at,
      pr.created_at
    FROM public.predictions AS pr
    INNER JOIN public.matches AS m ON m.id = pr.match_id
    WHERE m.season_id = p_season_id
  ),
  first_participation AS (
    SELECT DISTINCT ON (ap.player_id)
      format('season:%s:player:%s:first_participation', p_season_id, ap.player_id) AS award_key,
      ap.player_id,
      ap.match_id,
      ap.round_number,
      ap.kickoff_at AS awarded_at
    FROM all_predictions AS ap
    ORDER BY ap.player_id, ap.kickoff_at, ap.match_id
  ),
  season_predictions AS (
    SELECT
      pr.player_id,
      pr.match_id,
      m.round_number,
      m.kickoff_at,
      m.status,
      pr.points,
      pr.created_at
    FROM public.predictions AS pr
    INNER JOIN public.matches AS m ON m.id = pr.match_id
    WHERE m.season_id = p_season_id
      AND m.status = 'finished'
      AND pr.points IS NOT NULL
  ),
  ordered_predictions AS (
    SELECT
      sg.*,
      CASE
        WHEN sg.points = 3
        THEN row_number() OVER (
          PARTITION BY sg.player_id, sg.exact_group
          ORDER BY sg.kickoff_at, sg.match_id
        )
        ELSE 0
      END AS exact_run,
      CASE
        WHEN sg.points IN (1, 3)
        THEN row_number() OVER (
          PARTITION BY sg.player_id, sg.good_group
          ORDER BY sg.kickoff_at, sg.match_id
        )
        ELSE 0
      END AS good_run
    FROM (
      SELECT
        sp.*,
        SUM(CASE WHEN sp.points IN (1, 3) THEN 0 ELSE 1 END) OVER (
          PARTITION BY sp.player_id
          ORDER BY sp.kickoff_at, sp.match_id
        ) AS good_group,
        SUM(CASE WHEN sp.points = 3 THEN 0 ELSE 1 END) OVER (
          PARTITION BY sp.player_id
          ORDER BY sp.kickoff_at, sp.match_id
        ) AS exact_group
      FROM season_predictions AS sp
    ) AS sg
  ),
  first_exact AS (
    SELECT DISTINCT ON (op.player_id)
      format('season:%s:player:%s:first_exact_score', p_season_id, op.player_id) AS award_key,
      op.player_id,
      op.match_id,
      op.round_number,
      op.kickoff_at AS awarded_at
    FROM ordered_predictions AS op
    WHERE op.points = 3
    ORDER BY op.player_id, op.kickoff_at, op.match_id
  ),
  double_precision AS (
    SELECT DISTINCT ON (op.player_id)
      format('season:%s:player:%s:double_precision', p_season_id, op.player_id) AS award_key,
      op.player_id,
      op.match_id,
      op.round_number,
      op.kickoff_at AS awarded_at
    FROM ordered_predictions AS op
    WHERE op.exact_run >= 2
    ORDER BY op.player_id, op.kickoff_at, op.match_id
  ),
  bien_vu AS (
    SELECT DISTINCT ON (op.player_id)
      format('season:%s:player:%s:bien_vu', p_season_id, op.player_id) AS award_key,
      op.player_id,
      op.match_id,
      op.round_number,
      op.kickoff_at AS awarded_at
    FROM ordered_predictions AS op
    WHERE op.good_run >= 3
    ORDER BY op.player_id, op.kickoff_at, op.match_id
  ),
  eligible_matches AS (
    SELECT
      p.id AS player_id,
      m.id AS match_id,
      m.round_number,
      m.kickoff_at,
      pr.id AS prediction_id
    FROM public.players AS p
    INNER JOIN public.matches AS m
      ON m.season_id = p_season_id
     AND m.status <> 'cancelled'
     AND m.kickoff_at <= v_now
     AND p.created_at < m.kickoff_at
    LEFT JOIN public.predictions AS pr
      ON pr.player_id = p.id
     AND pr.match_id = m.id
  ),
  participation_runs AS (
    SELECT
      eg.player_id,
      eg.match_id,
      eg.round_number,
      eg.kickoff_at,
      (eg.prediction_id IS NOT NULL) AS has_prediction,
      CASE
        WHEN eg.prediction_id IS NOT NULL
        THEN row_number() OVER (
          PARTITION BY eg.player_id, eg.prediction_group
          ORDER BY eg.kickoff_at, eg.match_id
        )
        ELSE 0
      END AS prediction_run
    FROM (
      SELECT
        em.*,
        SUM(CASE WHEN em.prediction_id IS NOT NULL THEN 0 ELSE 1 END) OVER (
          PARTITION BY em.player_id
          ORDER BY em.kickoff_at, em.match_id
        ) AS prediction_group
      FROM eligible_matches AS em
    ) AS eg
  ),
  fidele AS (
    SELECT DISTINCT ON (pr.player_id)
      format('season:%s:player:%s:fidele_au_poste', p_season_id, pr.player_id) AS award_key,
      pr.player_id,
      pr.match_id,
      pr.round_number,
      pr.kickoff_at AS awarded_at
    FROM participation_runs AS pr
    WHERE pr.prediction_run >= 5
    ORDER BY pr.player_id, pr.kickoff_at, pr.match_id
  ),
  serie_or AS (
    SELECT DISTINCT ON (pr.player_id)
      format('season:%s:player:%s:serie_en_or', p_season_id, pr.player_id) AS award_key,
      pr.player_id,
      pr.match_id,
      pr.round_number,
      pr.kickoff_at AS awarded_at
    FROM participation_runs AS pr
    WHERE pr.prediction_run >= 10
    ORDER BY pr.player_id, pr.kickoff_at, pr.match_id
  ),
  round_totals AS (
    SELECT
      pr.player_id,
      m.round_number,
      MAX(m.kickoff_at) AS awarded_at,
      SUM(pr.points)::INTEGER AS points_total
    FROM public.predictions AS pr
    INNER JOIN public.matches AS m ON m.id = pr.match_id
    WHERE m.season_id = p_season_id
      AND m.status = 'finished'
      AND pr.points IS NOT NULL
    GROUP BY pr.player_id, m.round_number
  ),
  completed_rounds AS (
    SELECT
      m.round_number,
      MAX(m.kickoff_at) AS awarded_at
    FROM public.matches AS m
    WHERE m.season_id = p_season_id
      AND m.status <> 'cancelled'
    GROUP BY m.round_number
    HAVING COUNT(*) FILTER (WHERE m.status NOT IN ('finished')) = 0
  ),
  round_winners AS (
    SELECT
      rt.player_id,
      rt.round_number,
      rt.awarded_at,
      rt.points_total,
      dense_rank() OVER (
        PARTITION BY rt.round_number
        ORDER BY rt.points_total DESC
      ) AS rank_in_round
    FROM round_totals AS rt
    INNER JOIN completed_rounds AS cr
      ON cr.round_number = rt.round_number
  ),
  champion AS (
    SELECT
      format(
        'season:%s:player:%s:champion_de_la_journee:round:%s',
        p_season_id,
        rw.player_id,
        rw.round_number
      ) AS award_key,
      rw.player_id,
      rw.round_number,
      rw.awarded_at
    FROM round_winners AS rw
    WHERE rw.rank_in_round = 1
  ),
  outcome_counts AS (
    SELECT
      m.id AS match_id,
      COALESCE(SUM(grouped.cnt), 0)::INTEGER AS participant_count,
      jsonb_object_agg(outcome_label, cnt ORDER BY outcome_label) AS outcome_counts
    FROM (
      SELECT
        pr.match_id,
        CASE
          WHEN pr.predicted_home_score > pr.predicted_away_score THEN 'home'
          WHEN pr.predicted_home_score = pr.predicted_away_score THEN 'draw'
          ELSE 'away'
        END AS outcome_label,
        COUNT(*)::INTEGER AS cnt
      FROM public.predictions AS pr
      INNER JOIN public.matches AS m ON m.id = pr.match_id
      WHERE m.season_id = p_season_id
      GROUP BY pr.match_id, outcome_label
    ) AS grouped
    INNER JOIN public.matches AS m ON m.id = grouped.match_id
    GROUP BY m.id
  ),
  seul_contre_tous AS (
    SELECT
      format(
        'season:%s:player:%s:seul_contre_tous:match:%s',
        p_season_id,
        pr.player_id,
        pr.match_id
      ) AS award_key,
      pr.player_id,
      pr.match_id,
      m.round_number,
      m.kickoff_at AS awarded_at
    FROM public.predictions AS pr
    INNER JOIN public.matches AS m ON m.id = pr.match_id
    INNER JOIN outcome_counts AS oc ON oc.match_id = m.id
    CROSS JOIN LATERAL (
      SELECT CASE
        WHEN pr.predicted_home_score > pr.predicted_away_score THEN 'home'
        WHEN pr.predicted_home_score = pr.predicted_away_score THEN 'draw'
        ELSE 'away'
      END AS predicted_outcome
    ) AS my_outcome
    CROSS JOIN LATERAL (
      SELECT CASE
        WHEN m.home_score > m.away_score THEN 'home'
        WHEN m.home_score = m.away_score THEN 'draw'
        ELSE 'away'
      END AS actual_outcome
    ) AS match_outcome
    WHERE m.season_id = p_season_id
      AND m.status = 'finished'
      AND oc.participant_count >= 3
      AND my_outcome.predicted_outcome = match_outcome.actual_outcome
      AND COALESCE((oc.outcome_counts ->> my_outcome.predicted_outcome)::INTEGER, 0) = 1
  )
  SELECT
    fp.award_key,
    fp.player_id,
    p_season_id,
    'first_participation',
    fp.match_id,
    fp.round_number,
    fp.awarded_at,
    1
  FROM first_participation AS fp
  UNION ALL
  SELECT
    fe.award_key,
    fe.player_id,
    p_season_id,
    'first_exact_score',
    fe.match_id,
    fe.round_number,
    fe.awarded_at,
    1
  FROM first_exact AS fe
  UNION ALL
  SELECT
    dp.award_key,
    dp.player_id,
    p_season_id,
    'double_precision',
    dp.match_id,
    dp.round_number,
    dp.awarded_at,
    1
  FROM double_precision AS dp
  UNION ALL
  SELECT
    bv.award_key,
    bv.player_id,
    p_season_id,
    'bien_vu',
    bv.match_id,
    bv.round_number,
    bv.awarded_at,
    1
  FROM bien_vu AS bv
  UNION ALL
  SELECT
    fi.award_key,
    fi.player_id,
    p_season_id,
    'fidele_au_poste',
    fi.match_id,
    fi.round_number,
    fi.awarded_at,
    1
  FROM fidele AS fi
  UNION ALL
  SELECT
    so.award_key,
    so.player_id,
    p_season_id,
    'serie_en_or',
    so.match_id,
    so.round_number,
    so.awarded_at,
    1
  FROM serie_or AS so
  UNION ALL
  SELECT
    ch.award_key,
    ch.player_id,
    p_season_id,
    'champion_de_la_journee',
    NULL,
    ch.round_number,
    ch.awarded_at,
    1
  FROM champion AS ch
  UNION ALL
  SELECT
    sct.award_key,
    sct.player_id,
    p_season_id,
    'seul_contre_tous',
    sct.match_id,
    sct.round_number,
    sct.awarded_at,
    1
  FROM seul_contre_tous AS sct;

  INSERT INTO public.player_trophies (
    award_key,
    player_id,
    season_id,
    trophy_key,
    source_match_id,
    source_round_number,
    awarded_at,
    rule_version,
    is_active,
    invalidated_at,
    invalidation_reason
  )
  SELECT
    d.award_key,
    d.player_id,
    d.season_id,
    d.trophy_key,
    d.source_match_id,
    d.source_round_number,
    d.awarded_at,
    d.rule_version,
    TRUE,
    NULL,
    NULL
  FROM tmp_desired_trophies AS d
  ON CONFLICT (award_key) DO UPDATE
  SET
    player_id = EXCLUDED.player_id,
    season_id = EXCLUDED.season_id,
    trophy_key = EXCLUDED.trophy_key,
    source_match_id = EXCLUDED.source_match_id,
    source_round_number = EXCLUDED.source_round_number,
    awarded_at = EXCLUDED.awarded_at,
    rule_version = EXCLUDED.rule_version,
    is_active = TRUE,
    invalidated_at = NULL,
    invalidation_reason = NULL,
    updated_at = now();

  UPDATE public.player_trophies AS pt
  SET
    is_active = FALSE,
    invalidated_at = v_now,
    invalidation_reason = 'SEASON_RECALCULATED',
    updated_at = now()
  WHERE pt.season_id = p_season_id
    AND pt.is_active = TRUE
    AND NOT EXISTS (
      SELECT 1
      FROM tmp_desired_trophies AS d
      WHERE d.award_key = pt.award_key
    );

  UPDATE public.player_season_stats AS pss
  SET
    trophies_count = COALESCE(active_counts.cnt, 0),
    recalculated_at = v_now,
    updated_at = now()
  FROM (
    SELECT
      pt.player_id,
      COUNT(*)::INTEGER AS cnt
    FROM public.player_trophies AS pt
    WHERE pt.season_id = p_season_id
      AND pt.is_active = TRUE
    GROUP BY pt.player_id
  ) AS active_counts
  WHERE pss.season_id = p_season_id
    AND pss.player_id = active_counts.player_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.recalculate_points_for_match(p_match_id UUID)
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  match_row public.matches%ROWTYPE;
  updated_count INTEGER := 0;
BEGIN
  IF p_match_id IS NULL THEN
    RAISE EXCEPTION 'MATCH_NOT_FOUND'
      USING ERRCODE = 'P0002',
            DETAIL = 'Identifiant de match manquant.';
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

  IF match_row.status = 'finished'
     AND match_row.home_score IS NOT NULL
     AND match_row.away_score IS NOT NULL
  THEN
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
  ELSE
    UPDATE public.predictions AS pr
    SET
      points = NULL,
      updated_at = now()
    WHERE pr.match_id = p_match_id;
  END IF;

  GET DIAGNOSTICS updated_count = ROW_COUNT;

  PERFORM public.recalculate_season_achievements(match_row.season_id);
  RETURN updated_count;
END;
$$;

CREATE OR REPLACE FUNCTION public.get_match_group_reveal(
  p_session_token TEXT,
  p_season_id UUID,
  p_match_id UUID
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  v_player_id UUID;
  v_match public.matches%ROWTYPE;
  v_my_prediction public.predictions%ROWTYPE;
  v_revealed BOOLEAN;
  v_result_ready BOOLEAN;
  v_payload JSONB;
BEGIN
  v_player_id := public.assert_player_session(p_session_token);
  PERFORM public.assert_season_exists(p_season_id);

  SELECT m.*
  INTO v_match
  FROM public.matches AS m
  WHERE m.id = p_match_id
    AND m.season_id = p_season_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'MATCH_NOT_FOUND'
      USING ERRCODE = 'P0002',
            DETAIL = 'Match introuvable.';
  END IF;

  SELECT pr.*
  INTO v_my_prediction
  FROM public.predictions AS pr
  WHERE pr.match_id = p_match_id
    AND pr.player_id = v_player_id;

  v_revealed := v_match.kickoff_time_confirmed = TRUE AND v_match.kickoff_at <= now();
  v_result_ready := v_match.status = 'finished'
    AND v_match.home_score IS NOT NULL
    AND v_match.away_score IS NOT NULL;

  IF NOT v_revealed THEN
    RETURN jsonb_build_object(
      'seasonId', p_season_id,
      'matchId', v_match.id,
      'revealed', FALSE,
      'lockedUntil', v_match.kickoff_at,
      'message', 'Les pronostics du groupe seront reveles au coup d’envoi.',
      'myPrediction',
      CASE
        WHEN v_my_prediction.id IS NULL THEN NULL
        ELSE jsonb_build_object(
          'homeScore', v_my_prediction.predicted_home_score,
          'awayScore', v_my_prediction.predicted_away_score,
          'points', v_my_prediction.points
        )
      END
    );
  END IF;

  WITH eligible_players AS (
    SELECT
      p.id,
      p.display_name
    FROM public.players AS p
    WHERE p.created_at < v_match.kickoff_at
  ),
  participant_predictions AS (
    SELECT
      pr.player_id,
      ep.display_name,
      pr.predicted_home_score,
      pr.predicted_away_score,
      pr.points,
      CASE
        WHEN pr.predicted_home_score > pr.predicted_away_score THEN 'Victoire'
        WHEN pr.predicted_home_score = pr.predicted_away_score THEN 'Nul'
        ELSE 'Défaite'
      END AS outcome_label
    FROM public.predictions AS pr
    INNER JOIN eligible_players AS ep
      ON ep.id = pr.player_id
    WHERE pr.match_id = p_match_id
  ),
  outcome_totals AS (
    SELECT
      COUNT(*)::INTEGER AS participant_count,
      COUNT(*) FILTER (WHERE outcome_label = 'Victoire')::INTEGER AS home_count,
      COUNT(*) FILTER (WHERE outcome_label = 'Nul')::INTEGER AS draw_count,
      COUNT(*) FILTER (WHERE outcome_label = 'Défaite')::INTEGER AS away_count
    FROM participant_predictions
  ),
  score_frequency AS (
    SELECT
      format('%s-%s', pp.predicted_home_score, pp.predicted_away_score) AS score_key,
      COUNT(*)::INTEGER AS cnt
    FROM participant_predictions AS pp
    GROUP BY score_key
  ),
  unique_scores AS (
    SELECT jsonb_agg(score_key ORDER BY score_key) AS unique_scores
    FROM score_frequency
    WHERE cnt = 1
  ),
  popular_scores AS (
    SELECT jsonb_agg(score_key ORDER BY score_key) AS most_played_scores
    FROM score_frequency
    WHERE cnt = (SELECT MAX(cnt) FROM score_frequency)
  ),
  best_points AS (
    SELECT MAX(pp.points) AS max_points
    FROM participant_predictions AS pp
  ),
  participant_rows AS (
    SELECT jsonb_agg(
      jsonb_build_object(
        'playerId', pp.player_id,
        'pseudo', pp.display_name,
        'homeScore', pp.predicted_home_score,
        'awayScore', pp.predicted_away_score,
        'outcome', pp.outcome_label,
        'points', CASE WHEN v_result_ready THEN pp.points ELSE NULL END,
        'exactScore', CASE WHEN v_result_ready THEN pp.points = 3 ELSE FALSE END,
        'bestPrediction', CASE
          WHEN v_result_ready THEN pp.points = COALESCE((SELECT max_points FROM best_points), -1)
          ELSE FALSE
        END
      )
      ORDER BY pp.display_name ASC, pp.player_id ASC
    ) AS rows
    FROM participant_predictions AS pp
  ),
  performance_rows AS (
    SELECT jsonb_agg(
      jsonb_build_object(
        'playerId', ranked.player_id,
        'pseudo', ranked.display_name,
        'points', ranked.points,
        'rank', ranked.rank_in_match
      )
      ORDER BY ranked.rank_in_match ASC, ranked.display_name ASC, ranked.player_id ASC
    ) AS rows
    FROM (
      SELECT
        pp.player_id,
        pp.display_name,
        pp.points,
        dense_rank() OVER (ORDER BY pp.points DESC, pp.display_name ASC) AS rank_in_match
      FROM participant_predictions AS pp
      WHERE v_result_ready
    ) AS ranked
  ),
  unlocked_trophies AS (
    SELECT
      pt.source_match_id,
      jsonb_agg(
        jsonb_build_object(
          'playerId', pt.player_id,
          'pseudo', p.display_name,
          'trophyKey', pt.trophy_key,
          'name', td.name
        )
        ORDER BY p.display_name ASC, pt.trophy_key ASC
      ) AS rows
    FROM public.player_trophies AS pt
    INNER JOIN public.players AS p ON p.id = pt.player_id
    INNER JOIN public.trophy_definitions AS td ON td.key = pt.trophy_key
    WHERE pt.season_id = p_season_id
      AND pt.is_active = TRUE
      AND pt.source_match_id = p_match_id
    GROUP BY pt.source_match_id
  )
  SELECT jsonb_build_object(
    'seasonId', p_season_id,
    'matchId', v_match.id,
    'revealed', TRUE,
    'lockedUntil', v_match.kickoff_at,
    'resultReady', v_result_ready,
    'myPrediction',
    CASE
      WHEN v_my_prediction.id IS NULL THEN NULL
      ELSE jsonb_build_object(
        'homeScore', v_my_prediction.predicted_home_score,
        'awayScore', v_my_prediction.predicted_away_score,
        'points', v_my_prediction.points
      )
    END,
    'participants', COALESCE((SELECT rows FROM participant_rows), '[]'::jsonb),
    'participantCount', COALESCE((SELECT participant_count FROM outcome_totals), 0),
    'nonParticipantCount',
      GREATEST(
        (SELECT COUNT(*)::INTEGER FROM eligible_players)
        - COALESCE((SELECT participant_count FROM outcome_totals), 0),
        0
      ),
    'percentages', jsonb_build_object(
      'victory',
      CASE
        WHEN COALESCE((SELECT participant_count FROM outcome_totals), 0) = 0 THEN 0
        ELSE ROUND(100.0 * COALESCE((SELECT home_count FROM outcome_totals), 0) / (SELECT participant_count FROM outcome_totals), 1)
      END,
      'draw',
      CASE
        WHEN COALESCE((SELECT participant_count FROM outcome_totals), 0) = 0 THEN 0
        ELSE ROUND(100.0 * COALESCE((SELECT draw_count FROM outcome_totals), 0) / (SELECT participant_count FROM outcome_totals), 1)
      END,
      'defeat',
      CASE
        WHEN COALESCE((SELECT participant_count FROM outcome_totals), 0) = 0 THEN 0
        ELSE ROUND(100.0 * COALESCE((SELECT away_count FROM outcome_totals), 0) / (SELECT participant_count FROM outcome_totals), 1)
      END
    ),
    'mostPlayedScores', COALESCE((SELECT most_played_scores FROM popular_scores), '[]'::jsonb),
    'uniqueScores', COALESCE((SELECT unique_scores FROM unique_scores), '[]'::jsonb),
    'bestPredictionPoints', CASE WHEN v_result_ready THEN (SELECT max_points FROM best_points) ELSE NULL END,
    'correctOutcomePlayers',
      CASE
        WHEN NOT v_result_ready THEN '[]'::jsonb
        ELSE COALESCE((
          SELECT jsonb_agg(pp.player_id ORDER BY pp.display_name ASC, pp.player_id ASC)
          FROM participant_predictions AS pp
          WHERE pp.points IN (1, 3)
        ), '[]'::jsonb)
      END,
    'performanceRanking', COALESCE((SELECT rows FROM performance_rows), '[]'::jsonb),
    'newTrophies', COALESCE((SELECT rows FROM unlocked_trophies), '[]'::jsonb)
  )
  INTO v_payload;

  RETURN v_payload;
END;
$$;

CREATE OR REPLACE FUNCTION public.get_player_trophy_overview(
  p_session_token TEXT,
  p_season_id UUID
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  v_player_id UUID;
BEGIN
  v_player_id := public.assert_player_session(p_session_token);
  PERFORM public.assert_season_exists(p_season_id);

  RETURN (
    WITH stats AS (
      SELECT *
      FROM public.player_season_stats AS pss
      WHERE pss.player_id = v_player_id
        AND pss.season_id = p_season_id
    ),
    earned AS (
      SELECT jsonb_agg(
        jsonb_build_object(
          'id', pt.id,
          'trophyKey', pt.trophy_key,
          'name', td.name,
          'description', td.description,
          'icon', td.icon,
          'awardedAt', pt.awarded_at,
          'sourceMatchId', pt.source_match_id,
          'sourceRoundNumber', pt.source_round_number,
          'presentedAt', pt.presented_at
        )
        ORDER BY pt.awarded_at DESC, pt.id DESC
      ) AS rows
      FROM public.player_trophies AS pt
      INNER JOIN public.trophy_definitions AS td ON td.key = pt.trophy_key
      WHERE pt.player_id = v_player_id
        AND pt.season_id = p_season_id
        AND pt.is_active = TRUE
    ),
    locked AS (
      SELECT jsonb_agg(
        jsonb_build_object(
          'trophyKey', td.key,
          'name', td.name,
          'description', td.description,
          'icon', td.icon,
          'repeatable', td.is_repeatable
        )
        ORDER BY td.name ASC, td.key ASC
      ) AS rows
      FROM public.trophy_definitions AS td
      WHERE NOT EXISTS (
        SELECT 1
        FROM public.player_trophies AS pt
        WHERE pt.player_id = v_player_id
          AND pt.season_id = p_season_id
          AND pt.trophy_key = td.key
          AND pt.is_active = TRUE
      )
    ),
    pending AS (
      SELECT jsonb_agg(
        jsonb_build_object(
          'id', pt.id,
          'trophyKey', pt.trophy_key,
          'name', td.name,
          'description', td.description,
          'icon', td.icon,
          'awardedAt', pt.awarded_at
        )
        ORDER BY pt.awarded_at DESC, pt.id DESC
      ) AS rows
      FROM public.player_trophies AS pt
      INNER JOIN public.trophy_definitions AS td ON td.key = pt.trophy_key
      WHERE pt.player_id = v_player_id
        AND pt.season_id = p_season_id
        AND pt.is_active = TRUE
        AND pt.presented_at IS NULL
    )
    SELECT jsonb_build_object(
      'seasonId', p_season_id,
      'stats', COALESCE((
        SELECT jsonb_build_object(
          'currentPredictionStreak', s.current_prediction_streak,
          'bestPredictionStreak', s.best_prediction_streak,
          'currentGoodResultStreak', s.current_good_result_streak,
          'bestGoodResultStreak', s.best_good_result_streak,
          'currentExactStreak', s.current_exact_streak,
          'bestExactStreak', s.best_exact_streak,
          'totalExactScores', s.total_exact_scores,
          'trophiesCount', s.trophies_count
        )
        FROM stats AS s
      ), jsonb_build_object(
        'currentPredictionStreak', 0,
        'bestPredictionStreak', 0,
        'currentGoodResultStreak', 0,
        'bestGoodResultStreak', 0,
        'currentExactStreak', 0,
        'bestExactStreak', 0,
        'totalExactScores', 0,
        'trophiesCount', 0
      )),
      'earnedTrophies', COALESCE((SELECT rows FROM earned), '[]'::jsonb),
      'lockedTrophies', COALESCE((SELECT rows FROM locked), '[]'::jsonb),
      'pendingCelebrations', COALESCE((SELECT rows FROM pending), '[]'::jsonb)
    )
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.acknowledge_trophy_celebrations(
  p_session_token TEXT,
  p_season_id UUID
)
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  v_player_id UUID;
  v_count INTEGER := 0;
BEGIN
  v_player_id := public.assert_player_session(p_session_token);
  PERFORM public.assert_season_exists(p_season_id);

  UPDATE public.player_trophies AS pt
  SET
    presented_at = now(),
    updated_at = now()
  WHERE pt.player_id = v_player_id
    AND pt.season_id = p_season_id
    AND pt.is_active = TRUE
    AND pt.presented_at IS NULL;

  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN v_count;
END;
$$;

CREATE OR REPLACE FUNCTION public.admin_get_matches(p_admin_session_token TEXT)
RETURNS TABLE (
  id UUID,
  external_id TEXT,
  round_number INTEGER,
  home_team TEXT,
  away_team TEXT,
  kickoff_at TIMESTAMPTZ,
  kickoff_time_confirmed BOOLEAN,
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
DECLARE
  v_season_id UUID;
BEGIN
  PERFORM public.assert_admin_session(p_admin_session_token);
  v_season_id := public.get_active_season_id();

  RETURN QUERY
  SELECT
    m.id,
    m.external_id,
    m.round_number,
    m.home_team,
    m.away_team,
    m.kickoff_at,
    m.kickoff_time_confirmed,
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
  WHERE m.season_id = v_season_id
  ORDER BY m.round_number ASC, m.kickoff_at ASC, m.id ASC;
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
  created_count INTEGER := 0;
  updated_count INTEGER := 0;
  unchanged_count INTEGER := 0;
  new_results_count INTEGER := 0;
  points_recalculated INTEGER := 0;
  protected_count INTEGER := 0;
  recalc INTEGER;
  v_confirm RECORD;
  v_existing_confirmed BOOLEAN;
  v_existing_source TEXT;
  v_season_id UUID;
BEGIN
  PERFORM public.assert_admin_session(p_admin_session_token);
  v_season_id := public.get_active_season_id();

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
    SELECT * INTO v_confirm
    FROM public.resolve_kickoff_confirmation(
      (create_item->>'kickoff_at')::TIMESTAMPTZ,
      create_item->>'status',
      NULL,
      NULL
    );

    INSERT INTO public.matches (
      season_id,
      external_id,
      round_number,
      home_team,
      away_team,
      kickoff_at,
      kickoff_time_confirmed,
      kickoff_confirmation_source,
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
      v_season_id,
      create_item->>'external_id',
      (create_item->>'round_number')::INTEGER,
      create_item->>'home_team',
      create_item->>'away_team',
      (create_item->>'kickoff_at')::TIMESTAMPTZ,
      v_confirm.confirmed,
      v_confirm.confirmation_source,
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
      WHERE m.id = (update_item->>'id')::UUID
        AND m.season_id = v_season_id;
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
      WHERE m.id = (update_item->>'id')::UUID
        AND m.season_id = v_season_id;
    ELSE
      updated_count := updated_count + 1;

      IF COALESCE((update_item->>'new_result')::BOOLEAN, FALSE) THEN
        new_results_count := new_results_count + 1;
      END IF;

      SELECT m.kickoff_time_confirmed, m.kickoff_confirmation_source
      INTO v_existing_confirmed, v_existing_source
      FROM public.matches AS m
      WHERE m.id = (update_item->>'id')::UUID
        AND m.season_id = v_season_id;

      SELECT * INTO v_confirm
      FROM public.resolve_kickoff_confirmation(
        (update_item->>'kickoff_at')::TIMESTAMPTZ,
        update_item->>'status',
        v_existing_confirmed,
        v_existing_source
      );

      UPDATE public.matches AS m
      SET
        external_id = update_item->>'external_id',
        source = 'fixturedownload',
        round_number = (update_item->>'round_number')::INTEGER,
        home_team = update_item->>'home_team',
        away_team = update_item->>'away_team',
        kickoff_at = (update_item->>'kickoff_at')::TIMESTAMPTZ,
        kickoff_time_confirmed = v_confirm.confirmed,
        kickoff_confirmation_source = v_confirm.confirmation_source,
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
      WHERE m.id = (update_item->>'id')::UUID
        AND m.season_id = v_season_id;

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

-- Active season compatibility for admin writes.
CREATE OR REPLACE FUNCTION public.admin_create_match(
  p_admin_session_token TEXT,
  p_round_number INTEGER,
  p_home_team TEXT,
  p_away_team TEXT,
  p_kickoff_at TIMESTAMPTZ,
  p_status TEXT DEFAULT 'scheduled',
  p_home_score INTEGER DEFAULT NULL,
  p_away_score INTEGER DEFAULT NULL,
  p_external_id TEXT DEFAULT NULL,
  p_kickoff_time_confirmed BOOLEAN DEFAULT NULL
)
RETURNS TABLE (
  id UUID,
  external_id TEXT,
  round_number INTEGER,
  home_team TEXT,
  away_team TEXT,
  kickoff_at TIMESTAMPTZ,
  kickoff_time_confirmed BOOLEAN,
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
  confirmed BOOLEAN;
  confirm_source TEXT;
  v_season_id UUID;
BEGIN
  PERFORM public.assert_admin_session(p_admin_session_token);
  v_season_id := public.get_active_season_id();

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

  IF p_kickoff_time_confirmed IS NULL THEN
    IF status_clean = 'finished' THEN
      confirmed := TRUE;
      confirm_source := 'manual';
    ELSIF public.is_paris_midnight_kickoff(p_kickoff_at) THEN
      confirmed := FALSE;
      confirm_source := 'heuristic';
    ELSE
      confirmed := TRUE;
      confirm_source := 'manual';
    END IF;
  ELSE
    confirmed := p_kickoff_time_confirmed;
    confirm_source := 'manual';
  END IF;

  IF status_clean NOT IN ('scheduled', 'live', 'finished', 'postponed', 'cancelled') THEN
    RAISE EXCEPTION 'INVALID_STATUS'
      USING ERRCODE = '22023',
            DETAIL = 'Statut de match invalide.';
  END IF;

  PERFORM public.assert_nantes_fixture(home_clean, away_clean);
  PERFORM public.assert_match_scores(status_clean, p_home_score, p_away_score);

  INSERT INTO public.matches AS m (
    season_id,
    external_id,
    round_number,
    home_team,
    away_team,
    kickoff_at,
    kickoff_time_confirmed,
    kickoff_confirmation_source,
    status,
    home_score,
    away_score,
    source,
    manual_override
  )
  VALUES (
    v_season_id,
    external_clean,
    p_round_number,
    home_clean,
    away_clean,
    p_kickoff_at,
    confirmed,
    confirm_source,
    status_clean,
    p_home_score,
    p_away_score,
    'manual',
    TRUE
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
    m.kickoff_time_confirmed,
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

REVOKE ALL ON FUNCTION public.get_active_season(TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.get_active_season(TEXT) FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_active_season(TEXT) TO anon, authenticated;

REVOKE ALL ON FUNCTION public.get_matches_for_season(TEXT, UUID) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.get_matches_for_season(TEXT, UUID) FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_matches_for_season(TEXT, UUID) TO anon, authenticated;

REVOKE ALL ON FUNCTION public.get_matches(TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.get_matches(TEXT) FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_matches(TEXT) TO anon, authenticated;

REVOKE ALL ON FUNCTION public.get_season_ranking(TEXT, UUID) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.get_season_ranking(TEXT, UUID) FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_season_ranking(TEXT, UUID) TO anon, authenticated;

REVOKE ALL ON FUNCTION public.get_ranking(TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.get_ranking(TEXT) FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_ranking(TEXT) TO anon, authenticated;

REVOKE ALL ON FUNCTION public.get_season_round_participation(TEXT, UUID, INTEGER) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.get_season_round_participation(TEXT, UUID, INTEGER)
  FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_season_round_participation(TEXT, UUID, INTEGER)
  TO anon, authenticated;

REVOKE ALL ON FUNCTION public.get_round_participation(TEXT, INTEGER) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.get_round_participation(TEXT, INTEGER)
  FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_round_participation(TEXT, INTEGER)
  TO anon, authenticated;

REVOKE ALL ON FUNCTION public.get_visible_predictions(TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.get_visible_predictions(TEXT) FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_visible_predictions(TEXT) TO anon, authenticated;

REVOKE ALL ON FUNCTION public.get_match_group_reveal(TEXT, UUID, UUID) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.get_match_group_reveal(TEXT, UUID, UUID) FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_match_group_reveal(TEXT, UUID, UUID) TO anon, authenticated;

REVOKE ALL ON FUNCTION public.get_player_trophy_overview(TEXT, UUID) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.get_player_trophy_overview(TEXT, UUID) FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_player_trophy_overview(TEXT, UUID) TO anon, authenticated;

REVOKE ALL ON FUNCTION public.acknowledge_trophy_celebrations(TEXT, UUID) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.acknowledge_trophy_celebrations(TEXT, UUID) FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION public.acknowledge_trophy_celebrations(TEXT, UUID) TO anon, authenticated;

