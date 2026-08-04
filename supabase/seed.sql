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

-- Les matchs sont volontairement absents du seed. En développement, ils sont
-- importés à la demande avec la synchronisation de fixtures afin d’éviter de
-- mélanger des matchs de démonstration manuels avec les données du fournisseur.
