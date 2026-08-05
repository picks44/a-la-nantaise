-- Tests SQL : fondation classement / récap / timeline (docs/rpc-round-foundation.md)
-- Exécuter : BEGIN; \i supabase/tests/round_foundation_rpcs.sql ; ROLLBACK;
-- Prérequis : migrations jusqu’à 20260805100000 appliquées.

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

-- ---------------------------------------------------------------------------
-- Données de test
-- ---------------------------------------------------------------------------

DO $$
DECLARE
  v_season_id UUID := public.get_active_season_id();
  v_match_corr UUID := 'aaaaaaaa-bbbb-cccc-eeee-000000000401';
BEGIN
  -- Joueurs
  INSERT INTO public.players (id, display_name, is_active, created_at, pin_hash, must_change_pin)
  VALUES
    ('aaaaaaaa-bbbb-cccc-dddd-000000000001', 'Alice', TRUE, now() - interval '120 days', extensions.crypt('1234', extensions.gen_salt('bf')), FALSE),
    ('aaaaaaaa-bbbb-cccc-dddd-000000000002', 'Bob', TRUE, now() - interval '120 days', extensions.crypt('1234', extensions.gen_salt('bf')), FALSE),
    ('aaaaaaaa-bbbb-cccc-dddd-000000000003', 'Diane', TRUE, now() - interval '120 days', extensions.crypt('1234', extensions.gen_salt('bf')), FALSE),
    ('aaaaaaaa-bbbb-cccc-dddd-000000000004', 'Edouard', TRUE, now() - interval '120 days', extensions.crypt('1234', extensions.gen_salt('bf')), FALSE),
    ('aaaaaaaa-bbbb-cccc-dddd-000000000005', 'Fifi', TRUE, now() - interval '120 days', extensions.crypt('1234', extensions.gen_salt('bf')), FALSE),
    ('aaaaaaaa-bbbb-cccc-dddd-000000000006', 'Gigi', TRUE, now() - interval '120 days', extensions.crypt('1234', extensions.gen_salt('bf')), FALSE),
    ('aaaaaaaa-bbbb-cccc-dddd-000000000007', 'Hugo', TRUE, now() - interval '120 days', extensions.crypt('1234', extensions.gen_salt('bf')), FALSE),
    ('aaaaaaaa-bbbb-cccc-dddd-000000000008', 'Ivy', TRUE, now() - interval '120 days', extensions.crypt('1234', extensions.gen_salt('bf')), FALSE),
    ('aaaaaaaa-bbbb-cccc-dddd-000000000009', 'Kappa', TRUE, now() - interval '120 days', extensions.crypt('1234', extensions.gen_salt('bf')), FALSE),
    ('aaaaaaaa-bbbb-cccc-dddd-00000000000a', 'Lambda', TRUE, now() - interval '120 days', extensions.crypt('1234', extensions.gen_salt('bf')), FALSE),
    ('aaaaaaaa-bbbb-cccc-dddd-00000000000b', 'Milo', TRUE, now() - interval '120 days', extensions.crypt('1234', extensions.gen_salt('bf')), FALSE),
    ('aaaaaaaa-bbbb-cccc-dddd-00000000000c', 'NewPlayer', TRUE, now() - interval '10 minutes', extensions.crypt('1234', extensions.gen_salt('bf')), FALSE)
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

  DELETE FROM public.predictions
  WHERE player_id IN (
    SELECT id FROM public.players WHERE id::TEXT LIKE 'aaaaaaaa-bbbb-cccc-dddd-%'
  );

  DELETE FROM public.matches
  WHERE id::TEXT LIKE 'aaaaaaaa-bbbb-cccc-eeee-%';

  DELETE FROM public.player_sessions
  WHERE player_id IN (
    SELECT id FROM public.players WHERE id::TEXT LIKE 'aaaaaaaa-bbbb-cccc-dddd-%'
  );

  -- Round 10 : as-of ties (1,1,3,4) + gapToPrevious (Alice/Bob/Diane/Edouard)
  INSERT INTO public.matches (
    id, season_id, external_id, round_number, home_team, away_team, kickoff_at,
    kickoff_time_confirmed, status, home_score, away_score
  ) VALUES
    ('aaaaaaaa-bbbb-cccc-eeee-000000000101', v_season_id, 'rf-r10-a', 10, 'FC Nantes', 'Round10 A', now() - interval '100 days', TRUE, 'finished', 2, 1),
    ('aaaaaaaa-bbbb-cccc-eeee-000000000102', v_season_id, 'rf-r10-b', 10, 'Round10 B', 'FC Nantes', now() - interval '99 days', TRUE, 'finished', 1, 0),
    ('aaaaaaaa-bbbb-cccc-eeee-000000000103', v_season_id, 'rf-r10-c', 10, 'FC Nantes', 'Round10 C', now() - interval '98 days', TRUE, 'finished', 3, 0),
    ('aaaaaaaa-bbbb-cccc-eeee-000000000104', v_season_id, 'rf-r10-d', 10, 'Round10 D', 'FC Nantes', now() - interval '97 days', TRUE, 'finished', 1, 1),
    ('aaaaaaaa-bbbb-cccc-eeee-000000000105', v_season_id, 'rf-r10-e', 10, 'FC Nantes', 'Round10 E', now() - interval '96 days', TRUE, 'finished', 0, 0);

  INSERT INTO public.predictions (player_id, match_id, predicted_home_score, predicted_away_score, points)
  VALUES
    ('aaaaaaaa-bbbb-cccc-dddd-000000000001', 'aaaaaaaa-bbbb-cccc-eeee-000000000101', 2, 1, 3),
    ('aaaaaaaa-bbbb-cccc-dddd-000000000001', 'aaaaaaaa-bbbb-cccc-eeee-000000000102', 1, 0, 3),
    ('aaaaaaaa-bbbb-cccc-dddd-000000000001', 'aaaaaaaa-bbbb-cccc-eeee-000000000103', 3, 0, 3),
    ('aaaaaaaa-bbbb-cccc-dddd-000000000002', 'aaaaaaaa-bbbb-cccc-eeee-000000000101', 2, 1, 3),
    ('aaaaaaaa-bbbb-cccc-dddd-000000000002', 'aaaaaaaa-bbbb-cccc-eeee-000000000102', 1, 0, 3),
    ('aaaaaaaa-bbbb-cccc-dddd-000000000002', 'aaaaaaaa-bbbb-cccc-eeee-000000000103', 3, 0, 3),
    ('aaaaaaaa-bbbb-cccc-dddd-000000000004', 'aaaaaaaa-bbbb-cccc-eeee-000000000101', 2, 1, 3),
    ('aaaaaaaa-bbbb-cccc-dddd-000000000004', 'aaaaaaaa-bbbb-cccc-eeee-000000000102', 1, 1, 1),
    ('aaaaaaaa-bbbb-cccc-dddd-000000000004', 'aaaaaaaa-bbbb-cccc-eeee-000000000103', 2, 0, 1),
    ('aaaaaaaa-bbbb-cccc-dddd-000000000003', 'aaaaaaaa-bbbb-cccc-eeee-000000000101', 2, 1, 3),
    ('aaaaaaaa-bbbb-cccc-dddd-000000000003', 'aaaaaaaa-bbbb-cccc-eeee-000000000102', 1, 0, 3),
    ('aaaaaaaa-bbbb-cccc-dddd-000000000003', 'aaaaaaaa-bbbb-cccc-eeee-000000000104', 1, 1, 1),
    ('aaaaaaaa-bbbb-cccc-dddd-000000000003', 'aaaaaaaa-bbbb-cccc-eeee-000000000105', 0, 0, 1),
    ('aaaaaaaa-bbbb-cccc-dddd-000000000003', 'aaaaaaaa-bbbb-cccc-eeee-000000000103', 2, 0, 1);
  -- Alice = 9pts/3exact ; Bob = 9pts/3exact (tie rank 1) ; Diane = 9pts/2exact (rank 3, gap 0)
  -- Edouard = 5pts/1exact (rank 4, gap 4)

  -- Round 31 : journée entièrement annulée → open
  INSERT INTO public.matches (
    id, season_id, external_id, round_number, home_team, away_team, kickoff_at,
    kickoff_time_confirmed, status, home_score, away_score
  ) VALUES
    ('aaaaaaaa-bbbb-cccc-eeee-000000000311', v_season_id, 'rf-r31-a', 31, 'FC Nantes', 'Round31 A', now() + interval '5 days', TRUE, 'cancelled', NULL, NULL),
    ('aaaaaaaa-bbbb-cccc-eeee-000000000312', v_season_id, 'rf-r31-b', 31, 'Round31 B', 'FC Nantes', now() + interval '6 days', TRUE, 'cancelled', NULL, NULL);

  -- Round 32 : postponed empêche completed (2 finished + 1 postponed)
  INSERT INTO public.matches (
    id, season_id, external_id, round_number, home_team, away_team, kickoff_at,
    kickoff_time_confirmed, status, home_score, away_score
  ) VALUES
    ('aaaaaaaa-bbbb-cccc-eeee-000000000321', v_season_id, 'rf-r32-a', 32, 'FC Nantes', 'Round32 A', now() - interval '60 days', TRUE, 'finished', 1, 0),
    ('aaaaaaaa-bbbb-cccc-eeee-000000000322', v_season_id, 'rf-r32-b', 32, 'Round32 B', 'FC Nantes', now() - interval '59 days', TRUE, 'finished', 2, 2),
    ('aaaaaaaa-bbbb-cccc-eeee-000000000323', v_season_id, 'rf-r32-c', 32, 'FC Nantes', 'Round32 C', now() - interval '58 days', TRUE, 'postponed', NULL, NULL);

  -- Round 33 : provisoire, 1 finished + 2 à venir
  INSERT INTO public.matches (
    id, season_id, external_id, round_number, home_team, away_team, kickoff_at,
    kickoff_time_confirmed, status, home_score, away_score
  ) VALUES
    ('aaaaaaaa-bbbb-cccc-eeee-000000000331', v_season_id, 'rf-r33-a', 33, 'FC Nantes', 'Round33 A', now() - interval '55 days', TRUE, 'finished', 1, 1),
    ('aaaaaaaa-bbbb-cccc-eeee-000000000332', v_season_id, 'rf-r33-b', 33, 'Round33 B', 'FC Nantes', now() + interval '10 days', TRUE, 'scheduled', NULL, NULL),
    ('aaaaaaaa-bbbb-cccc-eeee-000000000333', v_season_id, 'rf-r33-c', 33, 'FC Nantes', 'Round33 C', now() + interval '11 days', TRUE, 'scheduled', NULL, NULL);

  -- Round 34 : completed (2/2 finished)
  INSERT INTO public.matches (
    id, season_id, external_id, round_number, home_team, away_team, kickoff_at,
    kickoff_time_confirmed, status, home_score, away_score
  ) VALUES
    ('aaaaaaaa-bbbb-cccc-eeee-000000000341', v_season_id, 'rf-r34-a', 34, 'FC Nantes', 'Round34 A', now() - interval '50 days', TRUE, 'finished', 2, 0),
    ('aaaaaaaa-bbbb-cccc-eeee-000000000342', v_season_id, 'rf-r34-b', 34, 'Round34 B', 'FC Nantes', now() - interval '49 days', TRUE, 'finished', 1, 1);

  -- Round 40 : correction de score (points ajustés directement, sans toucher
  -- au reste de la saison — recalculate_points_for_match recalcule TOUTE la
  -- saison via recalculate_season_achievements, ce qui écraserait les points
  -- fixés manuellement pour les autres scénarios de ce fichier).
  INSERT INTO public.matches (
    id, season_id, external_id, round_number, home_team, away_team, kickoff_at,
    kickoff_time_confirmed, status, home_score, away_score
  ) VALUES
    (v_match_corr, v_season_id, 'rf-r40-corr', 40, 'FC Nantes', 'Round40 Corr', now() - interval '45 days', TRUE, 'finished', 2, 1);

  INSERT INTO public.predictions (player_id, match_id, predicted_home_score, predicted_away_score, points)
  VALUES
    ('aaaaaaaa-bbbb-cccc-dddd-000000000005', v_match_corr, 2, 1, 3), -- Fifi : exact sur 2-1
    ('aaaaaaaa-bbbb-cccc-dddd-000000000006', v_match_corr, 1, 0, 1); -- Gigi : victoire dom. correcte sur 2-1

  -- Round 41 : champions excluent les non-participants
  INSERT INTO public.matches (
    id, season_id, external_id, round_number, home_team, away_team, kickoff_at,
    kickoff_time_confirmed, status, home_score, away_score
  ) VALUES
    ('aaaaaaaa-bbbb-cccc-eeee-000000000411', v_season_id, 'rf-r41-a', 41, 'FC Nantes', 'Round41 A', now() - interval '40 days', TRUE, 'finished', 2, 0);

  INSERT INTO public.predictions (player_id, match_id, predicted_home_score, predicted_away_score, points)
  VALUES
    ('aaaaaaaa-bbbb-cccc-dddd-000000000007', 'aaaaaaaa-bbbb-cccc-eeee-000000000411', 2, 0, 3);
  -- Ivy (active) ne pronostique pas ce match : non-participante.

  -- Round 50 / 52 : classement vivant ≠ as-of(round de référence)
  INSERT INTO public.matches (
    id, season_id, external_id, round_number, home_team, away_team, kickoff_at,
    kickoff_time_confirmed, status, home_score, away_score
  ) VALUES
    ('aaaaaaaa-bbbb-cccc-eeee-000000000501', v_season_id, 'rf-r50-finished', 50, 'FC Nantes', 'Round50 Finished', now() - interval '3 days', TRUE, 'finished', 1, 0),
    ('aaaaaaaa-bbbb-cccc-eeee-000000000502', v_season_id, 'rf-r50-future', 50, 'Round50 Future', 'FC Nantes', now() + interval '30 days', TRUE, 'scheduled', NULL, NULL),
    ('aaaaaaaa-bbbb-cccc-eeee-000000000521', v_season_id, 'rf-r52-finished', 52, 'FC Nantes', 'Round52 Finished', now() - interval '20 days', TRUE, 'finished', 1, 0),
    ('aaaaaaaa-bbbb-cccc-eeee-000000000522', v_season_id, 'rf-r52-future', 52, 'Round52 Future', 'FC Nantes', now() + interval '31 days', TRUE, 'scheduled', NULL, NULL);

  INSERT INTO public.predictions (player_id, match_id, predicted_home_score, predicted_away_score, points)
  VALUES
    ('aaaaaaaa-bbbb-cccc-dddd-000000000009', 'aaaaaaaa-bbbb-cccc-eeee-000000000501', 1, 0, 3), -- Kappa
    ('aaaaaaaa-bbbb-cccc-dddd-00000000000a', 'aaaaaaaa-bbbb-cccc-eeee-000000000521', 1, 0, 3); -- Lambda

  -- Round 60 : récap non-participation (Milo)
  INSERT INTO public.matches (
    id, season_id, external_id, round_number, home_team, away_team, kickoff_at,
    kickoff_time_confirmed, status, home_score, away_score
  ) VALUES
    ('aaaaaaaa-bbbb-cccc-eeee-000000000601', v_season_id, 'rf-r60-a', 60, 'FC Nantes', 'Round60 A', now() - interval '15 days', TRUE, 'finished', 2, 2);
  -- Milo ne pronostique pas.

  -- Round 70 : nouveau joueur, rankBefore null / rankAfter réel
  INSERT INTO public.matches (
    id, season_id, external_id, round_number, home_team, away_team, kickoff_at,
    kickoff_time_confirmed, status, home_score, away_score
  ) VALUES
    ('aaaaaaaa-bbbb-cccc-eeee-000000000701', v_season_id, 'rf-r70-a', 70, 'FC Nantes', 'Round70 A', now() - interval '1 hour', TRUE, 'finished', 1, 0);

  INSERT INTO public.predictions (player_id, match_id, predicted_home_score, predicted_away_score, points)
  VALUES
    ('aaaaaaaa-bbbb-cccc-dddd-00000000000c', 'aaaaaaaa-bbbb-cccc-eeee-000000000701', 1, 0, 3); -- NewPlayer
