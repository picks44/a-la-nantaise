-- Données de test pour « À la Nantaise » (stack dev uniquement).
-- Chargé par `supabase db reset` via [db.seed] → ./seed.sql.
-- La stack test a sql_paths = [] et utilise --no-seed : ce fichier n’y passe jamais.
-- Codes / PIN / matchs ci-dessous = locaux uniquement (jamais la prod).
--
-- CONTRAT LOCAL : scénarios temporels garantis uniquement après
--   supabase db reset
-- (stack dev, ports 54xxx). Pas conçu pour rafraîchir les dates sur une
-- base déjà seedée (ON CONFLICT DO NOTHING conserve d’anciennes dates).
--
-- Section protégée (accès) : du commentaire « Codes d’accès locaux » jusqu’à
-- l’INSERT joueurs inclus — ne pas modifier valeurs, UUID, noms, codes, PIN.
--
-- Après reset : vérifier les invariants (sans secrets) via
--   supabase/maintenance/verify_seed_invariants.sql
--
-- Smoke après reset :
--   groupe  ALN
--   PIN     123456  (tous les joueurs seed)
--   admin   ADMIN
-- Accueil : classement + dernier match + prochain prono ouvert.
-- Calendrier / admin : 7 matchs manuels (J1–J7) — voir bloc matchs.

-- Codes d’accès locaux
UPDATE public.app_settings
SET
  value = extensions.crypt('ALN', extensions.gen_salt('bf')),
  updated_at = now()
WHERE key = 'access_code_hash';

UPDATE public.app_settings
SET
  value = extensions.crypt('ADMIN', extensions.gen_salt('bf')),
  updated_at = now()
WHERE key = 'admin_code_hash';

-- Joueurs (PIN de démo commun : 123456)
INSERT INTO public.players (id, display_name, is_active, created_at, pin_hash, must_change_pin) VALUES
  ('11111111-1111-1111-1111-111111111101', 'Vincent', TRUE, '2026-07-01T10:00:00Z', extensions.crypt('123456', extensions.gen_salt('bf')), FALSE),
  ('11111111-1111-1111-1111-111111111102', 'Léa', TRUE, '2026-07-01T10:00:00Z', extensions.crypt('123456', extensions.gen_salt('bf')), FALSE),
  ('11111111-1111-1111-1111-111111111103', 'Max', TRUE, '2026-07-01T10:00:00Z', extensions.crypt('123456', extensions.gen_salt('bf')), FALSE),
  ('11111111-1111-1111-1111-111111111104', 'Sophie', TRUE, '2026-07-01T10:00:00Z', extensions.crypt('123456', extensions.gen_salt('bf')), FALSE),
  ('11111111-1111-1111-1111-111111111105', 'Thomas', TRUE, '2026-07-01T10:00:00Z', extensions.crypt('123456', extensions.gen_salt('bf')), FALSE),
  ('11111111-1111-1111-1111-111111111106', 'Camille', TRUE, '2026-07-01T10:00:00Z', extensions.crypt('123456', extensions.gen_salt('bf')), FALSE),
  ('11111111-1111-1111-1111-111111111107', 'Julien', TRUE, '2026-07-01T10:00:00Z', extensions.crypt('123456', extensions.gen_salt('bf')), FALSE),
  ('11111111-1111-1111-1111-111111111108', 'Nina', TRUE, '2026-07-01T10:00:00Z', extensions.crypt('123456', extensions.gen_salt('bf')), FALSE)
ON CONFLICT (id) DO NOTHING;

-- LOCAL TEST DATA: matchs manuels (saison active via migration).
-- Pas de source fixturedownload : évite les collisions avec une sync ultérieure.
-- Dates : une seule référence v_ref := now() ; offsets relatifs (reveal / lock).
-- Ordre chronologique kickoff = round_number.
-- UI attendue (deriveUiStatusFromMatch) :
--   finished → finished ; !confirmed → kickoff_unconfirmed ;
--   confirmed + kickoff passé + non finished → locked ;
--   confirmed + kickoff futur → to_predict (sans prono).
-- Pas de live / postponed / cancelled dans ce lot.
DO $$
DECLARE
  v_season_id UUID := public.get_active_season_id();
  v_ref TIMESTAMPTZ := now();
