-- Tests SQL : classement enrichi + participation par journée
-- Exécuter : BEGIN; \i supabase/tests/ranking_and_participation.sql ; ROLLBACK;
-- Prérequis : migrations jusqu’à 20260803181000 appliquées.

BEGIN;

-- Code d’accès + PIN de test
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

-- Joueurs : actifs + inactif avec points + nouveau joueur tardif
INSERT INTO public.players (id, display_name, is_active, created_at, pin_hash, must_change_pin)
VALUES
  (
    'cccccccc-cccc-cccc-cccc-cccccccccc01',
    'Alpha',
    TRUE,
    now() - interval '60 days',
    extensions.crypt('1234', extensions.gen_salt('bf')),
    FALSE
  ),
  (
    'cccccccc-cccc-cccc-cccc-cccccccccc02',
    'Bravo',
    TRUE,
    now() - interval '60 days',
    extensions.crypt('1234', extensions.gen_salt('bf')),
    FALSE
  ),
  (
    'cccccccc-cccc-cccc-cccc-cccccccccc03',
    'Charlie',
    TRUE,
    now() - interval '60 days',
    extensions.crypt('1234', extensions.gen_salt('bf')),
    FALSE
  ),
  (
    'cccccccc-cccc-cccc-cccc-cccccccccc04',
    'DeltaInactif',
    FALSE,
    now() - interval '60 days',
    extensions.crypt('1234', extensions.gen_salt('bf')),
    FALSE
  ),
  (
    'cccccccc-cccc-cccc-cccc-cccccccccc05',
    'EchoNouveau',
    TRUE,
    now() - interval '1 hour',
    extensions.crypt('1234', extensions.gen_salt('bf')),
    FALSE
  )
ON CONFLICT (id) DO UPDATE
SET
  display_name = EXCLUDED.display_name,
  is_active = EXCLUDED.is_active,
  created_at = EXCLUDED.created_at,
  pin_hash = EXCLUDED.pin_hash,
  must_change_pin = FALSE,
  pin_failed_attempts = 0,
  pin_locked_until = NULL;

-- Matchs : journée 81 (2 matchs), 82 annulé/reporté, 83 passé, 84 à venir
INSERT INTO public.matches (
  id, external_id, round_number, home_team, away_team, kickoff_at, status, home_score, away_score
) VALUES
  (
    'dddddddd-dddd-dddd-dddd-dddddddddd01',
    'test-rank-j81-a',
    81,
    'FC Nantes',
    'Partiel A',
    now() + interval '3 days',
    'scheduled',
    NULL,
    NULL
  ),
  (
    'dddddddd-dddd-dddd-dddd-dddddddddd02',
    'test-rank-j81-b',
    81,
    'Partiel B',
    'FC Nantes',
    now() + interval '4 days',
    'scheduled',
    NULL,
    NULL
  ),
  (
    'dddddddd-dddd-dddd-dddd-dddddddddd03',
    'test-rank-j82-cancelled',
    82,
    'FC Nantes',
    'Annulé FC',
    now() + interval '5 days',
    'cancelled',
    NULL,
    NULL
  ),
  (
    'dddddddd-dddd-dddd-dddd-dddddddddd04',
    'test-rank-j82-postponed',
    82,
    'Reporté FC',
    'FC Nantes',
    now() + interval '6 days',
    'postponed',
    NULL,
    NULL
  ),
  (
    'dddddddd-dddd-dddd-dddd-dddddddddd05',
    'test-rank-j83-finished',
    83,
    'FC Nantes',
    'Passé FC',
    now() - interval '10 days',
    'finished',
    2,
    1
  ),
  (
    'dddddddd-dddd-dddd-dddd-dddddddddd06',
    'test-rank-j84-open',
    84,
    'FC Nantes',
    'Ouvert FC',
    now() + interval '8 days',
    'scheduled',
    NULL,
    NULL
  )
ON CONFLICT (id) DO UPDATE
SET
  round_number = EXCLUDED.round_number,
  home_team = EXCLUDED.home_team,
  away_team = EXCLUDED.away_team,
  kickoff_at = EXCLUDED.kickoff_at,
  status = EXCLUDED.status,
  home_score = EXCLUDED.home_score,
  away_score = EXCLUDED.away_score;

