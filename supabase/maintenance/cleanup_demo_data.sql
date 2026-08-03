-- =============================================================================
-- À la Nantaise — SCRIPT MANUEL UNIQUE de nettoyage des données de démonstration
-- Fichier : supabase/maintenance/cleanup_demo_data.sql
-- =============================================================================
-- NE PAS exécuter automatiquement (ni via agent, ni via migration).
-- À coller manuellement dans le SQL Editor Supabase, après prévisualisation.
--
-- Prérequis : migration 20260803140000_fixture_download_sync.sql déjà appliquée,
--             et synchronisation Fixture Download déjà effectuée (34 matchs).
--
-- Conserve :
--   - le participant dont le pseudo est « Vincent » (casse ignorée)
--   - les 34 matchs avec matches.source = 'fixturedownload'
--   - app_settings, hashes, schéma, RPC, fonctions
--
-- Supprime :
--   - tous les pronostics
--   - tous les matchs hors source 'fixturedownload'
--   - tous les participants autres que Vincent
-- =============================================================================

BEGIN;

DO $$
DECLARE
  v_vincent_id UUID;
  v_vincent_count INTEGER;
  v_synced_count INTEGER;
  v_external_id_count INTEGER;
  v_round_count INTEGER;
  v_missing_round INTEGER;
  v_bad_nantes_count INTEGER;
  v_players_after INTEGER;
  v_matches_after INTEGER;
  v_predictions_after INTEGER;
  v_manual_after INTEGER;
  v_synced_after INTEGER;
  v_rounds_after INTEGER;
