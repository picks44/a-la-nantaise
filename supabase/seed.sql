-- Données de test pour « À la Nantaise » (stack dev uniquement).
-- Chargé par `supabase db reset` via [db.seed] → ./seed.sql.
-- La stack test a sql_paths = [] et utilise --no-seed : ce fichier n’y passe jamais.
-- Codes / PIN ci-dessous = locaux uniquement (jamais la prod).
--
-- CONTRAT LOCAL (seed standard) :
--   codes d’accès + joueurs déterministes uniquement.
--   Aucun match, aucun pronostic, aucun calendrier fictif.
--   Compatible avec une sync Fixture Download ultérieure (lot S2).
--   Ne pas réintroduire de matchs source=manual / external_id seed-j*.
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
-- Calendrier : vide jusqu’à setup réaliste (S2) ou création manuelle admin.

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
