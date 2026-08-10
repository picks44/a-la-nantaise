-- Garde-fous performance : bestPrediction > 0, champion SUM journée > 0,
-- first_participation hors trophées, scoreless_day, isTied, timeline bests.
-- Exécuter : BEGIN; \i supabase/tests/zero_score_performance_guards.sql ; ROLLBACK;

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
  v_a UUID := 'bbbbbbbb-bbbb-bbbb-bbbb-000000000001';
  v_b UUID := 'bbbbbbbb-bbbb-bbbb-bbbb-000000000002';
  v_c UUID := 'bbbbbbbb-bbbb-bbbb-bbbb-000000000003';
  v_m1 UUID := 'cccccccc-cccc-cccc-cccc-000000000101';
  v_m2 UUID := 'cccccccc-cccc-cccc-cccc-000000000102';
  v_m3 UUID := 'cccccccc-cccc-cccc-cccc-000000000103';
  v_m4 UUID := 'cccccccc-cccc-cccc-cccc-000000000104';
  v_m5 UUID := 'cccccccc-cccc-cccc-cccc-000000000105';
  v_m6 UUID := 'cccccccc-cccc-cccc-cccc-000000000106';
  v_m7 UUID := 'cccccccc-cccc-cccc-cccc-000000000107';
  v_m8 UUID := 'cccccccc-cccc-cccc-cccc-000000000108';
  v_m9 UUID := 'cccccccc-cccc-cccc-cccc-000000000109';
  v_token TEXT;
  v_payload JSONB;
  v_count INTEGER;
  v_trophies_count INTEGER;
  v_part JSONB;
