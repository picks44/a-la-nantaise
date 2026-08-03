-- Tests manuels / CI SQL pour upsert_prediction
-- Exécuter dans une transaction : BEGIN; \i ... ; ROLLBACK;
-- Ne pas committer : aucune donnée de production ne doit rester.

BEGIN;

-- Prérequis : code d’accès de test (hash bcrypt)
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

-- Joueur et matchs de test (UUID dédiés, hors seed)
INSERT INTO public.players (id, display_name, is_active)
VALUES ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa1', 'Testeur Upsert', TRUE)
ON CONFLICT (id) DO UPDATE
SET display_name = EXCLUDED.display_name, is_active = TRUE;

INSERT INTO public.matches (
  id, external_id, round_number, home_team, away_team, kickoff_at, status
) VALUES
  (
    'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbb1',
    'test-upsert-open',
    99,
    'FC Nantes',
    'Test FC',
    now() + interval '2 days',
    'scheduled'
  ),
  (
    'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbb2',
    'test-upsert-locked',
    99,
    'FC Nantes',
    'Lock FC',
    now() - interval '1 minute',
    'scheduled'
  )
ON CONFLICT (id) DO UPDATE
SET
  kickoff_at = EXCLUDED.kickoff_at,
  status = EXCLUDED.status,
  home_team = EXCLUDED.home_team,
  away_team = EXCLUDED.away_team;

-- Nettoyage éventuel d’anciens pronos de test
DELETE FROM public.predictions AS pr
WHERE pr.player_id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa1'
  AND pr.match_id IN (
    'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbb1',
    'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbb2'
  );

-- 1) Création d’un pronostic
DO $$
DECLARE
  row_count integer;
BEGIN
  PERFORM *
  FROM public.upsert_prediction(
    'test-code-aln',
    'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa1',
    'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbb1',
    2,
    1
  );

  SELECT count(*)::integer INTO row_count
  FROM public.predictions AS pr
  WHERE pr.player_id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa1'
    AND pr.match_id = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbb1'
    AND pr.predicted_home_score = 2
    AND pr.predicted_away_score = 1;

  IF row_count <> 1 THEN
    RAISE EXCEPTION 'TEST FAIL: création du pronostic';
  END IF;
END;
$$;

-- 2) Modification du même pronostic
DO $$
DECLARE
  row_count integer;
  home_score integer;
BEGIN
  PERFORM *
  FROM public.upsert_prediction(
    'test-code-aln',
    'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa1',
    'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbb1',
    3,
    0
  );

  SELECT pr.predicted_home_score, count(*) OVER ()
  INTO home_score, row_count
  FROM public.predictions AS pr
  WHERE pr.player_id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa1'
    AND pr.match_id = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbb1';

  IF home_score <> 3 OR row_count <> 1 THEN
    RAISE EXCEPTION 'TEST FAIL: modification / unicité joueur+match';
  END IF;
END;
$$;

-- 3) Unicité joueur + match (une seule ligne)
DO $$
DECLARE
  row_count integer;
BEGIN
  SELECT count(*)::integer INTO row_count
  FROM public.predictions AS pr
  WHERE pr.player_id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa1'
    AND pr.match_id = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbb1';

  IF row_count <> 1 THEN
    RAISE EXCEPTION 'TEST FAIL: unicité player_id + match_id (%)', row_count;
  END IF;
END;
$$;

-- 4) Refus après le coup d’envoi
DO $$
BEGIN
  BEGIN
    PERFORM *
    FROM public.upsert_prediction(
      'test-code-aln',
      'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa1',
      'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbb2',
      1,
      1
    );
    RAISE EXCEPTION 'TEST FAIL: MATCH_LOCKED attendu';
  EXCEPTION
    WHEN OTHERS THEN
      IF SQLERRM NOT LIKE '%MATCH_LOCKED%' THEN
        RAISE;
      END IF;
  END;
END;
$$;

ROLLBACK;