END;
$$;

-- ---------------------------------------------------------------------------
-- 1. get_round_status : journée vide / annulée → open
-- ---------------------------------------------------------------------------

DO $$
DECLARE
  v_token TEXT;
  v_season_id UUID;
  v_payload JSONB;
BEGIN
  SELECT l.session_token INTO v_token
  FROM public.login_player('test-code-aln', 'aaaaaaaa-bbbb-cccc-dddd-000000000001', '1234') AS l;
  v_season_id := public.get_active_season_id();

  -- Journée vide (aucun match en base pour ce numéro)
  v_payload := public.get_round_status(v_token, v_season_id, 9999);
  IF v_payload->>'status' <> 'open' THEN
    RAISE EXCEPTION 'TEST FAIL: empty round should be open (%)', v_payload;
  END IF;
  IF (v_payload->>'isDefinitive')::BOOLEAN IS NOT FALSE
     OR (v_payload->>'hasStarted')::BOOLEAN IS NOT FALSE
     OR (v_payload->>'nonCancelledMatchCount')::INTEGER <> 0
     OR (v_payload->>'remainingCount')::INTEGER <> 0
  THEN
    RAISE EXCEPTION 'TEST FAIL: empty round guard fields incorrect (%)', v_payload;
  END IF;

  -- Journée entièrement annulée
  v_payload := public.get_round_status(v_token, v_season_id, 31);
  IF v_payload->>'status' <> 'open' THEN
    RAISE EXCEPTION 'TEST FAIL: all-cancelled round should be open (%)', v_payload;
  END IF;
  IF (v_payload->>'roundMatchCount')::INTEGER <> 2
     OR (v_payload->>'nonCancelledMatchCount')::INTEGER <> 0
     OR (v_payload->>'cancelledCount')::INTEGER <> 2
  THEN
    RAISE EXCEPTION 'TEST FAIL: all-cancelled round counts incorrect (%)', v_payload;
  END IF;

  -- Postponed empêche completed
  v_payload := public.get_round_status(v_token, v_season_id, 32);
  IF v_payload->>'status' <> 'provisional' THEN
    RAISE EXCEPTION 'TEST FAIL: postponed round should stay provisional (%)', v_payload;
  END IF;
  IF (v_payload->>'postponedCount')::INTEGER <> 1
     OR (v_payload->>'finishedCount')::INTEGER <> 2
     OR (v_payload->>'nonCancelledMatchCount')::INTEGER <> 3
     OR (v_payload->>'remainingCount')::INTEGER <> 1
     OR (v_payload->>'isDefinitive')::BOOLEAN IS NOT FALSE
  THEN
    RAISE EXCEPTION 'TEST FAIL: postponed round counts incorrect (%)', v_payload;
  END IF;

  -- Provisoire, partiellement joué
  v_payload := public.get_round_status(v_token, v_season_id, 33);
  IF v_payload->>'status' <> 'provisional' THEN
    RAISE EXCEPTION 'TEST FAIL: partially finished round should be provisional (%)', v_payload;
  END IF;
  IF (v_payload->>'finishedCount')::INTEGER <> 1 OR (v_payload->>'remainingCount')::INTEGER <> 2 THEN
    RAISE EXCEPTION 'TEST FAIL: provisional round counts incorrect (%)', v_payload;
  END IF;

  -- Completed
  v_payload := public.get_round_status(v_token, v_season_id, 34);
  IF v_payload->>'status' <> 'completed' THEN
    RAISE EXCEPTION 'TEST FAIL: fully finished round should be completed (%)', v_payload;
  END IF;
  IF (v_payload->>'isDefinitive')::BOOLEAN IS NOT TRUE OR (v_payload->>'remainingCount')::INTEGER <> 0 THEN
    RAISE EXCEPTION 'TEST FAIL: completed round derived fields incorrect (%)', v_payload;
  END IF;