BEGIN
  INSERT INTO public.players (id, display_name, is_active, created_at, pin_hash, must_change_pin)
  VALUES
    (v_a, 'GuardA', TRUE, now() - interval '30 days', extensions.crypt('1234', extensions.gen_salt('bf')), FALSE),
    (v_b, 'GuardB', TRUE, now() - interval '30 days', extensions.crypt('1234', extensions.gen_salt('bf')), FALSE),
    (v_c, 'GuardC', TRUE, now() - interval '30 days', extensions.crypt('1234', extensions.gen_salt('bf')), FALSE)
  ON CONFLICT (id) DO UPDATE
  SET
    display_name = EXCLUDED.display_name,
    is_active = TRUE,
    pin_hash = EXCLUDED.pin_hash,
    must_change_pin = FALSE,
    pin_failed_attempts = 0,
    pin_locked_until = NULL,
    pin_temporary_expires_at = NULL;

  DELETE FROM public.predictions WHERE player_id IN (v_a, v_b, v_c);
  DELETE FROM public.player_trophies WHERE player_id IN (v_a, v_b, v_c) AND season_id = v_season_id;
  DELETE FROM public.player_season_stats WHERE player_id IN (v_a, v_b, v_c) AND season_id = v_season_id;
  DELETE FROM public.matches WHERE id IN (v_m1, v_m2, v_m3, v_m4, v_m5, v_m6, v_m7, v_m8, v_m9);

  -- Round 201 : M1 tous à 0 (bestPrediction + champion + scoreless + timeline)
  -- Round 202 : J2 multi-match A=3 B=2
  -- Round 203 : J3 multi-match A=3 B=3 co-champions
  -- Round 204 : M2/M3 bestPrediction positifs (un seul match chacun)
  INSERT INTO public.matches (
    id, season_id, external_id, round_number, home_team, away_team, kickoff_at,
    kickoff_time_confirmed, status, home_score, away_score
  ) VALUES
    (v_m1, v_season_id, 'zg-r201-a', 201, 'FC Nantes', 'ZG A', now() - interval '20 days', TRUE, 'finished', 1, 0),
    (v_m2, v_season_id, 'zg-r201-b', 201, 'ZG B', 'FC Nantes', now() - interval '19 days', TRUE, 'finished', 2, 1),
    (v_m3, v_season_id, 'zg-r202-a', 202, 'FC Nantes', 'ZG C', now() - interval '15 days', TRUE, 'finished', 2, 0),
    (v_m4, v_season_id, 'zg-r202-b', 202, 'ZG D', 'FC Nantes', now() - interval '14 days', TRUE, 'finished', 2, 1),
    (v_m5, v_season_id, 'zg-r203-a', 203, 'FC Nantes', 'ZG E', now() - interval '10 days', TRUE, 'finished', 2, 0),
    (v_m6, v_season_id, 'zg-r203-b', 203, 'ZG F', 'FC Nantes', now() - interval '9 days', TRUE, 'finished', 0, 1),
    (v_m7, v_season_id, 'zg-r204-a', 204, 'FC Nantes', 'ZG G', now() - interval '5 days', TRUE, 'finished', 3, 0),
    (v_m8, v_season_id, 'zg-r205-a', 205, 'FC Nantes', 'ZG H', now() - interval '3 days', TRUE, 'finished', 1, 0),
    (v_m9, v_season_id, 'zg-r206-a', 206, 'FC Nantes', 'ZG I', now() - interval '1 day', TRUE, 'finished', 2, 2);

  -- Round 201 : tous 0 sur 2 matchs (issues incorrectes sur les deux)
  INSERT INTO public.predictions (player_id, match_id, predicted_home_score, predicted_away_score)
  VALUES
    (v_a, v_m1, 0, 1),
    (v_b, v_m1, 0, 2),
    (v_c, v_m1, 2, 2),
    (v_a, v_m2, 0, 0),
    (v_b, v_m2, 1, 3),
    (v_c, v_m2, 1, 1);

  -- Round 202 : A=3+0=3, B=1+1=2 (SUM journée ; match2 home win 2-1)
  INSERT INTO public.predictions (player_id, match_id, predicted_home_score, predicted_away_score)
  VALUES
    (v_a, v_m3, 2, 0),
    (v_b, v_m3, 1, 0),
    (v_a, v_m4, 0, 0),
    (v_b, v_m4, 1, 0);

  -- Round 203 : A=3+0=3, B=0+3=3 co-champions (SUM journée)
  INSERT INTO public.predictions (player_id, match_id, predicted_home_score, predicted_away_score)
  VALUES
    (v_a, v_m5, 2, 0),
    (v_b, v_m5, 0, 1),
    (v_a, v_m6, 1, 0),
    (v_b, v_m6, 0, 1);

  -- Round 204 M2 : A=3 B=0 C=0
  INSERT INTO public.predictions (player_id, match_id, predicted_home_score, predicted_away_score)
  VALUES
    (v_a, v_m7, 3, 0),
    (v_b, v_m7, 0, 0),
    (v_c, v_m7, 1, 1);

  -- Round 205 M3 : A=3 B=3 C=1
  INSERT INTO public.predictions (player_id, match_id, predicted_home_score, predicted_away_score)
  VALUES
    (v_a, v_m8, 1, 0),
    (v_b, v_m8, 1, 0),
    (v_c, v_m8, 1, 1);

  -- Round 206 P3 helper : A only scores 2 later — optional path covered via timeline after recalc
  INSERT INTO public.predictions (player_id, match_id, predicted_home_score, predicted_away_score)
  VALUES
    (v_a, v_m9, 2, 2);

  PERFORM public.recalculate_points_for_match(v_m1);
  PERFORM public.recalculate_points_for_match(v_m2);
  PERFORM public.recalculate_points_for_match(v_m3);
  PERFORM public.recalculate_points_for_match(v_m4);
  PERFORM public.recalculate_points_for_match(v_m5);
  PERFORM public.recalculate_points_for_match(v_m6);
  PERFORM public.recalculate_points_for_match(v_m7);
  PERFORM public.recalculate_points_for_match(v_m8);
  PERFORM public.recalculate_points_for_match(v_m9);

  SELECT l.session_token INTO v_token
  FROM public.login_player('test-code-aln', v_a, '1234') AS l;

  -- M1 : aucun bestPrediction sur match tous à 0
  v_payload := public.get_match_group_reveal(v_token, v_season_id, v_m1);
  IF EXISTS (
    SELECT 1
    FROM jsonb_array_elements(v_payload->'participants') AS p
    WHERE (p.value->>'bestPrediction')::BOOLEAN IS TRUE
  ) THEN
    RAISE EXCEPTION 'TEST FAIL M1: no bestPrediction when all scores are 0 (%)', v_payload->'participants';
  END IF;

  -- M2 : seul A
  v_payload := public.get_match_group_reveal(v_token, v_season_id, v_m7);
  SELECT COUNT(*)::INTEGER INTO v_count
  FROM jsonb_array_elements(v_payload->'participants') AS p
  WHERE (p.value->>'bestPrediction')::BOOLEAN IS TRUE;
  IF v_count <> 1 THEN
    RAISE EXCEPTION 'TEST FAIL M2: expected exactly 1 bestPrediction (%)', v_payload->'participants';
  END IF;
  SELECT p INTO v_part
  FROM jsonb_array_elements(v_payload->'participants') AS p
  WHERE (p.value->>'bestPrediction')::BOOLEAN IS TRUE;
  IF v_part->>'playerId' <> v_a::TEXT THEN
    RAISE EXCEPTION 'TEST FAIL M2: bestPrediction should be A';
  END IF;

  -- M3 : A + B
  v_payload := public.get_match_group_reveal(v_token, v_season_id, v_m8);
  SELECT COUNT(*)::INTEGER INTO v_count
  FROM jsonb_array_elements(v_payload->'participants') AS p
  WHERE (p.value->>'bestPrediction')::BOOLEAN IS TRUE;
  IF v_count <> 2 THEN
    RAISE EXCEPTION 'TEST FAIL M3: expected A+B bestPrediction (%)', v_payload->'participants';
  END IF;

  -- J1 multi-match tous 0 : aucun champion trophée / stats / récap
  SELECT COUNT(*)::INTEGER INTO v_count
  FROM public.player_trophies AS pt
  WHERE pt.season_id = v_season_id
    AND pt.is_active = TRUE
    AND pt.trophy_key = 'champion_de_la_journee'
    AND pt.source_round_number = 201;
  IF v_count <> 0 THEN
    RAISE EXCEPTION 'TEST FAIL J1: no champion trophy on zero-point round';
  END IF;

  v_payload := public.get_round_player_stats(v_token, v_season_id, 201);
  IF jsonb_array_length(v_payload->'group'->'championPlayerIds') <> 0 THEN
    RAISE EXCEPTION 'TEST FAIL J1: championPlayerIds must be empty (%)', v_payload->'group';
  END IF;
  IF v_payload->'group'->>'championRoundPoints' IS NOT NULL THEN
    RAISE EXCEPTION 'TEST FAIL J1: championRoundPoints must be null';
  END IF;

  v_payload := public.get_player_round_recap(v_token, v_season_id, 201);
  IF v_payload->>'messageKey' <> 'scoreless_day' THEN
    RAISE EXCEPTION 'TEST FAIL J1: messageKey should be scoreless_day (%)', v_payload->>'messageKey';
  END IF;
  IF (v_payload->'ranking'->>'isTied')::BOOLEAN IS NOT TRUE THEN
    RAISE EXCEPTION 'TEST FAIL C1: isTied should be true when all at 0 (%)', v_payload->'ranking';
  END IF;
  IF (v_payload->'ranking'->>'rankAfter')::INTEGER <> 1 THEN
    RAISE EXCEPTION 'TEST FAIL C1: rankAfter should be 1 (%)', v_payload->'ranking';
  END IF;

  -- J2 : A champion seul (SUM 3 vs 2)
  SELECT COUNT(*)::INTEGER INTO v_count
  FROM public.player_trophies AS pt
  WHERE pt.season_id = v_season_id
    AND pt.is_active = TRUE
    AND pt.trophy_key = 'champion_de_la_journee'
    AND pt.source_round_number = 202
    AND pt.player_id = v_a;
  IF v_count <> 1 THEN
    RAISE EXCEPTION 'TEST FAIL J2: A should be champion of round 202';
  END IF;
  SELECT COUNT(*)::INTEGER INTO v_count
  FROM public.player_trophies AS pt
  WHERE pt.season_id = v_season_id
    AND pt.is_active = TRUE
    AND pt.trophy_key = 'champion_de_la_journee'
    AND pt.source_round_number = 202
    AND pt.player_id = v_b;
  IF v_count <> 0 THEN
    RAISE EXCEPTION 'TEST FAIL J2: B must not be champion';
  END IF;

  v_payload := public.get_round_player_stats(v_token, v_season_id, 202);
  IF jsonb_array_length(v_payload->'group'->'championPlayerIds') <> 1
     OR NOT (v_payload->'group'->'championPlayerIds' @> to_jsonb(v_a::TEXT))
  THEN
    RAISE EXCEPTION 'TEST FAIL J2 stats: champion should be A only (%)', v_payload->'group';
  END IF;
  IF (v_payload->'group'->>'championRoundPoints')::INTEGER <> 3 THEN
    RAISE EXCEPTION 'TEST FAIL J2: championRoundPoints should be 3 (SUM)';
  END IF;

  -- J3 : co-champions A+B
  SELECT COUNT(*)::INTEGER INTO v_count
  FROM public.player_trophies AS pt
  WHERE pt.season_id = v_season_id
    AND pt.is_active = TRUE
    AND pt.trophy_key = 'champion_de_la_journee'
    AND pt.source_round_number = 203;
  IF v_count <> 2 THEN
    RAISE EXCEPTION 'TEST FAIL J3: expected 2 co-champions';
  END IF;

  v_payload := public.get_round_player_stats(v_token, v_season_id, 203);
  IF jsonb_array_length(v_payload->'group'->'championPlayerIds') <> 2 THEN
    RAISE EXCEPTION 'TEST FAIL J3 stats: expected 2 champions (%)', v_payload->'group';
  END IF;

  -- Première participation : aucune ligne active / surfaces overview
  SELECT COUNT(*)::INTEGER INTO v_count
  FROM public.player_trophies AS pt
  WHERE pt.season_id = v_season_id
    AND pt.player_id IN (v_a, v_b, v_c)
    AND pt.is_active = TRUE
    AND pt.trophy_key = 'first_participation';
  IF v_count <> 0 THEN
    RAISE EXCEPTION 'TEST FAIL FP: active first_participation must be 0';
  END IF;

  v_payload := public.get_player_trophy_overview(v_token, v_season_id);
  IF EXISTS (
    SELECT 1 FROM jsonb_array_elements(v_payload->'earnedTrophies') e
    WHERE e.value->>'trophyKey' = 'first_participation'
  ) OR EXISTS (
    SELECT 1 FROM jsonb_array_elements(v_payload->'lockedTrophies') e
    WHERE e.value->>'trophyKey' = 'first_participation'
  ) OR EXISTS (
    SELECT 1 FROM jsonb_array_elements(v_payload->'pendingCelebrations') e
    WHERE e.value->>'trophyKey' = 'first_participation'
  ) THEN
    RAISE EXCEPTION 'TEST FAIL FP: overview must not expose first_participation';
  END IF;

  -- C2 : après points positifs, A peut être seul en tête (isTied false possible)
  v_payload := public.get_player_round_recap(v_token, v_season_id, 204);
  IF (v_payload->'ranking'->>'rankAfter')::INTEGER <> 1 THEN
    RAISE EXCEPTION 'TEST FAIL C2: A should be rank 1 after scoring (%)', v_payload->'ranking';
  END IF;
  IF (v_payload->'ranking'->>'isTied')::BOOLEAN IS NOT FALSE THEN
    RAISE EXCEPTION 'TEST FAIL C2: A should be unique leader if ahead (%)', v_payload->'ranking';
  END IF;

  -- Parcours P1 subset via isolé : créer un joueur late n'ayant que round 201
  -- (déjà couvert partiellement). Vérifier bestRound/bestRank pour A qui a des points > 0.
  v_payload := public.get_player_season_timeline(v_token, v_season_id);
  IF v_payload->'bestRound' IS NULL OR v_payload->'bestRound' = 'null'::jsonb THEN
    RAISE EXCEPTION 'TEST FAIL P2/P3: bestRound should exist when positive rounds exist';
  END IF;
  IF (v_payload->'bestRound'->>'roundPoints')::INTEGER <= 0 THEN
    RAISE EXCEPTION 'TEST FAIL: bestRound must be positive (%)', v_payload->'bestRound';
  END IF;
  IF v_payload->'bestRank' IS NULL OR v_payload->'bestRank' = 'null'::jsonb THEN
    RAISE EXCEPTION 'TEST FAIL: bestRank should exist when cumulative points > 0';
  END IF;
  IF (v_payload->'bestRound'->>'roundNumber')::INTEGER = 201 THEN
    RAISE EXCEPTION 'TEST FAIL P1: bestRound must not be the zero-point round';
  END IF;

  -- Joueur B timeline après seulement round 201 serait null — simuler via joueur C
  -- qui n'a joué que round 201 (0 pts) + round 204 (0 pts) + round 205 (1 pt)
  SELECT l.session_token INTO v_token
  FROM public.login_player('test-code-aln', v_c, '1234') AS l;
  v_payload := public.get_player_season_timeline(v_token, v_season_id);
  IF (v_payload->'bestRound'->>'roundPoints')::INTEGER < 1 THEN
    RAISE EXCEPTION 'TEST FAIL: C bestRound should be positive once scored (%)', v_payload->'bestRound';
  END IF;

  -- Idempotence recalcul : pas de first_participation
  PERFORM public.recalculate_season_achievements(v_season_id);
  SELECT COUNT(*)::INTEGER INTO v_count
  FROM public.player_trophies AS pt
  WHERE pt.season_id = v_season_id
    AND pt.player_id IN (v_a, v_b, v_c)
    AND pt.is_active = TRUE
    AND pt.trophy_key = 'first_participation';
  IF v_count <> 0 THEN
    RAISE EXCEPTION 'TEST FAIL: first_participation reappeared after recalculation';
  END IF;

  SELECT pss.trophies_count INTO v_trophies_count
  FROM public.player_season_stats AS pss
  WHERE pss.player_id = v_a AND pss.season_id = v_season_id;

  SELECT COUNT(*)::INTEGER INTO v_count
  FROM public.player_trophies AS pt
  WHERE pt.player_id = v_a AND pt.season_id = v_season_id AND pt.is_active = TRUE;

  IF v_trophies_count IS DISTINCT FROM v_count THEN
    RAISE EXCEPTION 'TEST FAIL: trophies_count (%) != active (%)', v_trophies_count, v_count;
  END IF;