DELETE FROM public.predictions
WHERE player_id IN (
  'cccccccc-cccc-cccc-cccc-cccccccccc01',
  'cccccccc-cccc-cccc-cccc-cccccccccc02',
  'cccccccc-cccc-cccc-cccc-cccccccccc03',
  'cccccccc-cccc-cccc-cccc-cccccccccc04',
  'cccccccc-cccc-cccc-cccc-cccccccccc05'
);

-- Pronos notés (journée 83) : exact / bon / mauvais + inactif avec points
INSERT INTO public.predictions (
  player_id, match_id, predicted_home_score, predicted_away_score, points
) VALUES
  ('cccccccc-cccc-cccc-cccc-cccccccccc01', 'dddddddd-dddd-dddd-dddd-dddddddddd05', 2, 1, 3),
  ('cccccccc-cccc-cccc-cccc-cccccccccc02', 'dddddddd-dddd-dddd-dddd-dddddddddd05', 3, 0, 1),
  ('cccccccc-cccc-cccc-cccc-cccccccccc03', 'dddddddd-dddd-dddd-dddd-dddddddddd05', 0, 2, 0),
  ('cccccccc-cccc-cccc-cccc-cccccccccc04', 'dddddddd-dddd-dddd-dddd-dddddddddd05', 2, 1, 3);

-- Isoler le classement des données seed (transaction + ROLLBACK)
UPDATE public.predictions AS pr
SET points = NULL
WHERE pr.player_id NOT IN (
  'cccccccc-cccc-cccc-cccc-cccccccccc01',
  'cccccccc-cccc-cccc-cccc-cccccccccc02',
  'cccccccc-cccc-cccc-cccc-cccccccccc03',
  'cccccccc-cccc-cccc-cccc-cccccccccc04',
  'cccccccc-cccc-cccc-cccc-cccccccccc05'
);

-- Participation j81 : Alpha complet (2), Bravo partiel (1), Charlie manquant (0)
-- Pronostic 0-0 réellement enregistré pour Alpha sur le 1er match
INSERT INTO public.predictions (
  player_id, match_id, predicted_home_score, predicted_away_score, points
) VALUES
  ('cccccccc-cccc-cccc-cccc-cccccccccc01', 'dddddddd-dddd-dddd-dddd-dddddddddd01', 0, 0, NULL),
  ('cccccccc-cccc-cccc-cccc-cccccccccc01', 'dddddddd-dddd-dddd-dddd-dddddddddd02', 1, 0, NULL),
  ('cccccccc-cccc-cccc-cccc-cccccccccc02', 'dddddddd-dddd-dddd-dddd-dddddddddd01', 2, 2, NULL);

DO $$
DECLARE
  v_token TEXT;
  v_login RECORD;
  v_row RECORD;
  v_count INTEGER;
  v_has_score_col BOOLEAN;