END;
$$;

-- ---------------------------------------------------------------------------
-- 2. INVALID_ROUND sur les 4 RPC round-based
-- ---------------------------------------------------------------------------

DO $$
DECLARE
  v_token TEXT;
  v_season_id UUID;
BEGIN
  SELECT l.session_token INTO v_token
  FROM public.login_player('test-code-aln', 'aaaaaaaa-bbbb-cccc-dddd-000000000001', '1234') AS l;
  v_season_id := public.get_active_season_id();

  BEGIN
    PERFORM public.get_round_status(v_token, v_season_id, NULL);
    RAISE EXCEPTION 'TEST FAIL: get_round_status accepted NULL round';
  EXCEPTION
    WHEN OTHERS THEN
      IF SQLERRM NOT LIKE '%INVALID_ROUND%' THEN RAISE; END IF;
  END;

  BEGIN
    PERFORM public.get_round_status(v_token, v_season_id, 0);
    RAISE EXCEPTION 'TEST FAIL: get_round_status accepted round 0';
  EXCEPTION
    WHEN OTHERS THEN
      IF SQLERRM NOT LIKE '%INVALID_ROUND%' THEN RAISE; END IF;
  END;

  BEGIN
    PERFORM * FROM public.get_season_ranking_as_of_round(v_token, v_season_id, -1);
    RAISE EXCEPTION 'TEST FAIL: get_season_ranking_as_of_round accepted negative round';
  EXCEPTION
    WHEN OTHERS THEN
      IF SQLERRM NOT LIKE '%INVALID_ROUND%' THEN RAISE; END IF;
  END;

  BEGIN
    PERFORM public.get_round_player_stats(v_token, v_season_id, NULL);
    RAISE EXCEPTION 'TEST FAIL: get_round_player_stats accepted NULL round';
  EXCEPTION
    WHEN OTHERS THEN
      IF SQLERRM NOT LIKE '%INVALID_ROUND%' THEN RAISE; END IF;
  END;

  BEGIN
    PERFORM public.get_player_round_recap(v_token, v_season_id, 0);
    RAISE EXCEPTION 'TEST FAIL: get_player_round_recap accepted round 0';
  EXCEPTION
    WHEN OTHERS THEN
      IF SQLERRM NOT LIKE '%INVALID_ROUND%' THEN RAISE; END IF;
  END;