BEGIN
  -- -------------------------------------------------------------------------
  -- Garde-fous (échec = ROLLBACK de toute la transaction)
  -- -------------------------------------------------------------------------

  -- 1. Exactement un participant « Vincent » (casse ignorée)
  SELECT count(*)
  INTO v_vincent_count
  FROM public.players AS p
  WHERE lower(trim(p.display_name)) = lower('Vincent');

  IF v_vincent_count <> 1 THEN
    RAISE EXCEPTION
      'CLEANUP_ABORT: attendu exactement 1 participant « Vincent », trouvé %',
      v_vincent_count;
  END IF;

  SELECT p.id
  INTO v_vincent_id
  FROM public.players AS p
  WHERE lower(trim(p.display_name)) = lower('Vincent');

  -- 2. Exactement 34 matchs synchronisés Fixture Download
  --    Critère exact : matches.source = 'fixturedownload'
  --    (valeur imposée par 20260803140000_fixture_download_sync.sql)
  SELECT count(*)
  INTO v_synced_count
  FROM public.matches AS m
  WHERE m.source = 'fixturedownload';

  IF v_synced_count <> 34 THEN
    RAISE EXCEPTION
      'CLEANUP_ABORT: attendu exactement 34 matchs source=fixturedownload, trouvé %',
      v_synced_count;
  END IF;

  -- 3. Les 34 identifiants externes sont non nuls et uniques
  SELECT count(DISTINCT m.external_id)
  INTO v_external_id_count
  FROM public.matches AS m
  WHERE m.source = 'fixturedownload'
    AND m.external_id IS NOT NULL
    AND length(trim(m.external_id)) > 0;

  IF v_external_id_count <> 34 THEN
    RAISE EXCEPTION
      'CLEANUP_ABORT: attendu 34 external_id uniques non vides parmi les matchs synchronisés, trouvé %',
      v_external_id_count;
  END IF;

  -- 4. Journées 1 à 34 présentes une seule fois chacune
  SELECT count(DISTINCT m.round_number)
  INTO v_round_count
  FROM public.matches AS m
  WHERE m.source = 'fixturedownload';

  IF v_round_count <> 34 THEN
    RAISE EXCEPTION
      'CLEANUP_ABORT: journées non uniques parmi les matchs synchronisés (distincts=%)',
      v_round_count;
  END IF;

  SELECT min(gs.n)
  INTO v_missing_round
  FROM generate_series(1, 34) AS gs(n)
  WHERE NOT EXISTS (
    SELECT 1
    FROM public.matches AS m
    WHERE m.source = 'fixturedownload'
      AND m.round_number = gs.n
  );

  IF v_missing_round IS NOT NULL THEN
    RAISE EXCEPTION
      'CLEANUP_ABORT: journée manquante parmi les matchs synchronisés : %',
      v_missing_round;
  END IF;

  -- 5. Chaque match conservé contient exactement le FC Nantes
  SELECT count(*)
  INTO v_bad_nantes_count
  FROM public.matches AS m
  WHERE m.source = 'fixturedownload'
    AND (
      (
        CASE WHEN lower(trim(m.home_team)) = lower('FC Nantes') THEN 1 ELSE 0 END
        + CASE WHEN lower(trim(m.away_team)) = lower('FC Nantes') THEN 1 ELSE 0 END
      ) <> 1
    );

  IF v_bad_nantes_count <> 0 THEN
    RAISE EXCEPTION
      'CLEANUP_ABORT: % match(s) synchronisé(s) sans exactement le FC Nantes',
      v_bad_nantes_count;
  END IF;

  -- -------------------------------------------------------------------------
  -- Nettoyage (ordre imposé)
  -- -------------------------------------------------------------------------

  -- 1. UUID Vincent déjà mémorisé dans v_vincent_id

  -- 2. Tous les pronostics (données de test uniquement)
  DELETE FROM public.predictions;

  -- 3. Matchs qui ne proviennent pas de Fixture Download
  DELETE FROM public.matches AS m
  WHERE m.source IS DISTINCT FROM 'fixturedownload';

  -- 4. Tous les participants sauf Vincent
  DELETE FROM public.players AS p
  WHERE p.id IS DISTINCT FROM v_vincent_id;

  -- 5. Aucune autre table (app_settings intact)

  -- -------------------------------------------------------------------------
  -- Vérifications post-suppression
  -- -------------------------------------------------------------------------

  SELECT count(*) INTO v_players_after FROM public.players;
  SELECT count(*) INTO v_matches_after FROM public.matches;
  SELECT count(*) INTO v_predictions_after FROM public.predictions;

  SELECT count(*)
  INTO v_manual_after
  FROM public.matches AS m
  WHERE m.source IS DISTINCT FROM 'fixturedownload';

  SELECT count(*)
  INTO v_synced_after
  FROM public.matches AS m
  WHERE m.source = 'fixturedownload';

  SELECT count(DISTINCT m.round_number)
  INTO v_rounds_after
  FROM public.matches AS m
  WHERE m.source = 'fixturedownload'
    AND m.round_number BETWEEN 1 AND 34;

  IF v_players_after <> 1 THEN
    RAISE EXCEPTION
      'CLEANUP_VERIFY_FAIL: participants attendus=1, trouvé=%',
      v_players_after;
  END IF;

  IF v_matches_after <> 34 THEN
    RAISE EXCEPTION
      'CLEANUP_VERIFY_FAIL: matchs attendus=34, trouvé=%',
      v_matches_after;
  END IF;

  IF v_predictions_after <> 0 THEN
    RAISE EXCEPTION
      'CLEANUP_VERIFY_FAIL: pronostics attendus=0, trouvé=%',
      v_predictions_after;
  END IF;

  IF v_manual_after <> 0 THEN
    RAISE EXCEPTION
      'CLEANUP_VERIFY_FAIL: matchs non synchronisés attendus=0, trouvé=%',
      v_manual_after;
  END IF;

  IF v_synced_after <> 34 THEN
    RAISE EXCEPTION
      'CLEANUP_VERIFY_FAIL: matchs fixturedownload attendus=34, trouvé=%',
      v_synced_after;
  END IF;

  IF v_rounds_after <> 34 THEN
    RAISE EXCEPTION
      'CLEANUP_VERIFY_FAIL: journées 1–34 attendues=34, trouvé=%',
      v_rounds_after;
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM public.players AS p
    WHERE p.id = v_vincent_id
      AND lower(trim(p.display_name)) = lower('Vincent')
  ) THEN
    RAISE EXCEPTION 'CLEANUP_VERIFY_FAIL: Vincent introuvable après nettoyage';
  END IF;
END;
$$;

-- Résumé final
SELECT
  (SELECT count(*) FROM public.players) AS participants,
  (SELECT count(*) FROM public.matches) AS matchs,
  (SELECT count(*) FROM public.predictions) AS pronostics,
  (
    SELECT count(*)
    FROM public.matches AS m
    WHERE m.source IS DISTINCT FROM 'fixturedownload'
  ) AS matchs_manuels_ou_autres,
  (
    SELECT count(*)
    FROM public.matches AS m
    WHERE m.source = 'fixturedownload'
  ) AS matchs_synchronises,
  (
    SELECT count(DISTINCT m.round_number)
    FROM public.matches AS m
    WHERE m.source = 'fixturedownload'
      AND m.round_number BETWEEN 1 AND 34
  ) AS journees_1_a_34,
  (
    SELECT p.display_name
    FROM public.players AS p
    LIMIT 1
  ) AS participant_conserve;

COMMIT;
