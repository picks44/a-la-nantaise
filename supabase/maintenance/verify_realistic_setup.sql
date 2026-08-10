-- =============================================================================
-- À la Nantaise — invariants du setup local réaliste (lecture seule)
-- Fichier : supabase/maintenance/verify_realistic_setup.sql
-- =============================================================================
-- Prérequis : stack DEV après `npm run db:setup:realistic -- --yes`
--   (ports 54xxx, project_id a-la-nantaise).
-- Contrat : 34 matchs Fixture Download, 0 manual, 0 prediction, 8 joueurs seed.
-- Aucune écriture. Aucun secret affiché.
-- =============================================================================

DO $$
DECLARE
  v_season_id UUID;
  v_player_count INTEGER;
  v_match_total INTEGER;
  v_fd_count INTEGER;
  v_manual_count INTEGER;
  v_seed_j_count INTEGER;
  v_pred_count INTEGER;
  v_external_id_count INTEGER;
  v_round_count INTEGER;
  v_missing_round INTEGER;
  v_dup_external INTEGER;
BEGIN
  v_season_id := public.get_active_season_id();

  IF v_season_id IS NULL THEN
    RAISE EXCEPTION 'REALISTIC_INVARIANT: active season missing';
  END IF;

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
      'REALISTIC_INVARIANT: expected 8 active seed players, got %',
      v_player_count;
  END IF;

  SELECT COUNT(*)::INTEGER INTO v_match_total FROM public.matches;
  SELECT COUNT(*)::INTEGER INTO v_fd_count
  FROM public.matches AS m
  WHERE m.source = 'fixturedownload';
  SELECT COUNT(*)::INTEGER INTO v_manual_count
  FROM public.matches AS m
  WHERE m.source = 'manual';
  SELECT COUNT(*)::INTEGER INTO v_seed_j_count
  FROM public.matches AS m
  WHERE m.external_id LIKE 'seed-j%';
  SELECT COUNT(*)::INTEGER INTO v_pred_count FROM public.predictions;

  IF v_fd_count <> 34 THEN
    RAISE EXCEPTION
      'REALISTIC_INVARIANT: expected 34 fixturedownload matches, got %',
      v_fd_count;
  END IF;

  IF v_match_total <> 34 THEN
    RAISE EXCEPTION
      'REALISTIC_INVARIANT: expected exactly 34 matches total, got %',
      v_match_total;
  END IF;

  IF v_manual_count <> 0 THEN
    RAISE EXCEPTION
      'REALISTIC_INVARIANT: expected 0 manual matches, got %',
      v_manual_count;
  END IF;

  IF v_seed_j_count <> 0 THEN
    RAISE EXCEPTION
      'REALISTIC_INVARIANT: unexpected seed-j* external_id rows: %',
      v_seed_j_count;
  END IF;

  IF v_pred_count <> 0 THEN
    RAISE EXCEPTION
      'REALISTIC_INVARIANT: expected 0 predictions in S2 setup, got %',
      v_pred_count;
  END IF;

  SELECT COUNT(DISTINCT m.external_id)::INTEGER INTO v_external_id_count
  FROM public.matches AS m
  WHERE m.source = 'fixturedownload'
    AND m.external_id IS NOT NULL
    AND length(trim(m.external_id)) > 0;

  IF v_external_id_count <> 34 THEN
    RAISE EXCEPTION
      'REALISTIC_INVARIANT: expected 34 distinct external_id, got %',
      v_external_id_count;
  END IF;

  SELECT COUNT(*)::INTEGER INTO v_dup_external
  FROM (
    SELECT m.external_id
    FROM public.matches AS m
    WHERE m.source = 'fixturedownload'
    GROUP BY m.external_id
    HAVING COUNT(*) > 1
  ) AS d;

  IF v_dup_external <> 0 THEN
    RAISE EXCEPTION
      'REALISTIC_INVARIANT: duplicate fixturedownload external_id groups: %',
      v_dup_external;
  END IF;

  SELECT COUNT(DISTINCT m.round_number)::INTEGER INTO v_round_count
  FROM public.matches AS m
  WHERE m.source = 'fixturedownload';

  IF v_round_count <> 34 THEN
    RAISE EXCEPTION
      'REALISTIC_INVARIANT: expected 34 distinct rounds, got %',
      v_round_count;
  END IF;

  SELECT COUNT(*)::INTEGER INTO v_missing_round
  FROM generate_series(1, 34) AS g(round_number)
  WHERE NOT EXISTS (
    SELECT 1
    FROM public.matches AS m
    WHERE m.source = 'fixturedownload'
      AND m.round_number = g.round_number
  );

  IF v_missing_round <> 0 THEN
    RAISE EXCEPTION
      'REALISTIC_INVARIANT: missing rounds in 1..34: %',
      v_missing_round;
  END IF;

  RAISE NOTICE 'REALISTIC_SETUP_OK';
END;
$$;
