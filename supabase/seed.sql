-- Données de test pour « À la Nantaise »
-- À exécuter APRÈS la migration, dans le SQL Editor Supabase.
-- Ne contient PAS le code commun (à définir séparément, voir README).

-- Joueurs (créés avant la J1 pour que les séries de participation soient cohérentes)
INSERT INTO public.players (id, display_name, is_active, created_at) VALUES
  ('11111111-1111-1111-1111-111111111101', 'Vincent', TRUE, '2026-07-01T10:00:00Z'),
  ('11111111-1111-1111-1111-111111111102', 'Léa', TRUE, '2026-07-01T10:00:00Z'),
  ('11111111-1111-1111-1111-111111111103', 'Max', TRUE, '2026-07-01T10:00:00Z'),
  ('11111111-1111-1111-1111-111111111104', 'Sophie', TRUE, '2026-07-01T10:00:00Z'),
  ('11111111-1111-1111-1111-111111111105', 'Thomas', TRUE, '2026-07-01T10:00:00Z'),
  ('11111111-1111-1111-1111-111111111106', 'Camille', TRUE, '2026-07-01T10:00:00Z'),
  ('11111111-1111-1111-1111-111111111107', 'Julien', TRUE, '2026-07-01T10:00:00Z'),
  ('11111111-1111-1111-1111-111111111108', 'Nina', TRUE, '2026-07-01T10:00:00Z')
ON CONFLICT (id) DO NOTHING;

-- Matchs (kickoff_at stockés en UTC)
-- J1–J2 terminés, J3 verrouillé (passé), J4–J6 à venir, J7 reporté
INSERT INTO public.matches (
  id, external_id, round_number, home_team, away_team, kickoff_at, status, home_score, away_score
) VALUES
  (
    '22222222-2222-2222-2222-222222222201',
    'ligue2-2026-j1-nantes-pau',
    1,
    'FC Nantes',
    'Pau FC',
    '2026-07-11T15:00:00Z',
    'finished',
    2,
    0
  ),
  (
    '22222222-2222-2222-2222-222222222202',
    'ligue2-2026-j2-laval-nantes',
    2,
    'Stade Lavallois',
    'FC Nantes',
    '2026-07-18T18:00:00Z',
    'finished',
    1,
    2
  ),
  (
    '22222222-2222-2222-2222-222222222203',
    'ligue2-2026-j3-nantes-grenoble',
    3,
    'FC Nantes',
    'Grenoble Foot',
    '2026-07-25T17:00:00Z',
    'live',
    NULL,
    NULL
  ),
  (
    '22222222-2222-2222-2222-222222222204',
    'ligue2-2026-j4-amiens-nantes',
    4,
    'Amiens SC',
    'FC Nantes',
    '2026-08-29T18:00:00Z',
    'scheduled',
    NULL,
    NULL
  ),
  (
    '22222222-2222-2222-2222-222222222205',
    'ligue2-2026-j5-nantes-lorient',
    5,
    'FC Nantes',
    'FC Lorient',
    '2026-09-05T18:00:00Z',
    'scheduled',
    NULL,
    NULL
  ),
  (
    '22222222-2222-2222-2222-222222222206',
    'ligue2-2026-j6-dunkerque-nantes',
    6,
    'USL Dunkerque',
    'FC Nantes',
    '2026-09-12T18:00:00Z',
    'scheduled',
    NULL,
    NULL
  ),
  (
    '22222222-2222-2222-2222-222222222207',
    'ligue2-2026-j7-nantes-rodez',
    7,
    'FC Nantes',
    'Rodez AF',
    '2026-09-19T13:00:00Z',
    'postponed',
    NULL,
    NULL
  )
ON CONFLICT (id) DO NOTHING;

-- Pronostics de test (points selon barème 3 / 1 / 0)
INSERT INTO public.predictions (
  id, player_id, match_id, predicted_home_score, predicted_away_score, points
) VALUES
  -- Vincent J1 : 1-0 vs 2-0 → bon résultat (1)
  (
    '33333333-3333-3333-3333-333333333301',
    '11111111-1111-1111-1111-111111111101',
    '22222222-2222-2222-2222-222222222201',
    1, 0, 1
  ),
  -- Vincent J2 : 1-2 exact (3)
  (
    '33333333-3333-3333-3333-333333333302',
    '11111111-1111-1111-1111-111111111101',
    '22222222-2222-2222-2222-222222222202',
    1, 2, 3
  ),
  -- Vincent J3 : verrouillé
  (
    '33333333-3333-3333-3333-333333333303',
    '11111111-1111-1111-1111-111111111101',
    '22222222-2222-2222-2222-222222222203',
    2, 1, NULL
  ),
  -- Vincent J4 : encore modifiable (selon la date réelle)
  (
    '33333333-3333-3333-3333-333333333304',
    '11111111-1111-1111-1111-111111111101',
    '22222222-2222-2222-2222-222222222204',
    1, 1, NULL
  ),
  -- Léa J1 : 2-0 exact (3)
  (
    '33333333-3333-3333-3333-333333333305',
    '11111111-1111-1111-1111-111111111102',
    '22222222-2222-2222-2222-222222222201',
    2, 0, 3
  ),
  -- Léa J2 : 0-2 bon résultat (1)
  (
    '33333333-3333-3333-3333-333333333306',
    '11111111-1111-1111-1111-111111111102',
    '22222222-2222-2222-2222-222222222202',
    0, 2, 1
  ),
  -- Max J1 : 2-1 mauvais (0)
  (
    '33333333-3333-3333-3333-333333333307',
    '11111111-1111-1111-1111-111111111103',
    '22222222-2222-2222-2222-222222222201',
    2, 1, 0
  ),
  -- Max J2 : 1-2 exact (3)
  (
    '33333333-3333-3333-3333-333333333308',
    '11111111-1111-1111-1111-111111111103',
    '22222222-2222-2222-2222-222222222202',
    1, 2, 3
  ),
  -- Sophie J1 : 3-0 bon résultat (1)
  (
    '33333333-3333-3333-3333-333333333309',
    '11111111-1111-1111-1111-111111111104',
    '22222222-2222-2222-2222-222222222201',
    3, 0, 1
  ),
  -- Thomas J2 : 2-2 mauvais (0)
  (
    '33333333-3333-3333-3333-333333333310',
    '11111111-1111-1111-1111-111111111105',
    '22222222-2222-2222-2222-222222222202',
    2, 2, 0
  ),
  -- Camille J2 : 1-2 exact (3)
  (
    '33333333-3333-3333-3333-333333333311',
    '11111111-1111-1111-1111-111111111106',
    '22222222-2222-2222-2222-222222222202',
    1, 2, 3
  )
ON CONFLICT (player_id, match_id) DO NOTHING;

-- Les points sont pré-renseignés dans le seed : recalculer trophées / séries
-- pour que l’onglet Classement reste cohérent avec le podium.
DO $$
DECLARE
  v_season_id UUID;
BEGIN
  SELECT s.id
  INTO v_season_id
  FROM public.seasons AS s
  WHERE s.is_active = TRUE
  ORDER BY s.starts_at DESC
  LIMIT 1;

  IF v_season_id IS NOT NULL THEN
    PERFORM public.recalculate_season_achievements(v_season_id);
  END IF;
END;
$$;