BEGIN
  INSERT INTO public.matches (
    id,
    season_id,
    external_id,
    round_number,
    home_team,
    away_team,
    kickoff_at,
    kickoff_time_confirmed,
    kickoff_confirmation_source,
    status,
    home_score,
    away_score,
    source
  ) VALUES
    -- J1 terminée — victoire Nantes (UI finished)
    (
      '22222222-2222-2222-2222-222222222201',
      v_season_id,
      'seed-j1-home',
      1,
      'FC Nantes',
      'Grenoble',
      v_ref - interval '28 days',
      TRUE,
      'manual',
      'finished',
      2,
      0,
      'manual'
    ),
    -- J2 terminée — nul (UI finished)
    (
      '22222222-2222-2222-2222-222222222202',
      v_season_id,
      'seed-j2-away',
      2,
      'Bastia',
      'FC Nantes',
      v_ref - interval '21 days',
      TRUE,
      'manual',
      'finished',
      1,
      1,
      'manual'
    ),
    -- J3 terminée — défaite Nantes à l'extérieur (UI finished)
    (
      '22222222-2222-2222-2222-222222222205',
      v_season_id,
      'seed-j3-defeat',
      3,
      'Guingamp',
      'FC Nantes',
      v_ref - interval '14 days',
      TRUE,
      'manual',
      'finished',
      2,
      0,
      'manual'
    ),
    -- J4 verrouillé — scheduled + confirmé + kickoff passé, sans score (UI locked)
    (
      '22222222-2222-2222-2222-222222222206',
      v_season_id,
      'seed-j4-locked',
      4,
      'FC Nantes',
      'Amiens',
      v_ref - interval '12 hours',
      TRUE,
      'manual',
      'scheduled',
      NULL,
      NULL,
      'manual'
    ),
    -- J5 ouverte — prochain prono Home (UI to_predict) ; premier futur confirmé
    (
      '22222222-2222-2222-2222-222222222203',
      v_season_id,
      'seed-j5-open',
      5,
      'FC Nantes',
      'Rodez',
      v_ref + interval '2 days',
      TRUE,
      'manual',
      'scheduled',
      NULL,
      NULL,
      'manual'
    ),
    -- J6 futur confirmé — après le prochain ouvert (UI to_predict, pas « next »)
    (
      '22222222-2222-2222-2222-222222222207',
      v_season_id,
      'seed-j6-future',
      6,
      'Laval',
      'FC Nantes',
      v_ref + interval '9 days',
      TRUE,
      'manual',
      'scheduled',
      NULL,
      NULL,
      'manual'
    ),
    -- J7 horaire non confirmé — UI kickoff_unconfirmed « Bientôt disponible »
    (
      '22222222-2222-2222-2222-222222222204',
      v_season_id,
      'seed-j7-tbc',
      7,
      'Annecy',
      'FC Nantes',
      (
        date_trunc('day', (v_ref AT TIME ZONE 'Europe/Paris') + interval '14 days')
        AT TIME ZONE 'Europe/Paris'
      ),
      FALSE,
      'heuristic',
      'scheduled',
      NULL,
      NULL,
      'manual'
    )
  ON CONFLICT (id) DO NOTHING;
END;
$$;

-- LOCAL TEST DATA: pronostics sources (joueurs existants uniquement).
-- Points : laissés NULL — calculés officiellement par
--   recalculate_season_achievements → compute_prediction_points
--   (aussi via recalculate_points_for_match). Aucun trigger INSERT.
-- created_at antérieur au kickoff pour J1–J4 (cohérence temporelle).
-- Pas de prono sur J6 (futur non-next) ni J7 (TBC / upsert interdit métier).
-- ON CONFLICT DO NOTHING ; pas de DELETE / DO UPDATE.
DO $$
DECLARE
  v_ref TIMESTAMPTZ := now();
