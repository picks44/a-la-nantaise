-- =============================================================================
-- À la Nantaise — pronostics de développement (stack DEV, post-S2)
-- Fichier : supabase/seed-dev-predictions.sql
-- =============================================================================
-- Prérequis : 34 matchs source=fixturedownload (npm run db:setup:realistic).
-- Ciblage UNIQUEMENT via source + external_id. Aucun UUID match hardcodé.
-- Aucun INSERT/UPDATE sur public.matches.
-- points = NULL ; scoring via recalculate_season_achievements uniquement.
-- Idempotent : ON CONFLICT (player_id, match_id) DO UPDATE.
-- =============================================================================

DO $$
DECLARE
  v_fd_count INTEGER;
  v_match_j1 UUID;
  v_match_j2 UUID;
  v_match_j3 UUID;
  v_ko_j1 TIMESTAMPTZ;
  v_ko_j2 TIMESTAMPTZ;
  v_ko_j3 TIMESTAMPTZ;
  v_season_id UUID;
  v_inserted INTEGER := 0;
BEGIN
  SELECT COUNT(*)::INTEGER INTO v_fd_count
  FROM public.matches AS m
  WHERE m.source = 'fixturedownload';

  IF v_fd_count <> 34 THEN
    RAISE EXCEPTION
      'DEV_PREDICTIONS_ABORT: expected 34 fixturedownload matches (run npm run db:setup:realistic -- --yes first), got %',
      v_fd_count;
  END IF;

  SELECT m.id, m.kickoff_at
  INTO v_match_j1, v_ko_j1
  FROM public.matches AS m
  WHERE m.source = 'fixturedownload'
    AND m.external_id = 'fixturedownload:ligue-2-2026:6';

  IF v_match_j1 IS NULL THEN
    RAISE EXCEPTION
      'DEV_PREDICTIONS_ABORT: missing match external_id=fixturedownload:ligue-2-2026:6';
  END IF;

  SELECT m.id, m.kickoff_at
  INTO v_match_j2, v_ko_j2
  FROM public.matches AS m
  WHERE m.source = 'fixturedownload'
    AND m.external_id = 'fixturedownload:ligue-2-2026:14';

  IF v_match_j2 IS NULL THEN
    RAISE EXCEPTION
      'DEV_PREDICTIONS_ABORT: missing match external_id=fixturedownload:ligue-2-2026:14';
  END IF;

  SELECT m.id, m.kickoff_at
  INTO v_match_j3, v_ko_j3
  FROM public.matches AS m
  WHERE m.source = 'fixturedownload'
    AND m.external_id = 'fixturedownload:ligue-2-2026:25';

  IF v_match_j3 IS NULL THEN
    RAISE EXCEPTION
      'DEV_PREDICTIONS_ABORT: missing match external_id=fixturedownload:ligue-2-2026:25';
  END IF;

  -- ---- J1 Nantes–Red Star (locked / reveal) : 6 pronos ----
  INSERT INTO public.predictions (
    player_id,
    match_id,
    predicted_home_score,
    predicted_away_score,
    points,
    created_at,
    updated_at
  )
  VALUES
    (
      '11111111-1111-1111-1111-111111111101',
      v_match_j1, 2, 0, NULL,
      v_ko_j1 - interval '1 day',
      v_ko_j1 - interval '1 day'
    ),
    (
      '11111111-1111-1111-1111-111111111102',
      v_match_j1, 1, 0, NULL,
      v_ko_j1 - interval '1 day',
      v_ko_j1 - interval '1 day'
    ),
    (
      '11111111-1111-1111-1111-111111111103',
      v_match_j1, 1, 1, NULL,
      v_ko_j1 - interval '1 day',
      v_ko_j1 - interval '1 day'
    ),
    (
      '11111111-1111-1111-1111-111111111104',
      v_match_j1, 0, 1, NULL,
      v_ko_j1 - interval '1 day',
      v_ko_j1 - interval '1 day'
    ),
    (
      '11111111-1111-1111-1111-111111111105',
      v_match_j1, 2, 1, NULL,
      v_ko_j1 - interval '1 day',
      v_ko_j1 - interval '1 day'
    ),
    (
      '11111111-1111-1111-1111-111111111107',
      v_match_j1, 0, 0, NULL,
      v_ko_j1 - interval '1 day',
      v_ko_j1 - interval '1 day'
    )
  ON CONFLICT (player_id, match_id) DO UPDATE
  SET
    predicted_home_score = EXCLUDED.predicted_home_score,
    predicted_away_score = EXCLUDED.predicted_away_score,
    updated_at = EXCLUDED.updated_at;

  GET DIAGNOSTICS v_inserted = ROW_COUNT;

  -- ---- J2 Laval–Nantes (prochain) : 3 pronos ----
  INSERT INTO public.predictions (
    player_id,
    match_id,
    predicted_home_score,
    predicted_away_score,
    points,
    created_at,
    updated_at
  )
  VALUES
    (
      '11111111-1111-1111-1111-111111111101',
      v_match_j2, 1, 2, NULL,
      v_ko_j2 - interval '1 day',
      v_ko_j2 - interval '1 day'
    ),
    (
      '11111111-1111-1111-1111-111111111102',
      v_match_j2, 0, 1, NULL,
      v_ko_j2 - interval '1 day',
      v_ko_j2 - interval '1 day'
    ),
    (
      '11111111-1111-1111-1111-111111111104',
      v_match_j2, 1, 1, NULL,
      v_ko_j2 - interval '1 day',
      v_ko_j2 - interval '1 day'
    )
  ON CONFLICT (player_id, match_id) DO UPDATE
  SET
    predicted_home_score = EXCLUDED.predicted_home_score,
    predicted_away_score = EXCLUDED.predicted_away_score,
    updated_at = EXCLUDED.updated_at;

  -- ---- J3 Nantes–Rodez (futur ensuite) : 1 prono ----
  INSERT INTO public.predictions (
    player_id,
    match_id,
    predicted_home_score,
    predicted_away_score,
    points,
    created_at,
    updated_at
  )
  VALUES
    (
      '11111111-1111-1111-1111-111111111101',
      v_match_j3, 2, 0, NULL,
      v_ko_j3 - interval '1 day',
      v_ko_j3 - interval '1 day'
    )
  ON CONFLICT (player_id, match_id) DO UPDATE
  SET
    predicted_home_score = EXCLUDED.predicted_home_score,
    predicted_away_score = EXCLUDED.predicted_away_score,
    updated_at = EXCLUDED.updated_at;

  -- Cohérence moteur (points NULL tant que non finished ; pas de trophées inventés).
  v_season_id := public.get_active_season_id();
  PERFORM public.recalculate_season_achievements(v_season_id);

  RAISE NOTICE 'DEV_PREDICTIONS_SEEDED';
END;
$$;
