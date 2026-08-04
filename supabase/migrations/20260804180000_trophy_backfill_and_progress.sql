-- Backfill trophées/séries après seed ou données historiques,
-- et enrichit l’overview avec progression + libellé du match source.

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
  v_has_stats BOOLEAN;
  v_has_predictions BOOLEAN;
BEGIN
  v_player_id := public.assert_player_session(p_session_token);
  PERFORM public.assert_season_exists(p_season_id);

  -- Guérit les environnements seedés / importés sans recalcul.
  SELECT EXISTS (
    SELECT 1
    FROM public.player_season_stats AS pss
    WHERE pss.season_id = p_season_id
  )
  INTO v_has_stats;

  SELECT EXISTS (
    SELECT 1
    FROM public.predictions AS pr
    INNER JOIN public.matches AS m ON m.id = pr.match_id
    WHERE m.season_id = p_season_id
  )
  INTO v_has_predictions;

  IF NOT v_has_stats AND v_has_predictions THEN
    PERFORM public.recalculate_season_achievements(p_season_id);
  END IF;

  RETURN (
    WITH stats AS (
      SELECT *
      FROM public.player_season_stats AS pss
      WHERE pss.player_id = v_player_id
        AND pss.season_id = p_season_id
    ),
    stats_defaults AS (
      SELECT
        COALESCE(s.current_prediction_streak, 0) AS current_prediction_streak,
        COALESCE(s.best_prediction_streak, 0) AS best_prediction_streak,
        COALESCE(s.current_good_result_streak, 0) AS current_good_result_streak,
        COALESCE(s.best_good_result_streak, 0) AS best_good_result_streak,
        COALESCE(s.current_exact_streak, 0) AS current_exact_streak,
        COALESCE(s.best_exact_streak, 0) AS best_exact_streak,
        COALESCE(s.total_exact_scores, 0) AS total_exact_scores,
        COALESCE(s.trophies_count, 0) AS trophies_count
      FROM (SELECT 1) AS _
      LEFT JOIN stats AS s ON TRUE
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
          'sourceMatchLabel', CASE
            WHEN m.id IS NULL THEN NULL
            ELSE format('%s — %s', m.home_team, m.away_team)
          END,
          'presentedAt', pt.presented_at
        )
        ORDER BY pt.awarded_at DESC, pt.id DESC
      ) AS rows
      FROM public.player_trophies AS pt
      INNER JOIN public.trophy_definitions AS td ON td.key = pt.trophy_key
      LEFT JOIN public.matches AS m ON m.id = pt.source_match_id
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
          'repeatable', td.is_repeatable,
          'progressCurrent', prog.progress_current,
          'progressTarget', prog.progress_target
        )
        ORDER BY
          CASE
            WHEN prog.progress_target IS NULL OR prog.progress_target = 0 THEN 0
            ELSE prog.progress_current::NUMERIC / prog.progress_target
          END DESC,
          td.name ASC,
          td.key ASC
      ) AS rows
      FROM public.trophy_definitions AS td
      CROSS JOIN stats_defaults AS sd
      CROSS JOIN LATERAL (
        SELECT
          CASE td.key
            WHEN 'first_participation' THEN
              CASE WHEN sd.best_prediction_streak > 0 OR sd.current_prediction_streak > 0 THEN 1 ELSE 0 END
            WHEN 'first_exact_score' THEN LEAST(sd.total_exact_scores, 1)
            WHEN 'double_precision' THEN LEAST(GREATEST(sd.best_exact_streak, sd.current_exact_streak), 2)
            WHEN 'bien_vu' THEN LEAST(GREATEST(sd.best_good_result_streak, sd.current_good_result_streak), 3)
            WHEN 'fidele_au_poste' THEN LEAST(GREATEST(sd.best_prediction_streak, sd.current_prediction_streak), 5)
            WHEN 'serie_en_or' THEN LEAST(GREATEST(sd.best_prediction_streak, sd.current_prediction_streak), 10)
            ELSE NULL
          END AS progress_current,
          CASE td.key
            WHEN 'first_participation' THEN 1
            WHEN 'first_exact_score' THEN 1
            WHEN 'double_precision' THEN 2
            WHEN 'bien_vu' THEN 3
            WHEN 'fidele_au_poste' THEN 5
            WHEN 'serie_en_or' THEN 10
            ELSE NULL
          END AS progress_target
      ) AS prog
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
      'stats', (
        SELECT jsonb_build_object(
          'currentPredictionStreak', sd.current_prediction_streak,
          'bestPredictionStreak', sd.best_prediction_streak,
          'currentGoodResultStreak', sd.current_good_result_streak,
          'bestGoodResultStreak', sd.best_good_result_streak,
          'currentExactStreak', sd.current_exact_streak,
          'bestExactStreak', sd.best_exact_streak,
          'totalExactScores', sd.total_exact_scores,
          'trophiesCount', sd.trophies_count
        )
        FROM stats_defaults AS sd
      ),
      'earnedTrophies', COALESCE((SELECT rows FROM earned), '[]'::jsonb),
      'lockedTrophies', COALESCE((SELECT rows FROM locked), '[]'::jsonb),
      'pendingCelebrations', COALESCE((SELECT rows FROM pending), '[]'::jsonb)
    )
  );
END;
$$;

REVOKE ALL ON FUNCTION public.get_player_trophy_overview(TEXT, UUID) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.get_player_trophy_overview(TEXT, UUID) FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_player_trophy_overview(TEXT, UUID) TO anon, authenticated;

DO $$
DECLARE
  season_row RECORD;
BEGIN
  FOR season_row IN
    SELECT s.id
    FROM public.seasons AS s
  LOOP
    PERFORM public.recalculate_season_achievements(season_row.id);
  END LOOP;
END;
$$;
