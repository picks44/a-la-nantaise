-- Zero-score guards for round recap, group stats champions, and season timeline bests.
-- Champion definition aligned on SUM(points) per player/round with maxRoundPoints > 0.
-- No schema changes.

CREATE OR REPLACE FUNCTION public.get_round_player_stats(
  p_session_token TEXT,
  p_season_id UUID,
  p_round_number INTEGER
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  v_status RECORD;
  v_payload JSONB;
BEGIN
  PERFORM public.assert_player_session(p_session_token);
  PERFORM public.assert_season_exists(p_season_id);

  IF p_round_number IS NULL OR p_round_number < 1 THEN
    RAISE EXCEPTION 'INVALID_ROUND'
      USING ERRCODE = '22023',
            DETAIL = 'Numéro de journée invalide.';
  END IF;

  SELECT * INTO v_status
  FROM public.compute_round_status(p_season_id, p_round_number);

  WITH round_matches AS (
    SELECT m.id, m.status, m.kickoff_at, m.kickoff_time_confirmed
    FROM public.matches AS m
    WHERE m.season_id = p_season_id
      AND m.round_number = p_round_number
  ),
  participation_matches AS (
    SELECT rm.id
    FROM round_matches AS rm
    WHERE rm.status NOT IN ('cancelled', 'postponed')
      AND rm.kickoff_time_confirmed = TRUE
      AND (rm.kickoff_at <= now() OR rm.status = 'finished')
  ),
  round_predictions AS (
    SELECT pr.player_id, pr.match_id, pr.points
    FROM public.predictions AS pr
    INNER JOIN round_matches AS rm ON rm.id = pr.match_id
  ),
  predicted_participation AS (
    SELECT DISTINCT rp.player_id, rp.match_id
    FROM round_predictions AS rp
    INNER JOIN participation_matches AS pm ON pm.id = rp.match_id
  ),
  predicted_counts AS (
    SELECT pp.player_id, COUNT(*)::INTEGER AS predicted_match_count
    FROM predicted_participation AS pp
    GROUP BY pp.player_id
  ),
  player_pool AS (
    SELECT p.id AS player_id, p.display_name
    FROM public.players AS p
    WHERE p.is_active = TRUE
       OR EXISTS (SELECT 1 FROM round_predictions AS rp WHERE rp.player_id = p.id)
  ),
  player_aggregates AS (
    SELECT
      pp.player_id,
      pp.display_name,
      COALESCE(SUM(rp.points), 0)::INTEGER AS round_points,
      COALESCE(COUNT(*) FILTER (WHERE rp.points = 3), 0)::INTEGER AS exact_score_count,
      COALESCE(COUNT(*) FILTER (WHERE rp.points = 1), 0)::INTEGER AS correct_outcome_only_count,
      COALESCE(COUNT(*) FILTER (WHERE rp.points IN (1, 3)), 0)::INTEGER AS successful_prediction_count,
      COALESCE(COUNT(*) FILTER (WHERE rp.points IS NOT NULL), 0)::INTEGER AS scored_prediction_count,
      COALESCE(pc.predicted_match_count, 0) AS predicted_match_count,
      (SELECT COUNT(*)::INTEGER FROM participation_matches) AS participation_match_count
    FROM player_pool AS pp
    LEFT JOIN round_predictions AS rp ON rp.player_id = pp.player_id
    LEFT JOIN predicted_counts AS pc ON pc.player_id = pp.player_id
    GROUP BY pp.player_id, pp.display_name, pc.predicted_match_count
  ),
  ranked_scored AS (
    SELECT
      pa.player_id,
      RANK() OVER (ORDER BY pa.round_points DESC, pa.exact_score_count DESC)::INTEGER AS rank_in_round
    FROM player_aggregates AS pa
    WHERE pa.scored_prediction_count > 0
  ),
  player_ranked AS (
    SELECT
      pa.*,
      CASE
        WHEN pa.participation_match_count = 0 THEN 'not_applicable'
        WHEN pa.predicted_match_count = 0 THEN 'none'
        WHEN pa.predicted_match_count >= pa.participation_match_count THEN 'complete'
        ELSE 'partial'
      END AS participation_status,
      GREATEST(pa.participation_match_count - pa.predicted_match_count, 0) AS missed_prediction_count,
      rs.rank_in_round
    FROM player_aggregates AS pa
    LEFT JOIN ranked_scored AS rs ON rs.player_id = pa.player_id
  ),
  champions AS (
    SELECT
      pr.player_id,
      pr.round_points,
      RANK() OVER (ORDER BY pr.round_points DESC, pr.exact_score_count DESC) AS champ_rank
    FROM player_ranked AS pr
    WHERE pr.predicted_match_count > 0
  ),
  champion_ids AS (
    SELECT
      COALESCE(
        jsonb_agg(c.player_id ORDER BY c.player_id)
          FILTER (WHERE c.champ_rank = 1 AND c.round_points > 0),
        '[]'::jsonb
      ) AS ids,
      MAX(c.round_points) FILTER (WHERE c.champ_rank = 1 AND c.round_points > 0) AS pts
    FROM champions AS c
  ),
  group_stats AS (
    SELECT
      COUNT(*) FILTER (WHERE pr.predicted_match_count > 0)::INTEGER AS participant_count,
      CASE
        WHEN COUNT(*) FILTER (WHERE pr.predicted_match_count > 0) = 0 THEN NULL
        ELSE ROUND(AVG(pr.round_points) FILTER (WHERE pr.predicted_match_count > 0)::NUMERIC, 1)
      END AS participant_average_points
    FROM player_ranked AS pr
  ),
  players_json AS (
    SELECT jsonb_agg(
      jsonb_build_object(
        'playerId', pr.player_id,
        'displayName', pr.display_name,
        'roundPoints', pr.round_points,
        'exactScoreCount', pr.exact_score_count,
        'correctOutcomeOnlyCount', pr.correct_outcome_only_count,
        'successfulPredictionCount', pr.successful_prediction_count,
        'scoredPredictionCount', pr.scored_prediction_count,
        'predictedMatchCount', pr.predicted_match_count,
        'participationMatchCount', pr.participation_match_count,
        'missedPredictionCount', pr.missed_prediction_count,
        'participationStatus', pr.participation_status,
        'rankInRound', pr.rank_in_round
      )
      ORDER BY pr.display_name ASC, pr.player_id ASC
    ) AS rows
    FROM player_ranked AS pr
  )
  SELECT jsonb_build_object(
    'seasonId', p_season_id,
    'roundNumber', p_round_number,
    'roundStatus', v_status.status,
    'players', COALESCE((SELECT rows FROM players_json), '[]'::jsonb),
    'group', jsonb_build_object(
      'participantCount', COALESCE((SELECT participant_count FROM group_stats), 0),
      'participantAveragePoints', (SELECT participant_average_points FROM group_stats),
      'championPlayerIds', COALESCE((SELECT ids FROM champion_ids), '[]'::jsonb),
      'championRoundPoints', (SELECT pts FROM champion_ids)
    )
  )
  INTO v_payload;

  RETURN v_payload;
END;
$$;

-- ---------------------------------------------------------------------------
-- 4. get_live_season_ranking
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.get_player_round_recap(
  p_session_token TEXT,
  p_season_id UUID,
  p_round_number INTEGER
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  v_player_id UUID;
  v_status RECORD;
  v_before_round_number INTEGER;
  v_round_points INTEGER;
  v_exact_score_count INTEGER;
  v_correct_outcome_only_count INTEGER;
  v_successful_prediction_count INTEGER;
  v_scored_prediction_count INTEGER;
  v_predicted_match_count INTEGER;
  v_participation_match_count INTEGER;
  v_missed_prediction_count INTEGER;
  v_participated BOOLEAN;
  v_rank_before INTEGER;
  v_rank_after INTEGER;
  v_rank_delta INTEGER;
  v_is_new_to_ranking BOOLEAN;
  v_gap_to_previous INTEGER;
  v_champion_names JSONB;
  v_champion_round_points INTEGER;
  v_participant_average_points NUMERIC;
  v_player_ahead JSONB;
  v_matches JSONB;
  v_trophies JSONB;
  v_message_key TEXT;
  v_message_params JSONB;
  v_best_prior_rank INTEGER;
  v_is_champion BOOLEAN;
  v_is_tied BOOLEAN;
BEGIN
  v_player_id := public.assert_player_session(p_session_token);
  PERFORM public.assert_season_exists(p_season_id);

  IF p_round_number IS NULL OR p_round_number < 1 THEN
    RAISE EXCEPTION 'INVALID_ROUND'
      USING ERRCODE = '22023',
            DETAIL = 'Numéro de journée invalide.';
  END IF;

  SELECT * INTO v_status
  FROM public.compute_round_status(p_season_id, p_round_number);

  v_before_round_number := p_round_number - 1;

  -- Agrégats du joueur sur la journée
  WITH round_matches AS (
    SELECT m.id, m.status, m.kickoff_at, m.kickoff_time_confirmed
    FROM public.matches AS m
    WHERE m.season_id = p_season_id
      AND m.round_number = p_round_number
  ),
  participation_matches AS (
    SELECT rm.id
    FROM round_matches AS rm
    WHERE rm.status NOT IN ('cancelled', 'postponed')
      AND rm.kickoff_time_confirmed = TRUE
      AND (rm.kickoff_at <= now() OR rm.status = 'finished')
  ),
  player_predictions AS (
    SELECT pr.match_id, pr.points
    FROM public.predictions AS pr
    INNER JOIN round_matches AS rm ON rm.id = pr.match_id
    WHERE pr.player_id = v_player_id
  ),
  player_participation_count AS (
    SELECT COUNT(*)::INTEGER AS cnt
    FROM player_predictions AS pp
    INNER JOIN participation_matches AS pm ON pm.id = pp.match_id
  )
  SELECT
    COALESCE(SUM(pp.points), 0)::INTEGER,
    COALESCE(COUNT(*) FILTER (WHERE pp.points = 3), 0)::INTEGER,
    COALESCE(COUNT(*) FILTER (WHERE pp.points = 1), 0)::INTEGER,
    COALESCE(COUNT(*) FILTER (WHERE pp.points IN (1, 3)), 0)::INTEGER,
    COALESCE(COUNT(*) FILTER (WHERE pp.points IS NOT NULL), 0)::INTEGER,
    COALESCE((SELECT cnt FROM player_participation_count), 0),
    (SELECT COUNT(*)::INTEGER FROM participation_matches)
  INTO
    v_round_points,
    v_exact_score_count,
    v_correct_outcome_only_count,
    v_successful_prediction_count,
    v_scored_prediction_count,
    v_predicted_match_count,
    v_participation_match_count
  FROM player_predictions AS pp;

  v_missed_prediction_count := GREATEST(v_participation_match_count - v_predicted_match_count, 0);
  v_participated := v_predicted_match_count > 0;

  -- Classement avant / après (rang technique vs métier §1.5)
  WITH as_of_before AS (
    SELECT *
    FROM public.compute_season_ranking_as_of(p_season_id, v_before_round_number)
    WHERE player_id = v_player_id
  ),
  as_of_after_raw AS (
    SELECT
      car.*,
      LAG(car.display_name) OVER (
        ORDER BY car.points DESC, car.exact_score_count DESC, car.display_name ASC
      ) AS prev_display_name,
      LAG(car.points) OVER (
        ORDER BY car.points DESC, car.exact_score_count DESC, car.display_name ASC
      ) AS prev_points
    FROM public.compute_season_ranking_as_of(p_season_id, p_round_number) AS car
  ),
  as_of_after AS (
    SELECT * FROM as_of_after_raw WHERE player_id = v_player_id
  )
  SELECT
    CASE WHEN COALESCE(b.scored_prediction_count, 0) > 0 THEN b.rank ELSE NULL END,
    a.rank,
    a.gap_to_previous,
    CASE
      WHEN a.prev_display_name IS NULL THEN NULL
      ELSE jsonb_build_object(
        'displayName', a.prev_display_name,
        'points', a.prev_points,
        'gap', a.gap_to_previous
      )
    END
  INTO
    v_rank_before,
    v_rank_after,
    v_gap_to_previous,
    v_player_ahead
  FROM as_of_after AS a
  LEFT JOIN as_of_before AS b ON TRUE;

  v_is_new_to_ranking := (v_rank_before IS NULL);
  v_rank_delta := CASE WHEN v_rank_before IS NULL THEN NULL ELSE v_rank_before - v_rank_after END;

  IF v_rank_after IS NULL THEN
    v_is_tied := FALSE;
  ELSE
    SELECT COUNT(*) > 1
    INTO v_is_tied
    FROM public.compute_season_ranking_as_of(p_season_id, p_round_number) AS car
    WHERE car.rank = v_rank_after;
  END IF;

  -- Champions de journée / moyenne du groupe (§1.10)
  WITH round_matches AS (
    SELECT m.id, m.status, m.kickoff_at, m.kickoff_time_confirmed
    FROM public.matches AS m
    WHERE m.season_id = p_season_id
      AND m.round_number = p_round_number
  ),
  participation_matches AS (
    SELECT rm.id
    FROM round_matches AS rm
    WHERE rm.status NOT IN ('cancelled', 'postponed')
      AND rm.kickoff_time_confirmed = TRUE
      AND (rm.kickoff_at <= now() OR rm.status = 'finished')
  ),
  round_predictions AS (
    SELECT pr.player_id, pr.match_id, pr.points
    FROM public.predictions AS pr
    INNER JOIN round_matches AS rm ON rm.id = pr.match_id
  ),
  predicted_participation AS (
    SELECT DISTINCT rp.player_id, rp.match_id
    FROM round_predictions AS rp
    INNER JOIN participation_matches AS pm ON pm.id = rp.match_id
  ),
  predicted_counts AS (
    SELECT pp.player_id, COUNT(*)::INTEGER AS predicted_match_count
    FROM predicted_participation AS pp
    GROUP BY pp.player_id
  ),
  player_pool AS (
    SELECT p.id AS player_id, p.display_name
    FROM public.players AS p
    WHERE p.is_active = TRUE
       OR EXISTS (SELECT 1 FROM round_predictions AS rp WHERE rp.player_id = p.id)
  ),
  player_round_agg AS (
    SELECT
      pp.player_id,
      pp.display_name,
      COALESCE(SUM(rp.points), 0)::INTEGER AS round_points,
      COALESCE(COUNT(*) FILTER (WHERE rp.points = 3), 0)::INTEGER AS exact_score_count,
      COALESCE(pc.predicted_match_count, 0) AS predicted_match_count
    FROM player_pool AS pp
    LEFT JOIN round_predictions AS rp ON rp.player_id = pp.player_id
    LEFT JOIN predicted_counts AS pc ON pc.player_id = pp.player_id
    GROUP BY pp.player_id, pp.display_name, pc.predicted_match_count
  ),
  candidates AS (
    SELECT
      *,
      RANK() OVER (ORDER BY round_points DESC, exact_score_count DESC) AS champ_rank
    FROM player_round_agg
    WHERE predicted_match_count > 0
  )
  SELECT
    COALESCE(
      (
        SELECT jsonb_agg(cd.display_name ORDER BY cd.display_name)
        FROM candidates AS cd
        WHERE cd.champ_rank = 1
          AND cd.round_points > 0
      ),
      '[]'::jsonb
    ),
    (
      SELECT cd.round_points
      FROM candidates AS cd
      WHERE cd.champ_rank = 1
        AND cd.round_points > 0
      LIMIT 1
    ),
    (
      SELECT CASE WHEN COUNT(*) = 0 THEN NULL ELSE ROUND(AVG(pra.round_points)::NUMERIC, 1) END
      FROM player_round_agg AS pra
      WHERE pra.predicted_match_count > 0
    ),
    EXISTS (
      SELECT 1
      FROM candidates AS cd
      WHERE cd.champ_rank = 1
        AND cd.round_points > 0
        AND cd.player_id = v_player_id
    )
  INTO
    v_champion_names,
    v_champion_round_points,
    v_participant_average_points,
    v_is_champion;

  -- Détail des matchs de la journée pour le joueur
  SELECT COALESCE(jsonb_agg(
    jsonb_build_object(
      'matchId', m.id,
      'homeTeam', m.home_team,
      'awayTeam', m.away_team,
      'status', m.status,
      'homeScore', m.home_score,
      'awayScore', m.away_score,
      'predictedHomeScore', pr.predicted_home_score,
      'predictedAwayScore', pr.predicted_away_score,
      'points', pr.points
    )
    ORDER BY m.kickoff_at ASC, m.id ASC
  ), '[]'::jsonb)
  INTO v_matches
  FROM public.matches AS m
  LEFT JOIN public.predictions AS pr
    ON pr.match_id = m.id AND pr.player_id = v_player_id
  WHERE m.season_id = p_season_id
    AND m.round_number = p_round_number;

  -- Trophées actifs de la journée (§1.14, pas de simulation)
  SELECT COALESCE(jsonb_agg(
    jsonb_build_object(
      'id', pt.id,
      'trophyKey', pt.trophy_key,
      'name', td.name,
      'description', td.description,
      'icon', td.icon,
      'awardedAt', pt.awarded_at
    )
    ORDER BY pt.awarded_at ASC, pt.id ASC
  ), '[]'::jsonb)
  INTO v_trophies
  FROM public.player_trophies AS pt
  INNER JOIN public.trophy_definitions AS td ON td.key = pt.trophy_key
  WHERE pt.player_id = v_player_id
    AND pt.season_id = p_season_id
    AND pt.is_active = TRUE
    AND pt.source_round_number = p_round_number;

  -- Meilleur rang atteint sur les journées completed précédentes (personal_best_rank)
  SELECT MIN(ranked.rank)
  INTO v_best_prior_rank
  FROM (
    SELECT DISTINCT m.round_number AS rn
    FROM public.matches AS m
    WHERE m.season_id = p_season_id
      AND m.round_number < p_round_number
  ) AS rounds
  CROSS JOIN LATERAL public.compute_round_status(p_season_id, rounds.rn) AS cs
  CROSS JOIN LATERAL (
    SELECT car.rank
    FROM public.compute_season_ranking_as_of(p_season_id, rounds.rn) AS car
    WHERE car.player_id = v_player_id
  ) AS ranked
  WHERE cs.status = 'completed';

  -- Priorité des messages (§1.13)
  IF NOT v_participated THEN
    v_message_key := 'no_participation';
    v_message_params := '{}'::jsonb;
  ELSIF v_is_champion AND v_status.is_definitive THEN
    v_message_key := 'champion_of_round';
    v_message_params := jsonb_build_object('roundPoints', v_round_points);
  ELSIF v_status.is_definitive
    AND v_best_prior_rank IS NOT NULL
    AND v_rank_after < v_best_prior_rank
  THEN
    v_message_key := 'personal_best_rank';
    v_message_params := jsonb_build_object('rank', v_rank_after);
  ELSIF v_rank_delta IS NOT NULL AND v_rank_delta >= 3 THEN
    v_message_key := 'strong_rise';
    v_message_params := jsonb_build_object('places', v_rank_delta, 'rank', v_rank_after);
  ELSIF v_exact_score_count >= 2 THEN
    v_message_key := 'exact_scores_notable';
    v_message_params := jsonb_build_object('exactScoreCount', v_exact_score_count);
  ELSIF v_round_points >= 3 OR (v_successful_prediction_count >= 1 AND COALESCE(v_rank_delta, 0) >= 0) THEN
    v_message_key := 'positive_day';
    v_message_params := jsonb_build_object('roundPoints', v_round_points);
  ELSIF v_round_points BETWEEN 1 AND 2 AND COALESCE(v_rank_delta, 0) BETWEEN -1 AND 1 THEN
    v_message_key := 'neutral_day';
    v_message_params := jsonb_build_object('roundPoints', v_round_points);
  ELSIF v_status.is_definitive AND v_round_points = 0 THEN
    v_message_key := 'scoreless_day';
    v_message_params := jsonb_build_object('roundPoints', v_round_points);
  ELSE
    v_message_key := 'tough_day';
    v_message_params := jsonb_build_object('roundPoints', v_round_points);
  END IF;

  RETURN jsonb_build_object(
    'seasonId', p_season_id,
    'roundNumber', p_round_number,
    'roundStatus', v_status.status,
    'isDefinitive', v_status.is_definitive,
    'messageKey', v_message_key,
    'messageParams', v_message_params,
    'summary', jsonb_build_object(
      'roundPoints', v_round_points,
      'exactScoreCount', v_exact_score_count,
      'correctOutcomeOnlyCount', v_correct_outcome_only_count,
      'successfulPredictionCount', v_successful_prediction_count,
      'scoredPredictionCount', v_scored_prediction_count,
      'missedPredictionCount', v_missed_prediction_count,
      'predictedMatchCount', v_predicted_match_count,
      'participationMatchCount', v_participation_match_count,
      'participated', v_participated
    ),
    'ranking', jsonb_build_object(
      'rankBefore', v_rank_before,
      'rankAfter', v_rank_after,
      'rankDelta', v_rank_delta,
      'isNewToRanking', v_is_new_to_ranking,
      'gapToPrevious', v_gap_to_previous,
      'isTied', COALESCE(v_is_tied, FALSE)
    ),
    'social', jsonb_build_object(
      'championDisplayNames', v_champion_names,
      'championRoundPoints', v_champion_round_points,
      'participantAveragePoints', v_participant_average_points,
      'playerAhead', v_player_ahead
    ),
    'matches', v_matches,
    'trophies', v_trophies
  );
END;
$$;

-- ---------------------------------------------------------------------------
-- 6. get_player_season_timeline (L6)
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.get_player_season_timeline(
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
  v_rounds JSONB;
  v_best_round JSONB;
  v_best_rank JSONB;
  v_trophies JSONB;
BEGIN
  v_player_id := public.assert_player_session(p_session_token);
  PERFORM public.assert_season_exists(p_season_id);

  WITH season_rounds AS (
    SELECT DISTINCT m.round_number AS rn
    FROM public.matches AS m
    WHERE m.season_id = p_season_id
  ),
  completed_rounds AS (
    SELECT sr.rn
    FROM season_rounds AS sr
    CROSS JOIN LATERAL public.compute_round_status(p_season_id, sr.rn) AS cs
    WHERE cs.status = 'completed'
  ),
  round_player_points AS (
    SELECT
      cr.rn AS round_number,
      COALESCE(SUM(pr.points), 0)::INTEGER AS round_points
    FROM completed_rounds AS cr
    LEFT JOIN public.matches AS m
      ON m.season_id = p_season_id AND m.round_number = cr.rn AND m.status = 'finished'
    LEFT JOIN public.predictions AS pr
      ON pr.match_id = m.id AND pr.player_id = v_player_id
    GROUP BY cr.rn
  ),
  round_ranks AS (
    SELECT
      cr.rn AS round_number,
      car.rank,
      car.gap_to_previous,
      car.points AS season_points
    FROM completed_rounds AS cr
    CROSS JOIN LATERAL (
      SELECT c.rank, c.gap_to_previous, c.points
      FROM public.compute_season_ranking_as_of(p_season_id, cr.rn) AS c
      WHERE c.player_id = v_player_id
    ) AS car
  )
  SELECT
    COALESCE(jsonb_agg(
      jsonb_build_object(
        'roundNumber', rpp.round_number,
        'roundPoints', rpp.round_points,
        'rank', rr.rank,
        'gapToPrevious', rr.gap_to_previous,
        'seasonPoints', rr.season_points
      )
      ORDER BY rpp.round_number ASC
    ), '[]'::jsonb)
  INTO v_rounds
  FROM round_player_points AS rpp
  INNER JOIN round_ranks AS rr ON rr.round_number = rpp.round_number;

  SELECT jsonb_build_object('roundNumber', x.round_number, 'roundPoints', x.round_points)
  INTO v_best_round
  FROM (
    SELECT
      (elem ->> 'roundNumber')::INTEGER AS round_number,
      (elem ->> 'roundPoints')::INTEGER AS round_points
    FROM jsonb_array_elements(v_rounds) AS elem
    WHERE (elem ->> 'roundPoints')::INTEGER > 0
    ORDER BY (elem ->> 'roundPoints')::INTEGER DESC, (elem ->> 'roundNumber')::INTEGER ASC
    LIMIT 1
  ) AS x;

  SELECT jsonb_build_object('roundNumber', x.round_number, 'rank', x.rank)
  INTO v_best_rank
  FROM (
    SELECT
      (elem ->> 'roundNumber')::INTEGER AS round_number,
      (elem ->> 'rank')::INTEGER AS rank
    FROM jsonb_array_elements(v_rounds) AS elem
    WHERE elem ->> 'rank' IS NOT NULL
      AND COALESCE((elem ->> 'seasonPoints')::INTEGER, 0) > 0
    ORDER BY (elem ->> 'rank')::INTEGER ASC, (elem ->> 'roundNumber')::INTEGER ASC
    LIMIT 1
  ) AS x;


  -- Ne pas exposer seasonPoints (usage interne bestRank uniquement).
  SELECT COALESCE(jsonb_agg(
    elem - 'seasonPoints'
    ORDER BY (elem ->> 'roundNumber')::INTEGER ASC
  ), '[]'::jsonb)
  INTO v_rounds
  FROM jsonb_array_elements(v_rounds) AS elem;

  SELECT COALESCE(jsonb_agg(
    jsonb_build_object(
      'id', pt.id,
      'trophyKey', pt.trophy_key,
      'name', td.name,
      'description', td.description,
      'icon', td.icon,
      'awardedAt', pt.awarded_at,
      'sourceRoundNumber', pt.source_round_number
    )
    ORDER BY pt.awarded_at ASC, pt.id ASC
  ), '[]'::jsonb)
  INTO v_trophies
  FROM public.player_trophies AS pt
  INNER JOIN public.trophy_definitions AS td ON td.key = pt.trophy_key
  WHERE pt.player_id = v_player_id
    AND pt.season_id = p_season_id
    AND pt.is_active = TRUE;

  RETURN jsonb_build_object(
    'seasonId', p_season_id,
    'rounds', v_rounds,
    'bestRound', v_best_round,
    'bestRank', v_best_rank,
    'trophies', v_trophies
  );
END;
$$;

-- ---------------------------------------------------------------------------


REVOKE ALL ON FUNCTION public.get_round_player_stats(TEXT, UUID, INTEGER) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.get_round_player_stats(TEXT, UUID, INTEGER) FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_round_player_stats(TEXT, UUID, INTEGER) TO anon, authenticated;

REVOKE ALL ON FUNCTION public.get_player_round_recap(TEXT, UUID, INTEGER) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.get_player_round_recap(TEXT, UUID, INTEGER) FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_player_round_recap(TEXT, UUID, INTEGER) TO anon, authenticated;

REVOKE ALL ON FUNCTION public.get_player_season_timeline(TEXT, UUID) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.get_player_season_timeline(TEXT, UUID) FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_player_season_timeline(TEXT, UUID) TO anon, authenticated;

