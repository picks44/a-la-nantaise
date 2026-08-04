-- Tests SQL : revelation collective + trophees / series
-- Exécuter : BEGIN; \i supabase/tests/reveal_and_trophies.sql ; ROLLBACK;

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
BEGIN
  INSERT INTO public.players (id, display_name, is_active, created_at, pin_hash, must_change_pin)
  VALUES
    ('eeeeeeee-eeee-eeee-eeee-eeeeeeeeee01', 'RevealAlpha', TRUE, now() - interval '120 days', extensions.crypt('1234', extensions.gen_salt('bf')), FALSE),
    ('eeeeeeee-eeee-eeee-eeee-eeeeeeeeee02', 'RevealBravo', TRUE, now() - interval '120 days', extensions.crypt('1234', extensions.gen_salt('bf')), FALSE),
    ('eeeeeeee-eeee-eeee-eeee-eeeeeeeeee03', 'RevealCharlie', TRUE, now() - interval '120 days', extensions.crypt('1234', extensions.gen_salt('bf')), FALSE),
    ('eeeeeeee-eeee-eeee-eeee-eeeeeeeeee04', 'RevealDelta', TRUE, now() - interval '120 days', extensions.crypt('1234', extensions.gen_salt('bf')), FALSE)
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
    ('ffffffff-ffff-ffff-ffff-fffffffff101', v_season_id, 'reveal-open', 70, 'FC Nantes', 'Open FC', now() + interval '2 days', TRUE, 'scheduled', NULL, NULL),
    ('ffffffff-ffff-ffff-ffff-fffffffff102', v_season_id, 'reveal-locked', 70, 'FC Nantes', 'Locked FC', now() - interval '2 hours', TRUE, 'scheduled', NULL, NULL),
    ('ffffffff-ffff-ffff-ffff-fffffffff103', v_season_id, 'reveal-finished-a', 71, 'FC Nantes', 'Finish A', now() - interval '40 days', TRUE, 'finished', 1, 0),
    ('ffffffff-ffff-ffff-ffff-fffffffff104', v_season_id, 'reveal-finished-b', 71, 'Finish B', 'FC Nantes', now() - interval '33 days', TRUE, 'finished', 2, 1),
    ('ffffffff-ffff-ffff-ffff-fffffffff105', v_season_id, 'reveal-finished-c', 72, 'FC Nantes', 'Finish C', now() - interval '26 days', TRUE, 'finished', 0, 0),
    ('ffffffff-ffff-ffff-ffff-fffffffff106', v_season_id, 'reveal-finished-d', 72, 'Finish D', 'FC Nantes', now() - interval '19 days', TRUE, 'finished', 3, 1),
    ('ffffffff-ffff-ffff-ffff-fffffffff107', v_season_id, 'reveal-cancelled', 73, 'FC Nantes', 'Cancelled FC', now() - interval '12 days', TRUE, 'cancelled', NULL, NULL),
    ('ffffffff-ffff-ffff-ffff-fffffffff108', v_season_id, 'reveal-finished-e', 74, 'FC Nantes', 'Finish E', now() - interval '10 days', TRUE, 'finished', 2, 0),
    ('ffffffff-ffff-ffff-ffff-fffffffff109', v_season_id, 'reveal-finished-f', 75, 'Finish F', 'FC Nantes', now() - interval '9 days', TRUE, 'finished', 0, 1),
    ('ffffffff-ffff-ffff-ffff-fffffffff110', v_season_id, 'reveal-finished-g', 76, 'FC Nantes', 'Finish G', now() - interval '8 days', TRUE, 'finished', 4, 2),
    ('ffffffff-ffff-ffff-ffff-fffffffff111', v_season_id, 'reveal-finished-h', 77, 'Finish H', 'FC Nantes', now() - interval '7 days', TRUE, 'finished', 1, 2),
    ('ffffffff-ffff-ffff-ffff-fffffffff112', v_season_id, 'reveal-finished-i', 78, 'FC Nantes', 'Finish I', now() - interval '6 days', TRUE, 'finished', 2, 2),
    ('ffffffff-ffff-ffff-ffff-fffffffff113', v_season_id, 'reveal-finished-j', 79, 'Finish J', 'FC Nantes', now() - interval '5 days', TRUE, 'finished', 3, 0),
    ('ffffffff-ffff-ffff-ffff-fffffffff114', v_season_id, 'reveal-finished-k', 80, 'FC Nantes', 'Finish K', now() - interval '4 days', TRUE, 'finished', 1, 1),
    ('ffffffff-ffff-ffff-ffff-fffffffff115', v_season_id, 'reveal-future-private', 81, 'FC Nantes', 'Future Private', now() + interval '7 days', TRUE, 'scheduled', NULL, NULL)
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
  WHERE player_id IN (
    'eeeeeeee-eeee-eeee-eeee-eeeeeeeeee01',
    'eeeeeeee-eeee-eeee-eeee-eeeeeeeeee02',
    'eeeeeeee-eeee-eeee-eeee-eeeeeeeeee03',
    'eeeeeeee-eeee-eeee-eeee-eeeeeeeeee04'
  )
  OR match_id IN (
    'ffffffff-ffff-ffff-ffff-fffffffff101',
    'ffffffff-ffff-ffff-ffff-fffffffff102',
    'ffffffff-ffff-ffff-ffff-fffffffff103',
    'ffffffff-ffff-ffff-ffff-fffffffff104',
    'ffffffff-ffff-ffff-ffff-fffffffff105',
    'ffffffff-ffff-ffff-ffff-fffffffff106',
    'ffffffff-ffff-ffff-ffff-fffffffff107',
    'ffffffff-ffff-ffff-ffff-fffffffff108',
    'ffffffff-ffff-ffff-ffff-fffffffff109',
    'ffffffff-ffff-ffff-ffff-fffffffff110',
    'ffffffff-ffff-ffff-ffff-fffffffff111',
    'ffffffff-ffff-ffff-ffff-fffffffff112',
    'ffffffff-ffff-ffff-ffff-fffffffff113',
    'ffffffff-ffff-ffff-ffff-fffffffff114',
    'ffffffff-ffff-ffff-ffff-fffffffff115'
  );

  DELETE FROM public.player_trophies
  WHERE player_id IN (
    'eeeeeeee-eeee-eeee-eeee-eeeeeeeeee01',
    'eeeeeeee-eeee-eeee-eeee-eeeeeeeeee02',
    'eeeeeeee-eeee-eeee-eeee-eeeeeeeeee03',
    'eeeeeeee-eeee-eeee-eeee-eeeeeeeeee04'
  )
    AND season_id = v_season_id;

  DELETE FROM public.player_season_stats
  WHERE player_id IN (
    'eeeeeeee-eeee-eeee-eeee-eeeeeeeeee01',
    'eeeeeeee-eeee-eeee-eeee-eeeeeeeeee02',
    'eeeeeeee-eeee-eeee-eeee-eeeeeeeeee03',
    'eeeeeeee-eeee-eeee-eeee-eeeeeeeeee04'
  )
    AND season_id = v_season_id;

  DELETE FROM public.player_sessions
  WHERE player_id IN (
    'eeeeeeee-eeee-eeee-eeee-eeeeeeeeee01',
    'eeeeeeee-eeee-eeee-eeee-eeeeeeeeee02',
    'eeeeeeee-eeee-eeee-eeee-eeeeeeeeee03',
    'eeeeeeee-eeee-eeee-eeee-eeeeeeeeee04'
  );

  INSERT INTO public.predictions (player_id, match_id, predicted_home_score, predicted_away_score)
  VALUES
    ('eeeeeeee-eeee-eeee-eeee-eeeeeeeeee01', 'ffffffff-ffff-ffff-ffff-fffffffff101', 2, 0),
    ('eeeeeeee-eeee-eeee-eeee-eeeeeeeeee02', 'ffffffff-ffff-ffff-ffff-fffffffff101', 0, 1),
    ('eeeeeeee-eeee-eeee-eeee-eeeeeeeeee01', 'ffffffff-ffff-ffff-ffff-fffffffff102', 2, 1),
    ('eeeeeeee-eeee-eeee-eeee-eeeeeeeeee02', 'ffffffff-ffff-ffff-ffff-fffffffff102', 2, 1),
    ('eeeeeeee-eeee-eeee-eeee-eeeeeeeeee03', 'ffffffff-ffff-ffff-ffff-fffffffff102', 1, 1),
    ('eeeeeeee-eeee-eeee-eeee-eeeeeeeeee04', 'ffffffff-ffff-ffff-ffff-fffffffff102', 0, 2),
    ('eeeeeeee-eeee-eeee-eeee-eeeeeeeeee01', 'ffffffff-ffff-ffff-ffff-fffffffff103', 1, 0),
    ('eeeeeeee-eeee-eeee-eeee-eeeeeeeeee02', 'ffffffff-ffff-ffff-ffff-fffffffff103', 1, 0),
    ('eeeeeeee-eeee-eeee-eeee-eeeeeeeeee03', 'ffffffff-ffff-ffff-ffff-fffffffff103', 0, 1),
    ('eeeeeeee-eeee-eeee-eeee-eeeeeeeeee01', 'ffffffff-ffff-ffff-ffff-fffffffff104', 2, 1),
    ('eeeeeeee-eeee-eeee-eeee-eeeeeeeeee02', 'ffffffff-ffff-ffff-ffff-fffffffff104', 2, 1),
    ('eeeeeeee-eeee-eeee-eeee-eeeeeeeeee03', 'ffffffff-ffff-ffff-ffff-fffffffff104', 1, 2),
    ('eeeeeeee-eeee-eeee-eeee-eeeeeeeeee01', 'ffffffff-ffff-ffff-ffff-fffffffff105', 0, 0),
    ('eeeeeeee-eeee-eeee-eeee-eeeeeeeeee02', 'ffffffff-ffff-ffff-ffff-fffffffff105', 1, 1),
    ('eeeeeeee-eeee-eeee-eeee-eeeeeeeeee03', 'ffffffff-ffff-ffff-ffff-fffffffff105', 0, 1),
    ('eeeeeeee-eeee-eeee-eeee-eeeeeeeeee01', 'ffffffff-ffff-ffff-ffff-fffffffff106', 3, 1),
    ('eeeeeeee-eeee-eeee-eeee-eeeeeeeeee02', 'ffffffff-ffff-ffff-ffff-fffffffff106', 3, 1),
    ('eeeeeeee-eeee-eeee-eeee-eeeeeeeeee03', 'ffffffff-ffff-ffff-ffff-fffffffff106', 2, 0),
    ('eeeeeeee-eeee-eeee-eeee-eeeeeeeeee01', 'ffffffff-ffff-ffff-ffff-fffffffff108', 2, 0),
    ('eeeeeeee-eeee-eeee-eeee-eeeeeeeeee02', 'ffffffff-ffff-ffff-ffff-fffffffff108', 0, 2),
    ('eeeeeeee-eeee-eeee-eeee-eeeeeeeeee03', 'ffffffff-ffff-ffff-ffff-fffffffff108', 0, 2),
    ('eeeeeeee-eeee-eeee-eeee-eeeeeeeeee01', 'ffffffff-ffff-ffff-ffff-fffffffff109', 0, 1),
    ('eeeeeeee-eeee-eeee-eeee-eeeeeeeeee02', 'ffffffff-ffff-ffff-ffff-fffffffff109', 0, 1),
    ('eeeeeeee-eeee-eeee-eeee-eeeeeeeeee03', 'ffffffff-ffff-ffff-ffff-fffffffff109', 1, 1),
    ('eeeeeeee-eeee-eeee-eeee-eeeeeeeeee01', 'ffffffff-ffff-ffff-ffff-fffffffff110', 4, 2),
    ('eeeeeeee-eeee-eeee-eeee-eeeeeeeeee02', 'ffffffff-ffff-ffff-ffff-fffffffff110', 3, 1),
    ('eeeeeeee-eeee-eeee-eeee-eeeeeeeeee03', 'ffffffff-ffff-ffff-ffff-fffffffff110', 4, 2),
    ('eeeeeeee-eeee-eeee-eeee-eeeeeeeeee01', 'ffffffff-ffff-ffff-ffff-fffffffff111', 1, 2),
    ('eeeeeeee-eeee-eeee-eeee-eeeeeeeeee02', 'ffffffff-ffff-ffff-ffff-fffffffff111', 0, 1),
    ('eeeeeeee-eeee-eeee-eeee-eeeeeeeeee03', 'ffffffff-ffff-ffff-ffff-fffffffff111', 2, 2),
    ('eeeeeeee-eeee-eeee-eeee-eeeeeeeeee01', 'ffffffff-ffff-ffff-ffff-fffffffff112', 2, 2),
    ('eeeeeeee-eeee-eeee-eeee-eeeeeeeeee02', 'ffffffff-ffff-ffff-ffff-fffffffff112', 1, 1),
    ('eeeeeeee-eeee-eeee-eeee-eeeeeeeeee01', 'ffffffff-ffff-ffff-ffff-fffffffff113', 3, 0),
    ('eeeeeeee-eeee-eeee-eeee-eeeeeeeeee02', 'ffffffff-ffff-ffff-ffff-fffffffff113', 1, 0),
    ('eeeeeeee-eeee-eeee-eeee-eeeeeeeeee01', 'ffffffff-ffff-ffff-ffff-fffffffff114', 1, 1),
    ('eeeeeeee-eeee-eeee-eeee-eeeeeeeeee02', 'ffffffff-ffff-ffff-ffff-fffffffff114', 0, 0),
    ('eeeeeeee-eeee-eeee-eeee-eeeeeeeeee01', 'ffffffff-ffff-ffff-ffff-fffffffff115', 1, 0),
    ('eeeeeeee-eeee-eeee-eeee-eeeeeeeeee02', 'ffffffff-ffff-ffff-ffff-fffffffff115', 0, 1);

  PERFORM public.recalculate_season_achievements(v_season_id);