END;
$$;

-- ---------------------------------------------------------------------------
-- 3. as-of : ties 1,1,3,4 + gapToPrevious + actifs à zéro partageant le rang
-- ---------------------------------------------------------------------------

DO $$
DECLARE
  v_token TEXT;
  v_season_id UUID;
  v_alice RECORD;
  v_bob RECORD;
  v_diane RECORD;
  v_edouard RECORD;
  v_vincent RECORD;
  v_lea RECORD;
BEGIN
  SELECT l.session_token INTO v_token
  FROM public.login_player('test-code-aln', 'aaaaaaaa-bbbb-cccc-dddd-000000000001', '1234') AS l;
  v_season_id := public.get_active_season_id();

  SELECT * INTO v_alice FROM public.get_season_ranking_as_of_round(v_token, v_season_id, 10) AS r
    WHERE r.player_id = 'aaaaaaaa-bbbb-cccc-dddd-000000000001';
  SELECT * INTO v_bob FROM public.get_season_ranking_as_of_round(v_token, v_season_id, 10) AS r
    WHERE r.player_id = 'aaaaaaaa-bbbb-cccc-dddd-000000000002';
  SELECT * INTO v_diane FROM public.get_season_ranking_as_of_round(v_token, v_season_id, 10) AS r
    WHERE r.player_id = 'aaaaaaaa-bbbb-cccc-dddd-000000000003';
  SELECT * INTO v_edouard FROM public.get_season_ranking_as_of_round(v_token, v_season_id, 10) AS r
    WHERE r.player_id = 'aaaaaaaa-bbbb-cccc-dddd-000000000004';

  IF v_alice.points <> 9 OR v_alice.exact_score_count <> 3 OR v_alice.rank <> 1 OR v_alice.gap_to_previous IS NOT NULL THEN
    RAISE EXCEPTION 'TEST FAIL: Alice as-of stats incorrect (points=%, exact=%, rank=%, gap=%)',
      v_alice.points, v_alice.exact_score_count, v_alice.rank, v_alice.gap_to_previous;
  END IF;

  IF v_bob.points <> 9 OR v_bob.exact_score_count <> 3 OR v_bob.rank <> 1 OR v_bob.gap_to_previous <> 0 THEN
    RAISE EXCEPTION 'TEST FAIL: Bob as-of stats incorrect (points=%, exact=%, rank=%, gap=%)',
      v_bob.points, v_bob.exact_score_count, v_bob.rank, v_bob.gap_to_previous;
  END IF;

  IF v_diane.points <> 9 OR v_diane.exact_score_count <> 2 OR v_diane.rank <> 3 OR v_diane.gap_to_previous <> 0 THEN
    RAISE EXCEPTION 'TEST FAIL: Diane as-of stats incorrect (points=%, exact=%, rank=%, gap=%)',
      v_diane.points, v_diane.exact_score_count, v_diane.rank, v_diane.gap_to_previous;
  END IF;

  IF v_edouard.points <> 5 OR v_edouard.exact_score_count <> 1 OR v_edouard.rank <> 4 OR v_edouard.gap_to_previous <> 4 THEN
    RAISE EXCEPTION 'TEST FAIL: Edouard as-of stats incorrect (points=%, exact=%, rank=%, gap=%)',
      v_edouard.points, v_edouard.exact_score_count, v_edouard.rank, v_edouard.gap_to_previous;
  END IF;

  -- Actifs à zéro point partagent le même rang (ties 1,1,3,4 puis un même palier zéro)
  SELECT * INTO v_vincent FROM public.get_season_ranking_as_of_round(v_token, v_season_id, 10) AS r
    WHERE r.player_id = '11111111-1111-1111-1111-111111111101';
  SELECT * INTO v_lea FROM public.get_season_ranking_as_of_round(v_token, v_season_id, 10) AS r
    WHERE r.player_id = '11111111-1111-1111-1111-111111111102';

  IF v_vincent.points <> 0 OR v_lea.points <> 0 THEN
    RAISE EXCEPTION 'TEST FAIL: seed players should have 0 points as-of round 10';
  END IF;
  IF v_vincent.rank IS DISTINCT FROM v_lea.rank THEN
    RAISE EXCEPTION 'TEST FAIL: active zero-point players should share the same rank (% vs %)',
      v_vincent.rank, v_lea.rank;
  END IF;
  IF v_vincent.rank <= v_edouard.rank THEN
    RAISE EXCEPTION 'TEST FAIL: zero-point players should rank below scoring players';
  END IF;
