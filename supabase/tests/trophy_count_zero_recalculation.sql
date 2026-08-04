-- Régression : trophies_count remis à 0 quand plus aucun trophée n'est actif.
-- Exécuter : BEGIN; \i supabase/tests/trophy_count_zero_recalculation.sql ; ROLLBACK;

BEGIN;

UPDATE public.app_settings
SET
  value = extensions.crypt('test-code-aln', extensions.gen_salt('bf')),
  updated_at = now()
WHERE key = 'access_code_hash';

INSERT INTO public.app_settings (key, value)
SELECT 'access_code_hash', extensions.crypt('test-code-aln', extensions.gen_salt('bf'))
WHERE NOT EXISTS (
  SELECT 1 FROM public.app_settings AS s WHERE s.key = 'access_code_hash'
);

DO $$
DECLARE
  v_season_id UUID := public.get_active_season_id();
  v_player_zero UUID := 'eeeeeeee-eeee-eeee-eeee-eeeeeeeeee51';
  v_player_keep UUID := 'eeeeeeee-eeee-eeee-eeee-eeeeeeeeee52';
  v_match_a UUID := 'ffffffff-ffff-ffff-ffff-fffffffff201';
  v_match_b UUID := 'ffffffff-ffff-ffff-ffff-fffffffff202';
  v_match_c UUID := 'ffffffff-ffff-ffff-ffff-fffffffff203';
  v_count INTEGER;
  v_trophies_count INTEGER;
  v_active_count INTEGER;
  v_inactive_count INTEGER;
  v_exact_before INTEGER;
  v_exact_after INTEGER;
  v_best_pred_before INTEGER;
  v_best_pred_after INTEGER;
  v_keep_count_before INTEGER;
  v_keep_count_after INTEGER;
  v_keep_active INTEGER;
  v_snapshot_a TEXT;
  v_snapshot_b TEXT;