END;
$$;

DO $$
DECLARE
  v_token_a TEXT;
  v_token_b TEXT;
  v_token_c TEXT;
  v_season_id UUID;
  v_payload JSONB;
  v_count INTEGER;
  v_before TEXT;
  v_after TEXT;
BEGIN
  SELECT l.session_token INTO v_token_a
  FROM public.login_player('test-code-aln', 'eeeeeeee-eeee-eeee-eeee-eeeeeeeeee01', '1234') AS l;
  SELECT l.session_token INTO v_token_b
  FROM public.login_player('test-code-aln', 'eeeeeeee-eeee-eeee-eeee-eeeeeeeeee02', '1234') AS l;
  SELECT l.session_token INTO v_token_c
  FROM public.login_player('test-code-aln', 'eeeeeeee-eeee-eeee-eeee-eeeeeeeeee03', '1234') AS l;
  v_season_id := public.get_active_season_id();

  -- Avant verrouillage : aucun agrégat collectif.
  v_payload := public.get_match_group_reveal(v_token_a, v_season_id, 'ffffffff-ffff-ffff-ffff-fffffffff101');
  IF (v_payload->>'revealed')::BOOLEAN IS NOT FALSE THEN
    RAISE EXCEPTION 'TEST FAIL: reveal open should be false';
  END IF;
  IF v_payload ? 'participants' OR v_payload ? 'participantCount' OR v_payload ? 'percentages' THEN
    RAISE EXCEPTION 'TEST FAIL: aggregated data leaked before kickoff';
  END IF;
  IF (v_payload->'myPrediction'->>'homeScore')::INTEGER <> 2 THEN
    RAISE EXCEPTION 'TEST FAIL: own prediction missing before kickoff';
  END IF;

  -- get_visible_predictions : match verrouillé visible, futur privé.
  SELECT COUNT(*)::INTEGER INTO v_count
  FROM public.get_visible_predictions(v_token_a) AS pr
  WHERE pr.player_id = 'eeeeeeee-eeee-eeee-eeee-eeeeeeeeee02'
    AND pr.match_id = 'ffffffff-ffff-ffff-ffff-fffffffff102';
  IF v_count <> 1 THEN
    RAISE EXCEPTION 'TEST FAIL: locked match should reveal other predictions';
  END IF;

  SELECT COUNT(*)::INTEGER INTO v_count
  FROM public.get_visible_predictions(v_token_a) AS pr
  WHERE pr.player_id = 'eeeeeeee-eeee-eeee-eeee-eeeeeeeeee02'
    AND pr.match_id = 'ffffffff-ffff-ffff-ffff-fffffffff115';
  IF v_count <> 0 THEN
    RAISE EXCEPTION 'TEST FAIL: future match leaked through visible predictions';
  END IF;

  -- Après verrouillage : agrégats et détails visibles.
  v_payload := public.get_match_group_reveal(v_token_a, v_season_id, 'ffffffff-ffff-ffff-ffff-fffffffff102');
  IF (v_payload->>'revealed')::BOOLEAN IS NOT TRUE THEN
    RAISE EXCEPTION 'TEST FAIL: locked match should be revealed';
  END IF;
  IF jsonb_array_length(v_payload->'participants') <> 4 THEN
    RAISE EXCEPTION 'TEST FAIL: participant list length';
  END IF;
  IF (v_payload->>'participantCount')::INTEGER <> 4 THEN
    RAISE EXCEPTION 'TEST FAIL: participant count mismatch';
  END IF;
  IF (v_payload->>'nonParticipantCount')::INTEGER <> 0 THEN
    RAISE EXCEPTION 'TEST FAIL: non-participant count mismatch';
  END IF;
  IF (v_payload->'percentages'->>'victory')::NUMERIC <> 50.0 THEN
    RAISE EXCEPTION 'TEST FAIL: victory percentage mismatch';
  END IF;
  IF NOT EXISTS (
    SELECT 1
    FROM jsonb_array_elements_text(v_payload->'mostPlayedScores') AS item
    WHERE item = '2-1'
  ) THEN
    RAISE EXCEPTION 'TEST FAIL: most played score missing';
  END IF;
  IF NOT EXISTS (
    SELECT 1
    FROM jsonb_array_elements_text(v_payload->'uniqueScores') AS item
    WHERE item = '1-1'
  ) THEN
    RAISE EXCEPTION 'TEST FAIL: unique score missing';
  END IF;

  -- Session invalide / directe.
  BEGIN
    PERFORM public.get_match_group_reveal(repeat('0', 64), v_season_id, 'ffffffff-ffff-ffff-ffff-fffffffff102');
    RAISE EXCEPTION 'TEST FAIL: invalid session accepted for reveal';
  EXCEPTION
    WHEN OTHERS THEN
      IF SQLSTATE <> '28000' AND SQLERRM NOT LIKE '%INVALID_SESSION%' THEN
        RAISE;
      END IF;
  END;

  IF has_table_privilege('anon', 'public.predictions', 'SELECT') THEN
    RAISE EXCEPTION 'TEST FAIL: anon should not read predictions directly';
  END IF;

  -- Classement/scores inchangés avant/après recalcul complet.
  SELECT string_agg(format('%s:%s:%s', r.id, r.points, r.exact_scores), '|' ORDER BY r.id)
  INTO v_before
  FROM public.get_season_ranking(v_token_a, v_season_id) AS r
  WHERE r.id IN (
    'eeeeeeee-eeee-eeee-eeee-eeeeeeeeee01',
    'eeeeeeee-eeee-eeee-eeee-eeeeeeeeee02',
    'eeeeeeee-eeee-eeee-eeee-eeeeeeeeee03'
  );

  PERFORM public.recalculate_season_achievements(v_season_id);

  SELECT string_agg(format('%s:%s:%s', r.id, r.points, r.exact_scores), '|' ORDER BY r.id)
  INTO v_after
  FROM public.get_season_ranking(v_token_a, v_season_id) AS r
  WHERE r.id IN (
    'eeeeeeee-eeee-eeee-eeee-eeeeeeeeee01',
    'eeeeeeee-eeee-eeee-eeee-eeeeeeeeee02',
    'eeeeeeee-eeee-eeee-eeee-eeeeeeeeee03'
  );

  IF v_before IS DISTINCT FROM v_after THEN
    RAISE EXCEPTION 'TEST FAIL: ranking changed after deterministic backfill';
  END IF;
