-- Données de test pour « À la Nantaise » (stack dev uniquement).
-- Chargé par `supabase db reset` via [db.seed] → ./seed.sql.
-- La stack test a sql_paths = [] et utilise --no-seed : ce fichier n’y passe jamais.
-- Codes / PIN / matchs ci-dessous = locaux uniquement (jamais la prod).
--
-- Smoke après reset :
--   groupe  ALN
--   PIN     123456  (tous les joueurs seed)
--   admin   ADMIN
-- Accueil : classement + dernier match + prochain prono ouvert.
-- Calendrier / admin : 4 matchs manuels (J1–J4).

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

-- Matchs démo manuels (la saison active vient de la migration).
-- Pas de source fixturedownload : évite les collisions avec une sync ultérieure.
DO $$
DECLARE
  v_season_id UUID := public.get_active_season_id();
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
    -- J1 terminée → classement / dernier match
    (
      '22222222-2222-2222-2222-222222222201',
      v_season_id,
      'seed-j1-home',
      1,
      'FC Nantes',
      'Grenoble',
      now() - interval '7 days',
      TRUE,
      'manual',
      'finished',
      2,
      0,
      'manual'
    ),
    -- J2 terminée → 2e résultat
    (
      '22222222-2222-2222-2222-222222222202',
      v_season_id,
      'seed-j2-away',
      2,
      'Bastia',
      'FC Nantes',
      now() - interval '3 days',
      TRUE,
      'manual',
      'finished',
      1,
      1,
      'manual'
    ),
    -- J3 ouverte → prochain prono (Home)
    (
      '22222222-2222-2222-2222-222222222203',
      v_season_id,
      'seed-j3-open',
      3,
      'FC Nantes',
      'Rodez',
      now() + interval '2 days',
      TRUE,
      'manual',
      'scheduled',
      NULL,
      NULL,
      'manual'
    ),
    -- J4 horaire non confirmé → UI « Bientôt disponible »
    (
      '22222222-2222-2222-2222-222222222204',
      v_season_id,
      'seed-j4-tbc',
      4,
      'Annecy',
      'FC Nantes',
      (
        date_trunc('day', (now() AT TIME ZONE 'Europe/Paris') + interval '14 days')
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

-- Pronos notés sur J1 / J2 (points déjà posés pour un classement vivant)
INSERT INTO public.predictions (
  player_id,
  match_id,
  predicted_home_score,
  predicted_away_score,
  points
) VALUES
  -- J1 Nantes 2-0 Grenoble
  ('11111111-1111-1111-1111-111111111101', '22222222-2222-2222-2222-222222222201', 2, 0, 3), -- Vincent exact
  ('11111111-1111-1111-1111-111111111102', '22222222-2222-2222-2222-222222222201', 1, 0, 1), -- Léa issue
  ('11111111-1111-1111-1111-111111111103', '22222222-2222-2222-2222-222222222201', 0, 2, 0), -- Max raté
  ('11111111-1111-1111-1111-111111111104', '22222222-2222-2222-2222-222222222201', 3, 1, 1), -- Sophie issue
  ('11111111-1111-1111-1111-111111111105', '22222222-2222-2222-2222-222222222201', 2, 1, 1), -- Thomas issue
  -- J2 Bastia 1-1 Nantes
  ('11111111-1111-1111-1111-111111111101', '22222222-2222-2222-2222-222222222202', 1, 1, 3), -- Vincent exact
  ('11111111-1111-1111-1111-111111111102', '22222222-2222-2222-2222-222222222202', 0, 0, 1), -- Léa issue
  ('11111111-1111-1111-1111-111111111106', '22222222-2222-2222-2222-222222222202', 2, 0, 0), -- Camille raté
  ('11111111-1111-1111-1111-111111111107', '22222222-2222-2222-2222-222222222202', 1, 1, 3), -- Julien exact
  ('11111111-1111-1111-1111-111111111108', '22222222-2222-2222-2222-222222222202', 0, 1, 1)  -- Nina issue
ON CONFLICT (player_id, match_id) DO NOTHING;