BEGIN
  INSERT INTO public.players (id, display_name, is_active, created_at, pin_hash, must_change_pin)
  VALUES
    (v_player_zero, 'ZeroTrophy', TRUE, now() - interval '90 days', extensions.crypt('1234', extensions.gen_salt('bf')), FALSE),
    (v_player_keep, 'KeepTrophy', TRUE, now() - interval '90 days', extensions.crypt('1234', extensions.gen_salt('bf')), FALSE)
  ON CONFLICT (id) DO UPDATE
  SET
    display_name = EXCLUDED.display_name,
    is_active = TRUE,
    created_at = EXCLUDED.created_at,
    pin_hash = EXCLUDED.pin_hash,
    must_change_pin = FALSE,
    pin_failed_attempts = 0,
    pin_locked_until = NULL,
    pin_temporary_expires_at = NULL;

  INSERT INTO public.matches (
    id, season_id, external_id, round_number, home_team, away_team, kickoff_at,
    kickoff_time_confirmed, status, home_score, away_score
  ) VALUES
    (v_match_a, v_season_id, 'zero-trophy-a', 90, 'FC Nantes', 'Zero A', now() - interval '20 days', TRUE, 'finished', 2, 0),
    (v_match_b, v_season_id, 'zero-trophy-b', 90, 'Zero B', 'FC Nantes', now() - interval '19 days', TRUE, 'finished', 1, 1),
    (v_match_c, v_season_id, 'zero-trophy-c', 91, 'FC Nantes', 'Zero C', now() - interval '10 days', TRUE, 'finished', 3, 1)
  ON CONFLICT (id) DO UPDATE
  SET
    season_id = EXCLUDED.season_id,
    external_id = EXCLUDED.external_id,
    round_number = EXCLUDED.round_number,
    home_team = EXCLUDED.home_team,
    away_team = EXCLUDED.away_team,
    kickoff_at = EXCLUDED.kickoff_at,
    kickoff_time_confirmed = EXCLUDED.kickoff_time_confirmed,
    status = EXCLUDED.status,
    home_score = EXCLUDED.home_score,
    away_score = EXCLUDED.away_score;

  DELETE FROM public.predictions
  WHERE player_id IN (v_player_zero, v_player_keep)
     OR match_id IN (v_match_a, v_match_b, v_match_c);

  DELETE FROM public.player_trophies
  WHERE player_id IN (v_player_zero, v_player_keep)
    AND season_id = v_season_id;

  DELETE FROM public.player_season_stats
  WHERE player_id IN (v_player_zero, v_player_keep)
    AND season_id = v_season_id;

  -- Joueur "zero" : exact sur A + exact sur B => first_exact + double_precision (+ first_participation).
  -- Joueur "keep" : exact sur C => conserve au moins first_participation + first_exact après invalidation de zero.
  INSERT INTO public.predictions (player_id, match_id, predicted_home_score, predicted_away_score)
  VALUES
    (v_player_zero, v_match_a, 2, 0),
    (v_player_zero, v_match_b, 1, 1),
    (v_player_keep, v_match_c, 3, 1);

  -- 1-2) Premier recalcul : trophée(s) actifs et compteur > 0.
  PERFORM public.recalculate_season_achievements(v_season_id);

  SELECT COUNT(*)::INTEGER INTO v_active_count
  FROM public.player_trophies AS pt
  WHERE pt.player_id = v_player_zero
    AND pt.season_id = v_season_id
    AND pt.is_active = TRUE;

  IF v_active_count < 1 THEN
    RAISE EXCEPTION 'TEST FAIL: expected active trophies for zero player after first recalculation';
  END IF;

  SELECT pss.trophies_count, pss.total_exact_scores, pss.best_prediction_streak
  INTO v_trophies_count, v_exact_before, v_best_pred_before
  FROM public.player_season_stats AS pss
  WHERE pss.player_id = v_player_zero
    AND pss.season_id = v_season_id;

  IF v_trophies_count IS NULL OR v_trophies_count <= 0 THEN
    RAISE EXCEPTION 'TEST FAIL: trophies_count should be > 0 after earning trophies (got %)', v_trophies_count;
  END IF;

  IF v_trophies_count <> v_active_count THEN
    RAISE EXCEPTION 'TEST FAIL: trophies_count (%) should equal active trophies (%)', v_trophies_count, v_active_count;
  END IF;

  IF v_exact_before < 2 THEN
    RAISE EXCEPTION 'TEST FAIL: total_exact_scores should reflect two exact scores (got %)', v_exact_before;
  END IF;

  SELECT pss.trophies_count INTO v_keep_count_before
  FROM public.player_season_stats AS pss
  WHERE pss.player_id = v_player_keep
    AND pss.season_id = v_season_id;

  IF v_keep_count_before IS NULL OR v_keep_count_before <= 0 THEN
    RAISE EXCEPTION 'TEST FAIL: keep player should also have trophies_count > 0';
  END IF;

  -- 3) Corrige / supprime les sources : plus aucun trophée justifié pour zero.
  DELETE FROM public.predictions
  WHERE player_id = v_player_zero
    AND match_id IN (v_match_a, v_match_b);

  -- 4-5) Nouveau recalcul : invalidation + compteur à 0.
  PERFORM public.recalculate_season_achievements(v_season_id);

  SELECT COUNT(*)::INTEGER INTO v_active_count
  FROM public.player_trophies AS pt
  WHERE pt.player_id = v_player_zero
    AND pt.season_id = v_season_id
    AND pt.is_active = TRUE;

  IF v_active_count <> 0 THEN
    RAISE EXCEPTION 'TEST FAIL: no active trophy should remain for zero player (got %)', v_active_count;
  END IF;

  SELECT pss.trophies_count, pss.total_exact_scores, pss.best_prediction_streak
  INTO v_trophies_count, v_exact_after, v_best_pred_after
  FROM public.player_season_stats AS pss
  WHERE pss.player_id = v_player_zero
    AND pss.season_id = v_season_id;

  IF v_trophies_count <> 0 THEN
    RAISE EXCEPTION 'TEST FAIL: trophies_count must be exactly 0 after losing all trophies (got %)', v_trophies_count;
  END IF;

  IF v_exact_after <> 0 THEN
    RAISE EXCEPTION 'TEST FAIL: total_exact_scores should be 0 after predictions removed (got %)', v_exact_after;
  END IF;

  -- Séries cohérentes : plus de participations scorées pour ce joueur sur ces matchs.
  IF v_best_pred_after < 0 THEN
    RAISE EXCEPTION 'TEST FAIL: best_prediction_streak became negative';
  END IF;

  -- 6-7) Historique : trophées invalidés toujours présents.
  SELECT COUNT(*)::INTEGER INTO v_inactive_count
  FROM public.player_trophies AS pt
  WHERE pt.player_id = v_player_zero
    AND pt.season_id = v_season_id
    AND pt.is_active = FALSE
    AND pt.invalidation_reason = 'SEASON_RECALCULATED';

  IF v_inactive_count < 1 THEN
    RAISE EXCEPTION 'TEST FAIL: invalidated trophies should remain as history';
  END IF;

  -- 9) L'autre joueur conserve un compteur cohérent avec ses trophées actifs.
  SELECT COUNT(*)::INTEGER INTO v_keep_active
  FROM public.player_trophies AS pt
  WHERE pt.player_id = v_player_keep
    AND pt.season_id = v_season_id
    AND pt.is_active = TRUE;

  SELECT pss.trophies_count INTO v_keep_count_after
  FROM public.player_season_stats AS pss
  WHERE pss.player_id = v_player_keep
    AND pss.season_id = v_season_id;

  IF v_keep_active < 1 THEN
    RAISE EXCEPTION 'TEST FAIL: keep player should still have active trophies';
  END IF;

  IF v_keep_count_after <> v_keep_active THEN
    RAISE EXCEPTION 'TEST FAIL: keep player trophies_count (%) != active (%)', v_keep_count_after, v_keep_active;
  END IF;

  IF v_keep_count_after <> v_keep_count_before THEN
    RAISE EXCEPTION 'TEST FAIL: keep player trophies_count changed unexpectedly (% -> %)',
      v_keep_count_before, v_keep_count_after;
  END IF;

  SELECT string_agg(
    format(
      '%s:%s:%s:%s:%s:%s:%s:%s:%s',
      pt.award_key,
      pt.is_active,
      pt.invalidated_at IS NOT NULL,
      COALESCE(pt.invalidation_reason, ''),
      pss.trophies_count,
      pss.total_exact_scores,
      pss.current_prediction_streak,
      pss.best_prediction_streak,
      pss.best_exact_streak
    ),
    '|'
    ORDER BY pt.award_key
  )
  INTO v_snapshot_a
  FROM public.player_trophies AS pt
  INNER JOIN public.player_season_stats AS pss
    ON pss.player_id = pt.player_id
   AND pss.season_id = pt.season_id
  WHERE pt.player_id IN (v_player_zero, v_player_keep)
    AND pt.season_id = v_season_id;

  -- 8) Second recalcul : état strictement identique (idempotence).
  PERFORM public.recalculate_season_achievements(v_season_id);

  SELECT string_agg(
    format(
      '%s:%s:%s:%s:%s:%s:%s:%s:%s',
      pt.award_key,
      pt.is_active,
      pt.invalidated_at IS NOT NULL,
      COALESCE(pt.invalidation_reason, ''),
      pss.trophies_count,
      pss.total_exact_scores,
      pss.current_prediction_streak,
      pss.best_prediction_streak,
      pss.best_exact_streak
    ),
    '|'
    ORDER BY pt.award_key
  )
  INTO v_snapshot_b
  FROM public.player_trophies AS pt
  INNER JOIN public.player_season_stats AS pss
    ON pss.player_id = pt.player_id
   AND pss.season_id = pt.season_id
  WHERE pt.player_id IN (v_player_zero, v_player_keep)
    AND pt.season_id = v_season_id;

  IF v_snapshot_a IS DISTINCT FROM v_snapshot_b THEN
    RAISE EXCEPTION 'TEST FAIL: second recalculation changed trophy/stats state';
  END IF;

  SELECT pss.trophies_count INTO v_trophies_count
  FROM public.player_season_stats AS pss
  WHERE pss.player_id = v_player_zero
    AND pss.season_id = v_season_id;

  IF v_trophies_count <> 0 THEN
    RAISE EXCEPTION 'TEST FAIL: trophies_count must stay 0 after idempotent recalculation';
  END IF;

  SELECT COUNT(*)::INTEGER INTO v_count
  FROM public.player_trophies AS pt
  WHERE pt.player_id = v_player_zero
    AND pt.season_id = v_season_id
    AND pt.is_active = TRUE;

  IF v_count <> 0 THEN
    RAISE EXCEPTION 'TEST FAIL: active trophies reappeared after idempotent recalculation';
  END IF;
END;
$$;

ROLLBACK;
