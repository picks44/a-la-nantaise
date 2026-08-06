-- =============================================================================
-- À la Nantaise — invariants du seed local (lecture seule)
-- Fichier : supabase/maintenance/verify_seed_invariants.sql
-- =============================================================================
-- Prérequis : stack DEV après `supabase db reset` (ports 54xxx).
-- Aucune écriture. Aucune empreinte de secret attendue. Aucun secret affiché.
-- Usage (après validation humaine du reset) :
--   psql "$DEV_DB_URL" -v ON_ERROR_STOP=1 -f supabase/maintenance/verify_seed_invariants.sql
-- =============================================================================

DO $$
DECLARE
  v_season_id UUID;
  v_now TIMESTAMPTZ := now();
  v_player_count INTEGER;
  v_dup_players INTEGER;
  v_missing_pin INTEGER;
  v_access_ok BOOLEAN;
  v_admin_ok BOOLEAN;
  v_match_count INTEGER;
  v_chrono_ok BOOLEAN;
  v_pred_count INTEGER;
  v_j67_preds INTEGER;
  v_j13_null_points INTEGER;
  v_j45_scored INTEGER;
  v_stats_count INTEGER;
  v_trophies_active INTEGER;
  v_stats_trophy_mismatch INTEGER;
  v_ranks INTEGER[];
  v_j2_top_score TEXT;
  v_j2_top_count INTEGER;
  v_j2_tied_tops INTEGER;
  v_j3_nantes_defeat INTEGER;
  v_j3_nantes_victory INTEGER;
  v_j3_draw INTEGER;
  v_reveal_ok INTEGER;
  r RECORD;
