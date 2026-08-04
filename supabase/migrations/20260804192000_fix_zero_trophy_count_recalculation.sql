-- Corrige trophies_count après recalcul lorsque plus aucun trophée n'est actif.
-- Cause : le UPDATE final joignait uniquement les joueurs encore présents dans
-- l'agrégat des trophées actifs, laissant l'ancienne valeur pour les autres.
-- Ne modifie aucune règle d'attribution, d'invalidation ni d'historique.

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

  -- Remet trophies_count à jour pour TOUS les joueurs de la saison, y compris
  -- ceux qui n'ont plus aucun trophée actif (absent de l'agrégat GROUP BY).
  UPDATE public.player_season_stats AS pss
  SET
    trophies_count = COALESCE((
      SELECT COUNT(*)::INTEGER
      FROM public.player_trophies AS pt
      WHERE pt.player_id = pss.player_id
        AND pt.season_id = pss.season_id
        AND pt.is_active = TRUE
    ), 0),
    recalculated_at = v_now,
    updated_at = now()
  WHERE pss.season_id = p_season_id;
END;
$$;

-- Backfill idempotent : répare immédiatement les compteurs déjà erronés
-- sans supprimer l’historique des trophées invalidés.
DO $$
DECLARE
  season_row RECORD;
BEGIN
  FOR season_row IN
    SELECT id
    FROM public.seasons
    ORDER BY starts_at NULLS LAST, id
  LOOP
    PERFORM public.recalculate_season_achievements(season_row.id);
  END LOOP;
END;
$$;