END;
$$;

-- ---------------------------------------------------------------------------
-- 4. Correction de score → changement de classement
-- ---------------------------------------------------------------------------

DO $$
DECLARE
  v_token TEXT;
  v_season_id UUID;
  v_match_corr UUID := 'aaaaaaaa-bbbb-cccc-eeee-000000000401';
  v_fifi RECORD;
  v_gigi RECORD;
BEGIN
  SELECT l.session_token INTO v_token
  FROM public.login_player('test-code-aln', 'aaaaaaaa-bbbb-cccc-dddd-000000000001', '1234') AS l;
  v_season_id := public.get_active_season_id();

  -- Avant correction : Fifi (exact) devant Gigi (bon résultat)
  SELECT * INTO v_fifi FROM public.get_season_ranking_as_of_round(v_token, v_season_id, 40) AS r
    WHERE r.player_id = 'aaaaaaaa-bbbb-cccc-dddd-000000000005';
  SELECT * INTO v_gigi FROM public.get_season_ranking_as_of_round(v_token, v_season_id, 40) AS r
    WHERE r.player_id = 'aaaaaaaa-bbbb-cccc-dddd-000000000006';

  IF v_fifi.points <> 3 OR v_gigi.points <> 1 THEN
    RAISE EXCEPTION 'TEST FAIL: pre-correction points incorrect (Fifi=%, Gigi=%)', v_fifi.points, v_gigi.points;
  END IF;
  IF v_fifi.rank >= v_gigi.rank THEN
    RAISE EXCEPTION 'TEST FAIL: Fifi should lead before correction (Fifi rank=%, Gigi rank=%)', v_fifi.rank, v_gigi.rank;
  END IF;

  -- Correction du score final : 1-0 au lieu de 2-1 → Gigi devient exacte, Fifi rétrograde.
  -- On ajuste directement les points des pronostics concernés (équivalent au résultat
  -- d'un recalcul admin), sans invoquer recalculate_points_for_match qui recalculerait
  -- toute la saison et écraserait les données des autres scénarios de ce fichier.
  UPDATE public.matches
  SET home_score = 1, away_score = 0, updated_at = now()
  WHERE id = v_match_corr;

  UPDATE public.predictions
  SET points = public.compute_prediction_points(predicted_home_score, predicted_away_score, 1, 0),
      updated_at = now()
  WHERE match_id = v_match_corr;

  SELECT * INTO v_fifi FROM public.get_season_ranking_as_of_round(v_token, v_season_id, 40) AS r
    WHERE r.player_id = 'aaaaaaaa-bbbb-cccc-dddd-000000000005';
  SELECT * INTO v_gigi FROM public.get_season_ranking_as_of_round(v_token, v_season_id, 40) AS r
    WHERE r.player_id = 'aaaaaaaa-bbbb-cccc-dddd-000000000006';

  IF v_gigi.points <> 3 OR v_fifi.points <> 1 THEN
    RAISE EXCEPTION 'TEST FAIL: post-correction points incorrect (Fifi=%, Gigi=%)', v_fifi.points, v_gigi.points;
  END IF;
  IF v_gigi.rank >= v_fifi.rank THEN
    RAISE EXCEPTION 'TEST FAIL: Gigi should lead after correction (Fifi rank=%, Gigi rank=%)', v_fifi.rank, v_gigi.rank;
  END IF;
END;
$$;

-- ---------------------------------------------------------------------------
-- 5. Champions de journée excluent les non-participants
-- ---------------------------------------------------------------------------

DO $$
DECLARE
  v_token TEXT;
  v_season_id UUID;
  v_payload JSONB;
  v_ivy JSONB;
BEGIN
  SELECT l.session_token INTO v_token
  FROM public.login_player('test-code-aln', 'aaaaaaaa-bbbb-cccc-dddd-000000000001', '1234') AS l;
  v_season_id := public.get_active_season_id();

  v_payload := public.get_round_player_stats(v_token, v_season_id, 41);

  IF jsonb_array_length(v_payload->'group'->'championPlayerIds') <> 1
     OR NOT (v_payload->'group'->'championPlayerIds' @> to_jsonb('aaaaaaaa-bbbb-cccc-dddd-000000000007'::TEXT))
  THEN
    RAISE EXCEPTION 'TEST FAIL: champion list should contain only Hugo (%)', v_payload->'group'->'championPlayerIds';
  END IF;

  IF (v_payload->'group'->>'championRoundPoints')::INTEGER <> 3 THEN
    RAISE EXCEPTION 'TEST FAIL: championRoundPoints incorrect (%)', v_payload->'group'->>'championRoundPoints';
  END IF;

  SELECT elem INTO v_ivy
  FROM jsonb_array_elements(v_payload->'players') AS elem
  WHERE elem->>'playerId' = 'aaaaaaaa-bbbb-cccc-dddd-000000000008';

  IF v_ivy IS NULL THEN
    RAISE EXCEPTION 'TEST FAIL: Ivy should be listed (active player)';
  END IF;
  IF (v_ivy->>'predictedMatchCount')::INTEGER <> 0 OR v_ivy->>'participationStatus' <> 'none' THEN
    RAISE EXCEPTION 'TEST FAIL: Ivy participation status incorrect (%)', v_ivy;
  END IF;
  IF v_payload->'group'->'championPlayerIds' @> to_jsonb('aaaaaaaa-bbbb-cccc-dddd-000000000008'::TEXT) THEN
    RAISE EXCEPTION 'TEST FAIL: Ivy (non-participant) should not be a champion';
  END IF;
END;
$$;

-- ---------------------------------------------------------------------------
-- 6. Classement vivant : tous les finished, pas juste as-of(round de référence)
-- ---------------------------------------------------------------------------

DO $$
DECLARE
  v_token TEXT;
  v_season_id UUID;
  v_live_kappa RECORD;
  v_live_lambda RECORD;
  v_naive_lambda RECORD;
  v_ref_round INTEGER;
  v_ref_status TEXT;
BEGIN
  SELECT l.session_token INTO v_token
  FROM public.login_player('test-code-aln', 'aaaaaaaa-bbbb-cccc-dddd-000000000001', '1234') AS l;
  v_season_id := public.get_active_season_id();

  SELECT * INTO v_live_kappa FROM public.get_live_season_ranking(v_token, v_season_id) AS r
    WHERE r.player_id = 'aaaaaaaa-bbbb-cccc-dddd-000000000009';
  SELECT * INTO v_live_lambda FROM public.get_live_season_ranking(v_token, v_season_id) AS r
    WHERE r.player_id = 'aaaaaaaa-bbbb-cccc-dddd-00000000000a';

  IF v_live_kappa.points <> 3 THEN
    RAISE EXCEPTION 'TEST FAIL: Kappa live points incorrect (%)', v_live_kappa.points;
  END IF;
  IF v_live_lambda.points <> 3 THEN
    RAISE EXCEPTION 'TEST FAIL: live ranking missed round 52 finished match for Lambda (points=%)', v_live_lambda.points;
  END IF;

  v_ref_round := v_live_kappa.reference_round_number;
  v_ref_status := v_live_kappa.reference_round_status;
  IF v_ref_round <> 50 OR v_ref_status <> 'provisional' THEN
    RAISE EXCEPTION 'TEST FAIL: reference round should be 50/provisional (got %/%)', v_ref_round, v_ref_status;
  END IF;
  IF v_live_kappa.is_ranking_provisional IS NOT TRUE THEN
    RAISE EXCEPTION 'TEST FAIL: isRankingProvisional should be true';
  END IF;

  -- La version naïve as-of(round de référence) rate le match de la journée 52
  SELECT * INTO v_naive_lambda FROM public.get_season_ranking_as_of_round(v_token, v_season_id, v_ref_round) AS r
    WHERE r.player_id = 'aaaaaaaa-bbbb-cccc-dddd-00000000000a';
  IF v_naive_lambda.points <> 0 THEN
    RAISE EXCEPTION 'TEST FAIL: naive as-of(reference) unexpectedly captured round 52 (points=%)', v_naive_lambda.points;
  END IF;
END;
$$;

-- ---------------------------------------------------------------------------
-- 7. Récap : priorité no_participation
-- ---------------------------------------------------------------------------

DO $$
DECLARE
  v_token TEXT;
  v_season_id UUID;
  v_payload JSONB;
BEGIN
  SELECT l.session_token INTO v_token
  FROM public.login_player('test-code-aln', 'aaaaaaaa-bbbb-cccc-dddd-00000000000b', '1234') AS l;
  v_season_id := public.get_active_season_id();

  v_payload := public.get_player_round_recap(v_token, v_season_id, 60);

  IF v_payload->>'messageKey' <> 'no_participation' THEN
    RAISE EXCEPTION 'TEST FAIL: recap messageKey should be no_participation (%)', v_payload->>'messageKey';
  END IF;
  IF (v_payload->'summary'->>'participated')::BOOLEAN IS NOT FALSE THEN
    RAISE EXCEPTION 'TEST FAIL: summary.participated should be false';
  END IF;
  IF (v_payload->'summary'->>'roundPoints')::INTEGER <> 0 THEN
    RAISE EXCEPTION 'TEST FAIL: non-participant round points should be 0';
  END IF;
END;
$$;

-- ---------------------------------------------------------------------------
-- 8. Récap : nouveau joueur → rankBefore null, rankAfter réel
-- ---------------------------------------------------------------------------

DO $$
DECLARE
  v_token TEXT;
  v_season_id UUID;
  v_payload JSONB;
BEGIN
  SELECT l.session_token INTO v_token
  FROM public.login_player('test-code-aln', 'aaaaaaaa-bbbb-cccc-dddd-00000000000c', '1234') AS l;
  v_season_id := public.get_active_season_id();

  v_payload := public.get_player_round_recap(v_token, v_season_id, 70);

  IF v_payload->'ranking'->>'rankBefore' IS NOT NULL THEN
    RAISE EXCEPTION 'TEST FAIL: new player rankBefore should be null (%)', v_payload->'ranking'->'rankBefore';
  END IF;
  IF v_payload->'ranking'->>'rankAfter' IS NULL THEN
    RAISE EXCEPTION 'TEST FAIL: new player rankAfter should be a real value';
  END IF;
  IF v_payload->'ranking'->>'rankDelta' IS NOT NULL THEN
    RAISE EXCEPTION 'TEST FAIL: new player rankDelta should be null (%)', v_payload->'ranking'->'rankDelta';
  END IF;
  IF (v_payload->'ranking'->>'isNewToRanking')::BOOLEAN IS NOT TRUE THEN
    RAISE EXCEPTION 'TEST FAIL: isNewToRanking should be true for a brand new player';
  END IF;
  IF (v_payload->'summary'->>'participated')::BOOLEAN IS NOT TRUE THEN
    RAISE EXCEPTION 'TEST FAIL: new player should be marked as participated';
  END IF;
END;
$$;

-- ---------------------------------------------------------------------------
-- 9. Grants : anon/authenticated peuvent exécuter les RPC publiques
-- ---------------------------------------------------------------------------

DO $$
BEGIN
  IF NOT has_function_privilege('anon', 'public.get_round_status(text, uuid, integer)', 'EXECUTE') THEN
    RAISE EXCEPTION 'TEST FAIL: anon should be able to execute get_round_status';
  END IF;
  IF NOT has_function_privilege('anon', 'public.get_season_ranking_as_of_round(text, uuid, integer)', 'EXECUTE') THEN
    RAISE EXCEPTION 'TEST FAIL: anon should be able to execute get_season_ranking_as_of_round';
  END IF;
  IF NOT has_function_privilege('anon', 'public.get_round_player_stats(text, uuid, integer)', 'EXECUTE') THEN
    RAISE EXCEPTION 'TEST FAIL: anon should be able to execute get_round_player_stats';
  END IF;
  IF NOT has_function_privilege('anon', 'public.get_live_season_ranking(text, uuid)', 'EXECUTE') THEN
    RAISE EXCEPTION 'TEST FAIL: anon should be able to execute get_live_season_ranking';
  END IF;
  IF NOT has_function_privilege('anon', 'public.get_player_round_recap(text, uuid, integer)', 'EXECUTE') THEN
    RAISE EXCEPTION 'TEST FAIL: anon should be able to execute get_player_round_recap';
  END IF;
  IF NOT has_function_privilege('anon', 'public.get_player_season_timeline(text, uuid)', 'EXECUTE') THEN
    RAISE EXCEPTION 'TEST FAIL: anon should be able to execute get_player_season_timeline';
  END IF;
  IF has_function_privilege('anon', 'public.compute_round_status(uuid, integer)', 'EXECUTE') THEN
    RAISE EXCEPTION 'TEST FAIL: anon should not execute internal helper compute_round_status';
  END IF;
  IF has_function_privilege('anon', 'public.compute_season_ranking_as_of(uuid, integer)', 'EXECUTE') THEN
    RAISE EXCEPTION 'TEST FAIL: anon should not execute internal helper compute_season_ranking_as_of';
  END IF;
END;
$$;

ROLLBACK;