END;
$$;

-- P1 strict : joueur isolé avec uniquement une journée à 0
DO $$
DECLARE
  v_season_id UUID := public.get_active_season_id();
  v_p UUID := 'bbbbbbbb-bbbb-bbbb-bbbb-000000000099';
  v_m UUID := 'cccccccc-cccc-cccc-cccc-000000000199';
  v_token TEXT;
  v_payload JSONB;
  v_count INTEGER;
BEGIN
  INSERT INTO public.players (id, display_name, is_active, created_at, pin_hash, must_change_pin)
  VALUES (v_p, 'GuardZeroOnly', TRUE, now() - interval '2 days', extensions.crypt('1234', extensions.gen_salt('bf')), FALSE)
  ON CONFLICT (id) DO UPDATE
  SET display_name = EXCLUDED.display_name, is_active = TRUE,
      pin_hash = EXCLUDED.pin_hash, must_change_pin = FALSE,
      pin_failed_attempts = 0, pin_locked_until = NULL, pin_temporary_expires_at = NULL;

  DELETE FROM public.predictions WHERE player_id = v_p;
  DELETE FROM public.player_trophies WHERE player_id = v_p AND season_id = v_season_id;
  DELETE FROM public.player_season_stats WHERE player_id = v_p AND season_id = v_season_id;
  DELETE FROM public.matches WHERE id = v_m;

  INSERT INTO public.matches (
    id, season_id, external_id, round_number, home_team, away_team, kickoff_at,
    kickoff_time_confirmed, status, home_score, away_score
  ) VALUES
    (v_m, v_season_id, 'zg-r210-a', 210, 'FC Nantes', 'ZG Zero', now() - interval '12 hours', TRUE, 'finished', 2, 0);

  INSERT INTO public.predictions (player_id, match_id, predicted_home_score, predicted_away_score)
  VALUES (v_p, v_m, 0, 1);

  PERFORM public.recalculate_points_for_match(v_m);

  SELECT COUNT(*)::INTEGER INTO v_count
  FROM public.player_trophies
  WHERE player_id = v_p AND season_id = v_season_id AND is_active = TRUE AND trophy_key = 'first_participation';
  IF v_count <> 0 THEN
    RAISE EXCEPTION 'TEST FAIL P1/FP: first_participation active after sole zero prediction';
  END IF;

  SELECT l.session_token INTO v_token FROM public.login_player('test-code-aln', v_p, '1234') AS l;
  v_payload := public.get_player_season_timeline(v_token, v_season_id);

  IF v_payload->'bestRound' IS NOT NULL AND v_payload->'bestRound' <> 'null'::jsonb THEN
    RAISE EXCEPTION 'TEST FAIL P1: bestRound must be null (%)', v_payload->'bestRound';
  END IF;
  IF v_payload->'bestRank' IS NOT NULL AND v_payload->'bestRank' <> 'null'::jsonb THEN
    RAISE EXCEPTION 'TEST FAIL P1: bestRank must be null (%)', v_payload->'bestRank';
  END IF;

  v_payload := public.get_player_round_recap(v_token, v_season_id, 210);
  IF v_payload->>'messageKey' <> 'scoreless_day' THEN
    RAISE EXCEPTION 'TEST FAIL P1: scoreless_day expected (%)', v_payload->>'messageKey';
  END IF;
END;
$$;

ROLLBACK;
