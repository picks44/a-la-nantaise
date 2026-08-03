-- Classement enrichi + participation par journée (sans scores prédits).
-- Auth : session joueur opaque (assert_player_session).

-- ---------------------------------------------------------------------------
-- get_ranking : agrégats saison + inactifs ayant déjà marqué
-- ---------------------------------------------------------------------------

DROP FUNCTION IF EXISTS public.get_ranking(TEXT);

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
  PERFORM public.assert_player_session(p_session_token);

  RETURN QUERY
  WITH aggregates AS (
    SELECT
      p.id,
      p.display_name,
      p.is_active,
      COALESCE(SUM(pr.points), 0)::BIGINT AS points,
      COALESCE(COUNT(*) FILTER (WHERE pr.points = 3), 0)::BIGINT AS exact_scores,
      COALESCE(COUNT(*) FILTER (WHERE pr.points = 1), 0)::BIGINT AS good_results,
      COALESCE(COUNT(pr.points), 0)::BIGINT AS scored_predictions
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

REVOKE ALL ON FUNCTION public.get_ranking(TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.get_ranking(TEXT) FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_ranking(TEXT) TO anon, authenticated;

-- ---------------------------------------------------------------------------
-- get_round_participation : statuts sans contenu de pronostic
-- ---------------------------------------------------------------------------

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
  PERFORM public.assert_player_session(p_session_token);

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
    WHERE m.round_number = p_round_number
      AND m.status NOT IN ('cancelled', 'postponed')
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

REVOKE ALL ON FUNCTION public.get_round_participation(TEXT, INTEGER) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.get_round_participation(TEXT, INTEGER)
  FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_round_participation(TEXT, INTEGER)
  TO anon, authenticated;