BEGIN
  v_season_id := public.get_active_season_id();

  -- ---- Joueurs (8 UUID seed, actifs, uniques, PIN hash présent) ----
  SELECT COUNT(*)::INTEGER INTO v_player_count
  FROM public.players AS p
  WHERE p.id IN (
    '11111111-1111-1111-1111-111111111101',
    '11111111-1111-1111-1111-111111111102',
    '11111111-1111-1111-1111-111111111103',
    '11111111-1111-1111-1111-111111111104',
    '11111111-1111-1111-1111-111111111105',
    '11111111-1111-1111-1111-111111111106',
    '11111111-1111-1111-1111-111111111107',
    '11111111-1111-1111-1111-111111111108'
  )
    AND p.is_active = TRUE;

  IF v_player_count <> 8 THEN
    RAISE EXCEPTION 'SEED_INVARIANT: expected 8 active seed players, got %', v_player_count;
  END IF;

  SELECT COUNT(*)::INTEGER INTO v_dup_players
  FROM (
    SELECT lower(trim(p.display_name)) AS n
    FROM public.players AS p
    GROUP BY 1
    HAVING COUNT(*) > 1
  ) AS d;

  IF v_dup_players <> 0 THEN
    RAISE EXCEPTION 'SEED_INVARIANT: duplicate player display_name detected';
  END IF;

  SELECT COUNT(*)::INTEGER INTO v_missing_pin
  FROM public.players AS p
  WHERE p.id IN (
    '11111111-1111-1111-1111-111111111101',
    '11111111-1111-1111-1111-111111111102',
    '11111111-1111-1111-1111-111111111103',
    '11111111-1111-1111-1111-111111111104',
    '11111111-1111-1111-1111-111111111105',
    '11111111-1111-1111-1111-111111111106',
    '11111111-1111-1111-1111-111111111107',
    '11111111-1111-1111-1111-111111111108'
  )
    AND (p.pin_hash IS NULL OR length(trim(p.pin_hash)) = 0);

  IF v_missing_pin <> 0 THEN
    RAISE EXCEPTION 'SEED_INVARIANT: % seed players missing pin_hash', v_missing_pin;
  END IF;

  -- ---- Accès (présence / non-vide uniquement — jamais la valeur) ----
  SELECT
    EXISTS (
      SELECT 1
      FROM public.app_settings AS s
      WHERE s.key = 'access_code_hash'
        AND length(trim(s.value)) > 0
    ),
    EXISTS (
      SELECT 1
      FROM public.app_settings AS s
      WHERE s.key = 'admin_code_hash'
        AND length(trim(s.value)) > 0
    )
  INTO v_access_ok, v_admin_ok;

  IF NOT v_access_ok OR NOT v_admin_ok THEN
    RAISE EXCEPTION 'SEED_INVARIANT: access/admin code hashes missing or empty';
  END IF;

  -- ---- Matchs seed (7) ----
  SELECT COUNT(*)::INTEGER INTO v_match_count
  FROM public.matches AS m
  WHERE m.id IN (
    '22222222-2222-2222-2222-222222222201',
    '22222222-2222-2222-2222-222222222202',
    '22222222-2222-2222-2222-222222222205',
    '22222222-2222-2222-2222-222222222206',
    '22222222-2222-2222-2222-222222222203',
    '22222222-2222-2222-2222-222222222207',
    '22222222-2222-2222-2222-222222222204'
  )
    AND m.season_id = v_season_id
    AND m.source = 'manual';

  IF v_match_count <> 7 THEN
    RAISE EXCEPTION 'SEED_INVARIANT: expected 7 seed matches, got %', v_match_count;
  END IF;

  SELECT NOT EXISTS (
    SELECT 1
    FROM public.matches AS m
    WHERE m.id IN (
      '22222222-2222-2222-2222-222222222201',
      '22222222-2222-2222-2222-222222222202',
      '22222222-2222-2222-2222-222222222205',
      '22222222-2222-2222-2222-222222222206',
      '22222222-2222-2222-2222-222222222203',
      '22222222-2222-2222-2222-222222222207',
      '22222222-2222-2222-2222-222222222204'
    )
    AND EXISTS (
      SELECT 1
      FROM public.matches AS m2
      WHERE m2.id IN (
        '22222222-2222-2222-2222-222222222201',
        '22222222-2222-2222-2222-222222222202',
        '22222222-2222-2222-2222-222222222205',
        '22222222-2222-2222-2222-222222222206',
        '22222222-2222-2222-2222-222222222203',
        '22222222-2222-2222-2222-222222222207',
        '22222222-2222-2222-2222-222222222204'
      )
        AND m2.round_number < m.round_number
        AND m2.kickoff_at > m.kickoff_at
    )
  )
  INTO v_chrono_ok;

  IF NOT v_chrono_ok THEN
    RAISE EXCEPTION 'SEED_INVARIANT: seed match kickoff order inconsistent with round_number';
  END IF;

  -- J1–J3 finished with scores
  FOR r IN
    SELECT m.id, m.round_number, m.status, m.home_score, m.away_score,
           m.kickoff_time_confirmed, m.kickoff_at
    FROM public.matches AS m
    WHERE m.id IN (
      '22222222-2222-2222-2222-222222222201',
      '22222222-2222-2222-2222-222222222202',
      '22222222-2222-2222-2222-222222222205'
    )
  LOOP
    IF r.status <> 'finished'
       OR r.home_score IS NULL
       OR r.away_score IS NULL
       OR r.kickoff_time_confirmed IS NOT TRUE
       OR r.kickoff_at > v_now
    THEN
      RAISE EXCEPTION
        'SEED_INVARIANT: J% (%) must be finished+scored+confirmed+past',
        r.round_number, r.id;
    END IF;
  END LOOP;

  -- J4 locked-capable: scheduled, confirmed, past, no scores
  SELECT m.status, m.kickoff_time_confirmed, m.kickoff_at, m.home_score, m.away_score
  INTO r
  FROM public.matches AS m
  WHERE m.id = '22222222-2222-2222-2222-222222222206';

  IF r.status <> 'scheduled'
     OR r.kickoff_time_confirmed IS NOT TRUE
     OR r.kickoff_at > v_now
     OR r.home_score IS NOT NULL
     OR r.away_score IS NOT NULL
  THEN
    RAISE EXCEPTION 'SEED_INVARIANT: J4 locked fixture invalid';
  END IF;

  -- J5 next open: scheduled, confirmed, future
  SELECT m.status, m.kickoff_time_confirmed, m.kickoff_at, m.home_score
  INTO r
  FROM public.matches AS m
  WHERE m.id = '22222222-2222-2222-2222-222222222203';

  IF r.status <> 'scheduled'
     OR r.kickoff_time_confirmed IS NOT TRUE
     OR r.kickoff_at <= v_now
     OR r.home_score IS NOT NULL
  THEN
    RAISE EXCEPTION 'SEED_INVARIANT: J5 open fixture invalid';
  END IF;

  -- J6 future confirmed after J5
  SELECT m.status, m.kickoff_time_confirmed, m.kickoff_at
  INTO r
  FROM public.matches AS m
  WHERE m.id = '22222222-2222-2222-2222-222222222207';

  IF r.status <> 'scheduled'
     OR r.kickoff_time_confirmed IS NOT TRUE
     OR r.kickoff_at <= (
       SELECT m5.kickoff_at
       FROM public.matches AS m5
       WHERE m5.id = '22222222-2222-2222-2222-222222222203'
     )
  THEN
    RAISE EXCEPTION 'SEED_INVARIANT: J6 future fixture invalid (must be after J5)';
  END IF;

  -- J7 TBC
  SELECT m.status, m.kickoff_time_confirmed, m.kickoff_at
  INTO r
  FROM public.matches AS m
  WHERE m.id = '22222222-2222-2222-2222-222222222204';

  IF r.status <> 'scheduled'
     OR r.kickoff_time_confirmed IS NOT FALSE
     OR r.kickoff_at <= v_now
  THEN
    RAISE EXCEPTION 'SEED_INVARIANT: J7 TBC fixture invalid';
  END IF;

  -- ---- Pronostics ----
  SELECT COUNT(*)::INTEGER INTO v_pred_count
  FROM public.predictions AS pr
  WHERE pr.id::TEXT LIKE '33333333-3333-3333-3333-333333333%';

  IF v_pred_count <> 23 THEN
    RAISE EXCEPTION 'SEED_INVARIANT: expected 23 seed predictions, got %', v_pred_count;
  END IF;

  SELECT COUNT(*)::INTEGER INTO v_j67_preds
  FROM public.predictions AS pr
  WHERE pr.match_id IN (
    '22222222-2222-2222-2222-222222222207',
    '22222222-2222-2222-2222-222222222204'
  );

  IF v_j67_preds <> 0 THEN
    RAISE EXCEPTION 'SEED_INVARIANT: unexpected predictions on J6/J7';
  END IF;

  SELECT COUNT(*)::INTEGER INTO v_j13_null_points
  FROM public.predictions AS pr
  WHERE pr.match_id IN (
    '22222222-2222-2222-2222-222222222201',
    '22222222-2222-2222-2222-222222222202',
    '22222222-2222-2222-2222-222222222205'
  )
    AND pr.points IS NULL;

  IF v_j13_null_points <> 0 THEN
    RAISE EXCEPTION
      'SEED_INVARIANT: % J1-J3 predictions still have NULL points (recalc missing?)',
      v_j13_null_points;
  END IF;

  SELECT COUNT(*)::INTEGER INTO v_j45_scored
  FROM public.predictions AS pr
  WHERE pr.match_id IN (
    '22222222-2222-2222-2222-222222222206',
    '22222222-2222-2222-2222-222222222203'
  )
    AND pr.points IS NOT NULL;

  IF v_j45_scored <> 0 THEN
    RAISE EXCEPTION 'SEED_INVARIANT: J4/J5 predictions must keep points NULL';
  END IF;

  -- ---- Stats / trophées (produits par recalculate_season_achievements) ----
  SELECT COUNT(*)::INTEGER INTO v_stats_count
  FROM public.player_season_stats AS pss
  WHERE pss.season_id = v_season_id;

  IF v_stats_count < 1 THEN
    RAISE EXCEPTION 'SEED_INVARIANT: player_season_stats empty for active season';
  END IF;

  SELECT COUNT(*)::INTEGER INTO v_trophies_active
  FROM public.player_trophies AS pt
  WHERE pt.season_id = v_season_id
    AND pt.is_active = TRUE;

  IF v_trophies_active < 1 THEN
    RAISE EXCEPTION 'SEED_INVARIANT: no active player_trophies after recalc';
  END IF;

  SELECT COUNT(*)::INTEGER INTO v_stats_trophy_mismatch
  FROM public.player_season_stats AS pss
  WHERE pss.season_id = v_season_id
    AND pss.trophies_count IS DISTINCT FROM (
      SELECT COUNT(*)::INTEGER
      FROM public.player_trophies AS pt
      WHERE pt.season_id = pss.season_id
        AND pt.player_id = pss.player_id
        AND pt.is_active = TRUE
    );

  IF v_stats_trophy_mismatch <> 0 THEN
    RAISE EXCEPTION
      'SEED_INVARIANT: trophies_count mismatch for % player_season_stats rows',
      v_stats_trophy_mismatch;
  END IF;

  -- ---- Classement compétition 1,1,3,3,5,5,7,7 ----
  SELECT array_agg(ranked.comp_rank ORDER BY ranked.points DESC, ranked.exact_scores DESC, ranked.display_name ASC)
  INTO v_ranks
  FROM (
    SELECT
      totals.display_name,
      totals.points,
      totals.exact_scores,
      RANK() OVER (
        ORDER BY totals.points DESC, totals.exact_scores DESC, totals.display_name ASC
      ) AS comp_rank
    FROM (
      SELECT
        p.display_name,
        COALESCE(SUM(pr.points) FILTER (
          WHERE m.season_id = v_season_id AND pr.points IS NOT NULL
        ), 0)::BIGINT AS points,
        COALESCE(COUNT(*) FILTER (
          WHERE m.season_id = v_season_id AND pr.points = 3
        ), 0)::BIGINT AS exact_scores
      FROM public.players AS p
      LEFT JOIN public.predictions AS pr ON pr.player_id = p.id
      LEFT JOIN public.matches AS m ON m.id = pr.match_id
      WHERE p.is_active = TRUE
      GROUP BY p.id, p.display_name
    ) AS totals
  ) AS ranked;

  IF v_ranks IS DISTINCT FROM ARRAY[1, 1, 3, 3, 5, 5, 7, 7] THEN
    RAISE EXCEPTION 'SEED_INVARIANT: expected competition ranks 1,1,3,3,5,5,7,7 got %', v_ranks;
  END IF;

  -- ---- Reveal J1–J3 disponible (confirmed + kickoff passé) ----
  SELECT COUNT(*)::INTEGER INTO v_reveal_ok
  FROM public.matches AS m
  WHERE m.id IN (
    '22222222-2222-2222-2222-222222222201',
    '22222222-2222-2222-2222-222222222202',
    '22222222-2222-2222-2222-222222222205'
  )
    AND m.kickoff_time_confirmed = TRUE
    AND m.kickoff_at <= v_now;

  IF v_reveal_ok <> 3 THEN
    RAISE EXCEPTION 'SEED_INVARIANT: J1-J3 must be revealable (confirmed + past)';
  END IF;

  -- ---- J2 score le plus joué = 1-1 (unique top) ----
  SELECT sf.score_key, sf.cnt
  INTO v_j2_top_score, v_j2_top_count
  FROM (
    SELECT
      format('%s-%s', pr.predicted_home_score, pr.predicted_away_score) AS score_key,
      COUNT(*)::INTEGER AS cnt
    FROM public.predictions AS pr
    WHERE pr.match_id = '22222222-2222-2222-2222-222222222202'
    GROUP BY 1
  ) AS sf
  ORDER BY sf.cnt DESC, sf.score_key ASC
  LIMIT 1;

  SELECT COUNT(*)::INTEGER INTO v_j2_tied_tops
  FROM (
    SELECT COUNT(*)::INTEGER AS cnt
    FROM public.predictions AS pr
    WHERE pr.match_id = '22222222-2222-2222-2222-222222222202'
    GROUP BY format('%s-%s', pr.predicted_home_score, pr.predicted_away_score)
  ) AS c
  WHERE c.cnt = v_j2_top_count;

  IF v_j2_top_score IS DISTINCT FROM '1-1' OR v_j2_tied_tops <> 1 THEN
    RAISE EXCEPTION
      'SEED_INVARIANT: J2 most-played must be unique 1-1 (got % with % tops)',
      v_j2_top_score, v_j2_tied_tops;
  END IF;

  -- ---- J3 tendance POV Nantes = défaite ----
  -- Nantes = away on Guingamp–Nantes : défaite Nantes = prono home > away
  SELECT
    COUNT(*) FILTER (
      WHERE pr.predicted_home_score < pr.predicted_away_score
    )::INTEGER,
    COUNT(*) FILTER (
      WHERE pr.predicted_home_score > pr.predicted_away_score
    )::INTEGER,
    COUNT(*) FILTER (
      WHERE pr.predicted_home_score = pr.predicted_away_score
    )::INTEGER
  INTO v_j3_nantes_victory, v_j3_nantes_defeat, v_j3_draw
  FROM public.predictions AS pr
  WHERE pr.match_id = '22222222-2222-2222-2222-222222222205';

  IF NOT (
    v_j3_nantes_defeat > v_j3_nantes_victory
    AND v_j3_nantes_defeat > v_j3_draw
  ) THEN
    RAISE EXCEPTION
      'SEED_INVARIANT: J3 Nantes-POV tendency must be defeat (V=% D=% N=%)',
      v_j3_nantes_victory, v_j3_nantes_defeat, v_j3_draw;
  END IF;

  RAISE NOTICE 'SEED_INVARIANTS_OK';
END;
$$;