END;
$$;

DO $$
DECLARE
  v_token TEXT;
  v_season_id UUID;
  v_payload JSONB;
  v_count INTEGER;
BEGIN
  SELECT l.session_token INTO v_token
  FROM public.login_player('test-code-aln', 'eeeeeeee-eeee-eeee-eeee-eeeeeeeeee01', '1234') AS l;
  v_season_id := public.get_active_season_id();

  -- Trophées initiaux et répétables.
  SELECT COUNT(*)::INTEGER INTO v_count
  FROM public.player_trophies AS pt
  WHERE pt.player_id = 'eeeeeeee-eeee-eeee-eeee-eeeeeeeeee01'
    AND pt.season_id = v_season_id
    AND pt.is_active = TRUE
    AND pt.trophy_key = 'first_participation';
  IF v_count <> 1 THEN
    RAISE EXCEPTION 'TEST FAIL: first participation missing';
  END IF;

  SELECT COUNT(*)::INTEGER INTO v_count
  FROM public.player_trophies AS pt
  WHERE pt.player_id = 'eeeeeeee-eeee-eeee-eeee-eeeeeeeeee01'
    AND pt.season_id = v_season_id
    AND pt.is_active = TRUE
    AND pt.trophy_key = 'first_exact_score';
  IF v_count <> 1 THEN
    RAISE EXCEPTION 'TEST FAIL: first exact missing';
  END IF;

  SELECT COUNT(*)::INTEGER INTO v_count
  FROM public.player_trophies AS pt
  WHERE pt.player_id = 'eeeeeeee-eeee-eeee-eeee-eeeeeeeeee01'
    AND pt.season_id = v_season_id
    AND pt.is_active = TRUE
    AND pt.trophy_key = 'double_precision';
  IF v_count <> 1 THEN
    RAISE EXCEPTION 'TEST FAIL: double precision missing';
  END IF;

  SELECT COUNT(*)::INTEGER INTO v_count
  FROM public.player_trophies AS pt
  WHERE pt.player_id = 'eeeeeeee-eeee-eeee-eeee-eeeeeeeeee01'
    AND pt.season_id = v_season_id
    AND pt.is_active = TRUE
    AND pt.trophy_key = 'bien_vu';
  IF v_count <> 1 THEN
    RAISE EXCEPTION 'TEST FAIL: bien vu missing';
  END IF;

  SELECT COUNT(*)::INTEGER INTO v_count
  FROM public.player_trophies AS pt
  WHERE pt.player_id = 'eeeeeeee-eeee-eeee-eeee-eeeeeeeeee01'
    AND pt.season_id = v_season_id
    AND pt.is_active = TRUE
    AND pt.trophy_key = 'fidele_au_poste';
  IF v_count <> 1 THEN
    RAISE EXCEPTION 'TEST FAIL: 5-match participation streak missing';
  END IF;

  SELECT COUNT(*)::INTEGER INTO v_count
  FROM public.player_trophies AS pt
  WHERE pt.player_id = 'eeeeeeee-eeee-eeee-eeee-eeeeeeeeee01'
    AND pt.season_id = v_season_id
    AND pt.is_active = TRUE
    AND pt.trophy_key = 'serie_en_or';
  IF v_count <> 1 THEN
    RAISE EXCEPTION 'TEST FAIL: 10-match participation streak missing';
  END IF;

  SELECT COUNT(*)::INTEGER INTO v_count
  FROM public.player_trophies AS pt
  WHERE pt.season_id = v_season_id
    AND pt.is_active = TRUE
    AND pt.trophy_key = 'champion_de_la_journee'
    AND pt.source_round_number = 71;
  IF v_count <> 2 THEN
    RAISE EXCEPTION 'TEST FAIL: champion tie should award two players';
  END IF;

  SELECT COUNT(*)::INTEGER INTO v_count
  FROM public.player_trophies AS pt
  WHERE pt.season_id = v_season_id
    AND pt.is_active = TRUE
    AND pt.trophy_key = 'seul_contre_tous'
    AND pt.source_match_id = 'ffffffff-ffff-ffff-ffff-fffffffff108';
  IF v_count <> 1 THEN
    RAISE EXCEPTION 'TEST FAIL: seul contre tous missing';
  END IF;

  -- Statistiques et notifications.
  v_payload := public.get_player_trophy_overview(v_token, v_season_id);
  IF (v_payload->'stats'->>'currentPredictionStreak')::INTEGER < 10 THEN
    RAISE EXCEPTION 'TEST FAIL: current prediction streak should be at least 10';
  END IF;
  IF (v_payload->'stats'->>'bestExactStreak')::INTEGER < 2 THEN
    RAISE EXCEPTION 'TEST FAIL: best exact streak should be at least 2';
  END IF;
  IF jsonb_array_length(v_payload->'pendingCelebrations') = 0 THEN
    RAISE EXCEPTION 'TEST FAIL: pending celebrations expected';
  END IF;
  IF NOT EXISTS (
    SELECT 1
    FROM jsonb_array_elements(v_payload->'earnedTrophies') AS trophy
    WHERE trophy.value->>'trophyKey' = 'first_participation'
      AND trophy.value->>'sourceMatchLabel' IS NOT NULL
  ) THEN
    RAISE EXCEPTION 'TEST FAIL: earned trophy should expose sourceMatchLabel';
  END IF;

  PERFORM public.acknowledge_trophy_celebrations(v_token, v_season_id);
  v_payload := public.get_player_trophy_overview(v_token, v_season_id);
  IF jsonb_array_length(v_payload->'pendingCelebrations') <> 0 THEN
    RAISE EXCEPTION 'TEST FAIL: celebrations should disappear after acknowledgement';
  END IF;

  -- Idempotence.
  PERFORM public.recalculate_season_achievements(v_season_id);
  PERFORM public.recalculate_season_achievements(v_season_id);
  SELECT COUNT(*)::INTEGER INTO v_count
  FROM public.player_trophies AS pt
  WHERE pt.player_id = 'eeeeeeee-eeee-eeee-eeee-eeeeeeeeee01'
    AND pt.season_id = v_season_id
    AND pt.trophy_key = 'fidele_au_poste';
  IF v_count <> 1 THEN
    RAISE EXCEPTION 'TEST FAIL: idempotence duplicated a unique trophy';
  END IF;