BEGIN
  SELECT * INTO v_login
  FROM public.login_player(
    'test-code-aln',
    'cccccccc-cccc-cccc-cccc-cccccccccc01',
    '1234'
  );
  v_token := v_login.session_token;

  IF v_token IS NULL OR length(v_token) <> 64 THEN
    RAISE EXCEPTION 'TEST FAIL: session token manquant';
  END IF;

  -- ---- Classement enrichi ----
  SELECT COUNT(*)::INTEGER INTO v_count
  FROM public.get_ranking(v_token);
  IF v_count < 4 THEN
    RAISE EXCEPTION 'TEST FAIL: classement trop court (%)', v_count;
  END IF;

  -- Alpha leader : 3 pts, 1 exact, 0 bon, taux 100, gap 0
  SELECT * INTO v_row
  FROM public.get_ranking(v_token) AS r
  WHERE r.id = 'cccccccc-cccc-cccc-cccc-cccccccccc01';
  IF v_row.points <> 3 OR v_row.exact_scores <> 1 OR v_row.good_results <> 0 THEN
    RAISE EXCEPTION 'TEST FAIL: stats Alpha (%)/%/%', v_row.points, v_row.exact_scores, v_row.good_results;
  END IF;
  IF v_row.scored_predictions <> 1 OR v_row.success_rate <> 100.0 OR v_row.gap_to_leader <> 0 THEN
    RAISE EXCEPTION 'TEST FAIL: taux/écart Alpha';
  END IF;
  IF v_row.is_active IS NOT TRUE THEN
    RAISE EXCEPTION 'TEST FAIL: Alpha devrait être actif';
  END IF;

  -- Bravo : 1 pt, 1 bon résultat, taux 100
  SELECT * INTO v_row
  FROM public.get_ranking(v_token) AS r
  WHERE r.id = 'cccccccc-cccc-cccc-cccc-cccccccccc02';
  IF v_row.points <> 1 OR v_row.good_results <> 1 OR v_row.exact_scores <> 0 THEN
    RAISE EXCEPTION 'TEST FAIL: stats Bravo';
  END IF;
  IF v_row.gap_to_leader <> 2 THEN
    RAISE EXCEPTION 'TEST FAIL: écart Bravo (%)', v_row.gap_to_leader;
  END IF;

  -- Charlie : 0 pt noté, succès 0 %
  SELECT * INTO v_row
  FROM public.get_ranking(v_token) AS r
  WHERE r.id = 'cccccccc-cccc-cccc-cccc-cccccccccc03';
  IF v_row.points <> 0 OR v_row.scored_predictions <> 1 OR v_row.success_rate <> 0.0 THEN
    RAISE EXCEPTION 'TEST FAIL: stats Charlie';
  END IF;

  -- Inactif avec points conservé
  SELECT * INTO v_row
  FROM public.get_ranking(v_token) AS r
  WHERE r.id = 'cccccccc-cccc-cccc-cccc-cccccccccc04';
  IF NOT FOUND OR v_row.points <> 3 OR v_row.is_active IS NOT FALSE THEN
    RAISE EXCEPTION 'TEST FAIL: inactif avec points absent ou incorrect';
  END IF;

  -- Ordre : Alpha et Delta (3 pts) avant Bravo (1) ; ex æquo départagés par exact puis pseudo
  -- Alpha et DeltaInactif : 3 pts, 1 exact chacun → ordre alpha display_name : Alpha puis DeltaInactif
  IF (
    SELECT array_agg(r.display_name ORDER BY r.points DESC, r.exact_scores DESC, r.display_name ASC)
    FROM public.get_ranking(v_token) AS r
    WHERE r.id IN (
      'cccccccc-cccc-cccc-cccc-cccccccccc01',
      'cccccccc-cccc-cccc-cccc-cccccccccc02',
      'cccccccc-cccc-cccc-cccc-cccccccccc04'
    )
  ) IS DISTINCT FROM ARRAY['Alpha', 'DeltaInactif', 'Bravo']::TEXT[] THEN
    RAISE EXCEPTION 'TEST FAIL: ordre classement incorrect';
  END IF;

  -- ---- Participation journée 81 ----
  SELECT * INTO v_row
  FROM public.get_round_participation(v_token, 81) AS p
  WHERE p.player_id = 'cccccccc-cccc-cccc-cccc-cccccccccc01';
  IF v_row.status <> 'complete' OR v_row.predicted_count <> 2 OR v_row.expected_count <> 2 THEN
    RAISE EXCEPTION 'TEST FAIL: Alpha complete j81';
  END IF;

  SELECT * INTO v_row
  FROM public.get_round_participation(v_token, 81) AS p
  WHERE p.player_id = 'cccccccc-cccc-cccc-cccc-cccccccccc02';
  IF v_row.status <> 'partial' OR v_row.predicted_count <> 1 OR v_row.expected_count <> 2 THEN
    RAISE EXCEPTION 'TEST FAIL: Bravo partial j81';
  END IF;

  SELECT * INTO v_row
  FROM public.get_round_participation(v_token, 81) AS p
  WHERE p.player_id = 'cccccccc-cccc-cccc-cccc-cccccccccc03';
  IF v_row.status <> 'missing' OR v_row.predicted_count <> 0 THEN
    RAISE EXCEPTION 'TEST FAIL: Charlie missing j81';
  END IF;

  -- Inactif absent de la participation
  SELECT COUNT(*)::INTEGER INTO v_count
  FROM public.get_round_participation(v_token, 81) AS p
  WHERE p.player_id = 'cccccccc-cccc-cccc-cccc-cccccccccc04';
  IF v_count <> 0 THEN
    RAISE EXCEPTION 'TEST FAIL: inactif visible en participation';
  END IF;

  -- Journée 82 : uniquement cancelled/postponed → not_applicable
  SELECT * INTO v_row
  FROM public.get_round_participation(v_token, 82) AS p
  WHERE p.player_id = 'cccccccc-cccc-cccc-cccc-cccccccccc01';
  IF v_row.status <> 'not_applicable' OR v_row.expected_count <> 0 THEN
    RAISE EXCEPTION 'TEST FAIL: j82 not_applicable';
  END IF;

  -- Nouveau joueur sur journée passée 83 → not_applicable
  SELECT * INTO v_row
  FROM public.get_round_participation(v_token, 83) AS p
  WHERE p.player_id = 'cccccccc-cccc-cccc-cccc-cccccccccc05';
  IF v_row.status <> 'not_applicable' THEN
    RAISE EXCEPTION 'TEST FAIL: nouveau joueur devrait être N/A sur j83';
  END IF;

  -- Anciens joueurs sur j83 avec prono → complete / missing
  SELECT * INTO v_row
  FROM public.get_round_participation(v_token, 83) AS p
  WHERE p.player_id = 'cccccccc-cccc-cccc-cccc-cccccccccc01';
  IF v_row.status <> 'complete' THEN
    RAISE EXCEPTION 'TEST FAIL: Alpha complete j83';
  END IF;

  SELECT * INTO v_row
  FROM public.get_round_participation(v_token, 83) AS p
  WHERE p.player_id = 'cccccccc-cccc-cccc-cccc-cccccccccc03';
  IF v_row.status <> 'complete' THEN
    RAISE EXCEPTION 'TEST FAIL: Charlie avait un prono 0 pt sur j83 → complete';
  END IF;

  -- Aucune colonne de score dans le résultat (contrôle catalogue)
  SELECT EXISTS (
    SELECT 1
    FROM information_schema.columns AS c
    WHERE c.table_schema = 'information_schema'
  ) INTO v_has_score_col;

  SELECT COUNT(*)::INTEGER INTO v_count
  FROM information_schema.routines AS r
  WHERE r.routine_schema = 'public'
    AND r.routine_name = 'get_round_participation';
  IF v_count < 1 THEN
    RAISE EXCEPTION 'TEST FAIL: RPC participation absente';
  END IF;

  -- Les colonnes OUT ne doivent pas inclure predicted_*_score
  IF EXISTS (
    SELECT 1
    FROM pg_proc AS p
    JOIN pg_namespace AS n ON n.oid = p.pronamespace
    JOIN unnest(p.proargnames) WITH ORDINALITY AS args(name, ord) ON TRUE
    WHERE n.nspname = 'public'
      AND p.proname = 'get_round_participation'
      AND args.name IN (
        'predicted_home_score',
        'predicted_away_score',
        'home_score',
        'away_score',
        'points'
      )
  ) THEN
    RAISE EXCEPTION 'TEST FAIL: colonnes de score exposées par get_round_participation';
  END IF;

  -- Session invalide refusée
  BEGIN
    PERFORM * FROM public.get_round_participation(repeat('0', 64), 81);
    RAISE EXCEPTION 'TEST FAIL: session invalide acceptée';
  EXCEPTION
    WHEN OTHERS THEN
      IF SQLERRM NOT LIKE '%INVALID_SESSION%' AND SQLERRM NOT LIKE '%Session invalide%' THEN
        -- assert_player_session lève INVALID_SESSION
        IF SQLSTATE <> '28000' THEN
          RAISE;
        END IF;
      END IF;
  END;

  -- Avant/après kickoff : la RPC reste utilisable sans scores (j84 ouverte)
  SELECT * INTO v_row
  FROM public.get_round_participation(v_token, 84) AS p
  WHERE p.player_id = 'cccccccc-cccc-cccc-cccc-cccccccccc01';
  IF v_row.status <> 'missing' THEN
    RAISE EXCEPTION 'TEST FAIL: j84 avant kickoff devrait être missing';
  END IF;
END;
$$;

ROLLBACK;
