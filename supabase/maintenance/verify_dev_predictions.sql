-- =============================================================================
-- À la Nantaise — invariants post seed-dev-predictions (lecture seule)
-- Fichier : supabase/maintenance/verify_dev_predictions.sql
-- =============================================================================
-- Prérequis : stack DEV après S2 + npm run db:seed:predictions:local
-- Aucune écriture. Aucun secret affiché.
-- =============================================================================

DO $$
DECLARE
  v_player_count INTEGER;
  v_fd_count INTEGER;
  v_manual_count INTEGER;
  v_seed_j_count INTEGER;
  v_pred_count INTEGER;
  v_orphan_count INTEGER;
  v_non_fd_count INTEGER;
  v_scored_unfinished INTEGER;
  v_expected INTEGER := 10;
BEGIN
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
    RAISE EXCEPTION
      'DEV_PRED_INVARIANT: expected 8 active seed players, got %',
      v_player_count;
  END IF;

  SELECT COUNT(*)::INTEGER INTO v_fd_count
  FROM public.matches AS m
  WHERE m.source = 'fixturedownload';

  SELECT COUNT(*)::INTEGER INTO v_manual_count
  FROM public.matches AS m
  WHERE m.source = 'manual';

  SELECT COUNT(*)::INTEGER INTO v_seed_j_count
  FROM public.matches AS m
  WHERE m.external_id LIKE 'seed-j%';

  IF v_fd_count <> 34 THEN
    RAISE EXCEPTION
      'DEV_PRED_INVARIANT: expected 34 fixturedownload matches, got %',
      v_fd_count;
  END IF;

  IF v_manual_count <> 0 THEN
    RAISE EXCEPTION
      'DEV_PRED_INVARIANT: expected 0 manual matches, got %',
      v_manual_count;
  END IF;

  IF v_seed_j_count <> 0 THEN
    RAISE EXCEPTION
      'DEV_PRED_INVARIANT: unexpected seed-j* rows: %',
      v_seed_j_count;
  END IF;

  SELECT COUNT(*)::INTEGER INTO v_pred_count FROM public.predictions;

  IF v_pred_count <> v_expected THEN
    RAISE EXCEPTION
      'DEV_PRED_INVARIANT: expected % predictions, got %',
      v_expected, v_pred_count;
  END IF;

  SELECT COUNT(*)::INTEGER INTO v_orphan_count
  FROM public.predictions AS pr
  WHERE NOT EXISTS (
    SELECT 1 FROM public.matches AS m WHERE m.id = pr.match_id
  );

  IF v_orphan_count <> 0 THEN
    RAISE EXCEPTION
      'DEV_PRED_INVARIANT: % orphan predictions',
      v_orphan_count;
  END IF;

  SELECT COUNT(*)::INTEGER INTO v_non_fd_count
  FROM public.predictions AS pr
  JOIN public.matches AS m ON m.id = pr.match_id
  WHERE m.source IS DISTINCT FROM 'fixturedownload';

  IF v_non_fd_count <> 0 THEN
    RAISE EXCEPTION
      'DEV_PRED_INVARIANT: % predictions on non-fixturedownload matches',
      v_non_fd_count;
  END IF;

  SELECT COUNT(*)::INTEGER INTO v_scored_unfinished
  FROM public.predictions AS pr
  JOIN public.matches AS m ON m.id = pr.match_id
  WHERE m.status IS DISTINCT FROM 'finished'
    AND pr.points IS NOT NULL;

  IF v_scored_unfinished <> 0 THEN
    RAISE EXCEPTION
      'DEV_PRED_INVARIANT: % predictions have points on non-finished matches',
      v_scored_unfinished;
  END IF;

  RAISE NOTICE 'DEV_PREDICTIONS_OK';
END;
$$;