END;
$$;

DO $$
DECLARE
  v_season_id UUID := public.get_active_season_id();
  v_count INTEGER;
  v_source UUID;
BEGIN
  -- Correction de résultat : retire / invalide les trophées non justifiés.
  UPDATE public.matches
  SET
    home_score = 0,
    away_score = 2,
    updated_at = now()
  WHERE id = 'ffffffff-ffff-ffff-ffff-fffffffff104';

  PERFORM public.recalculate_points_for_match('ffffffff-ffff-ffff-ffff-fffffffff104');

  SELECT COUNT(*)::INTEGER, MIN(pt.source_match_id::TEXT)::UUID
  INTO v_count, v_source
  FROM public.player_trophies AS pt
  WHERE pt.player_id = 'eeeeeeee-eeee-eeee-eeee-eeeeeeeeee01'
    AND pt.season_id = v_season_id
    AND pt.trophy_key = 'double_precision'
    AND pt.is_active = TRUE;

  IF v_count <> 1 THEN
    RAISE EXCEPTION 'TEST FAIL: double precision should remain unique after correction';
  END IF;

  IF v_source = 'ffffffff-ffff-ffff-ffff-fffffffff104' THEN
    RAISE EXCEPTION 'TEST FAIL: trophy provenance should move after correction';
  END IF;

  SELECT COUNT(*)::INTEGER INTO v_count
  FROM public.player_trophies AS pt
  WHERE pt.player_id = 'eeeeeeee-eeee-eeee-eeee-eeeeeeeeee01'
    AND pt.season_id = v_season_id
    AND pt.trophy_key = 'double_precision'
    AND pt.is_active = TRUE
    AND pt.source_match_id = v_source;
  IF v_count <> 1 THEN
    RAISE EXCEPTION 'TEST FAIL: active trophy provenance not updated after correction';
  END IF;
END;
$$;

ROLLBACK;