BEGIN
  INSERT INTO public.predictions (
    id,
    player_id,
    match_id,
    predicted_home_score,
    predicted_away_score,
    points,
    created_at,
    updated_at
  ) VALUES
    -- ========== J1 …201 Nantes 2-0 Grenoble (victoire domicile) ==========
    -- Score le + joué : 2-0 (A+B). Tendance (POV Nantes) : victoire.
    -- Ex æquo journée : A et B à 3 pts (exact).
    (
      '33333333-3333-3333-3333-333333333101',
      '11111111-1111-1111-1111-111111111101',
      '22222222-2222-2222-2222-222222222201',
      2, 0, NULL,
      v_ref - interval '29 days',
      v_ref - interval '29 days'
    ), -- A Vincent exact
    (
      '33333333-3333-3333-3333-333333333102',
      '11111111-1111-1111-1111-111111111102',
      '22222222-2222-2222-2222-222222222201',
      2, 0, NULL,
      v_ref - interval '29 days',
      v_ref - interval '29 days'
    ), -- B Léa exact (même score qu’A)
    (
      '33333333-3333-3333-3333-333333333103',
      '11111111-1111-1111-1111-111111111103',
      '22222222-2222-2222-2222-222222222201',
      1, 0, NULL,
      v_ref - interval '29 days',
      v_ref - interval '29 days'
    ), -- C Max bonne issue
    (
      '33333333-3333-3333-3333-333333333104',
      '11111111-1111-1111-1111-111111111104',
      '22222222-2222-2222-2222-222222222201',
      0, 2, NULL,
      v_ref - interval '29 days',
      v_ref - interval '29 days'
    ), -- D Sophie raté
    (
      '33333333-3333-3333-3333-333333333106',
      '11111111-1111-1111-1111-111111111106',
      '22222222-2222-2222-2222-222222222201',
      3, 1, NULL,
      v_ref - interval '29 days',
      v_ref - interval '29 days'
    ), -- F Camille bonne issue
    (
      '33333333-3333-3333-3333-333333333107',
      '11111111-1111-1111-1111-111111111107',
      '22222222-2222-2222-2222-222222222201',
      0, 1, NULL,
      v_ref - interval '29 days',
      v_ref - interval '29 days'
    ), -- G Julien raté
    -- E Thomas + H Nina absents J1

    -- ========== J2 …202 Bastia 1-1 Nantes (nul) ==========
    -- Scores + joués : 1-1 ×3 (A,B,D) gagne ; 2-2 ×2 (F,G) ; pas d’ex æquo top.
    -- Tendance (POV Nantes) : nul.
    (
      '33333333-3333-3333-3333-333333333201',
      '11111111-1111-1111-1111-111111111101',
      '22222222-2222-2222-2222-222222222202',
      1, 1, NULL,
      v_ref - interval '22 days',
      v_ref - interval '22 days'
    ), -- A Vincent exact (continuité)
    (
      '33333333-3333-3333-3333-333333333202',
      '11111111-1111-1111-1111-111111111102',
      '22222222-2222-2222-2222-222222222202',
      1, 1, NULL,
      v_ref - interval '22 days',
      v_ref - interval '22 days'
    ), -- B Léa exact (continuité + ex æquo saison avec A)
    (
      '33333333-3333-3333-3333-333333333204',
      '11111111-1111-1111-1111-111111111104',
      '22222222-2222-2222-2222-222222222202',
      1, 1, NULL,
      v_ref - interval '22 days',
      v_ref - interval '22 days'
    ), -- D Sophie exact (même score populaire 1-1)
    (
      '33333333-3333-3333-3333-333333333205',
      '11111111-1111-1111-1111-111111111105',
      '22222222-2222-2222-2222-222222222202',
      2, 0, NULL,
      v_ref - interval '22 days',
      v_ref - interval '22 days'
    ), -- E Thomas raté (0 pt)
    (
      '33333333-3333-3333-3333-333333333206',
      '11111111-1111-1111-1111-111111111106',
      '22222222-2222-2222-2222-222222222202',
      2, 2, NULL,
      v_ref - interval '22 days',
      v_ref - interval '22 days'
    ), -- F Camille bonne issue (score 2-2)
    (
      '33333333-3333-3333-3333-333333333207',
      '11111111-1111-1111-1111-111111111107',
      '22222222-2222-2222-2222-222222222202',
      2, 2, NULL,
      v_ref - interval '22 days',
      v_ref - interval '22 days'
    ), -- G Julien bonne issue (même score que F)
    -- C Max + H Nina absents J2 (rupture C après J1)

    -- ========== J3 …205 Guingamp 2-0 Nantes (défaite Nantes) ==========
    -- Tendance (POV Nantes) : défaite (C,D,G = victoire Guingamp). C exact après absence J2.
    (
      '33333333-3333-3333-3333-333333333301',
      '11111111-1111-1111-1111-111111111101',
      '22222222-2222-2222-2222-222222222205',
      0, 2, NULL,
      v_ref - interval '15 days',
      v_ref - interval '15 days'
    ), -- A Vincent raté (baisse après forte série)
    (
      '33333333-3333-3333-3333-333333333302',
      '11111111-1111-1111-1111-111111111102',
      '22222222-2222-2222-2222-222222222205',
      1, 1, NULL,
      v_ref - interval '15 days',
      v_ref - interval '15 days'
    ), -- B Léa raté
    (
      '33333333-3333-3333-3333-333333333303',
      '11111111-1111-1111-1111-111111111103',
      '22222222-2222-2222-2222-222222222205',
      2, 0, NULL,
      v_ref - interval '15 days',
      v_ref - interval '15 days'
    ), -- C Max exact (retour)
    (
      '33333333-3333-3333-3333-333333333304',
      '11111111-1111-1111-1111-111111111104',
      '22222222-2222-2222-2222-222222222205',
      1, 0, NULL,
      v_ref - interval '15 days',
      v_ref - interval '15 days'
    ), -- D Sophie bonne issue
    (
      '33333333-3333-3333-3333-333333333305',
      '11111111-1111-1111-1111-111111111105',
      '22222222-2222-2222-2222-222222222205',
      0, 1, NULL,
      v_ref - interval '15 days',
      v_ref - interval '15 days'
    ), -- E Thomas raté (faible total)
    (
      '33333333-3333-3333-3333-333333333307',
      '11111111-1111-1111-1111-111111111107',
      '22222222-2222-2222-2222-222222222205',
      3, 0, NULL,
      v_ref - interval '15 days',
      v_ref - interval '15 days'
    ), -- G Julien bonne issue
    -- F Camille + H Nina absents J3

    -- ========== J4 …206 verrouillé — paris saisis avant kickoff ==========
    (
      '33333333-3333-3333-3333-333333333401',
      '11111111-1111-1111-1111-111111111101',
      '22222222-2222-2222-2222-222222222206',
      2, 1, NULL,
      v_ref - interval '13 hours',
      v_ref - interval '13 hours'
    ), -- A avant verrouillage
    (
      '33333333-3333-3333-3333-333333333402',
      '11111111-1111-1111-1111-111111111102',
      '22222222-2222-2222-2222-222222222206',
      1, 1, NULL,
      v_ref - interval '13 hours',
      v_ref - interval '13 hours'
    ), -- B avant verrouillage
    (
      '33333333-3333-3333-3333-333333333403',
      '11111111-1111-1111-1111-111111111103',
      '22222222-2222-2222-2222-222222222206',
      2, 1, NULL,
      v_ref - interval '13 hours',
      v_ref - interval '13 hours'
    ), -- C même score qu’A (reveal)

    -- ========== J5 …203 ouvert — points NULL ; mix présent/absent ==========
    (
      '33333333-3333-3333-3333-333333333501',
      '11111111-1111-1111-1111-111111111101',
      '22222222-2222-2222-2222-222222222203',
      2, 0, NULL,
      v_ref - interval '1 hour',
      v_ref - interval '1 hour'
    ), -- A prono ouvert
    (
      '33333333-3333-3333-3333-333333333502',
      '11111111-1111-1111-1111-111111111102',
      '22222222-2222-2222-2222-222222222203',
      1, 1, NULL,
      v_ref - interval '1 hour',
      v_ref - interval '1 hour'
    ) -- B prono ouvert ; C–H sans prono J5
  ON CONFLICT (player_id, match_id) DO NOTHING;
END;
$$;

-- LOCAL TEST DATA: valeurs dérivées (points, stats, trophées).
-- Un seul appel officiel après tous les inserts sources (matchs + pronos).
-- Ne pas écrire player_season_stats / player_trophies à la main.
DO $$
DECLARE
  v_season_id UUID := public.get_active_season_id();
BEGIN
  PERFORM public.recalculate_season_achievements(v_season_id);
END;
$$;
