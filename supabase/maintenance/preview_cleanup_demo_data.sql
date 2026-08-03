-- =============================================================================
-- À la Nantaise — PRÉVISUALISATION lecture seule du nettoyage démo
-- Fichier : supabase/maintenance/preview_cleanup_demo_data.sql
-- =============================================================================
-- Aucun DELETE. Aucune écriture. Exécuter avant cleanup_demo_data.sql.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- Participants qui seraient supprimés (tous sauf « Vincent », casse ignorée)
-- ---------------------------------------------------------------------------
SELECT
  p.id,
  p.display_name,
  p.is_active,
  p.created_at,
  'SERAIT_SUPPRIME'::TEXT AS action
FROM public.players AS p
WHERE lower(trim(p.display_name)) IS DISTINCT FROM lower('Vincent')
ORDER BY p.display_name;

-- ---------------------------------------------------------------------------
-- Matchs qui seraient supprimés (hors source exacte 'fixturedownload')
-- ---------------------------------------------------------------------------
SELECT
  m.id,
  m.external_id,
  m.source,
  m.round_number,
  m.home_team,
  m.away_team,
  m.kickoff_at,
  m.status,
  'SERAIT_SUPPRIME'::TEXT AS action
FROM public.matches AS m
WHERE m.source IS DISTINCT FROM 'fixturedownload'
ORDER BY m.kickoff_at, m.round_number;

-- ---------------------------------------------------------------------------
-- Nombre de pronostics qui seraient supprimés (tous)
-- ---------------------------------------------------------------------------
SELECT
  count(*)::BIGINT AS pronostics_qui_seraient_supprimes
FROM public.predictions;

-- ---------------------------------------------------------------------------
-- Les 34 matchs qui seraient conservés (source = 'fixturedownload')
-- ---------------------------------------------------------------------------
SELECT
  m.id,
  m.external_id,
  m.source,
  m.round_number,
  m.home_team,
  m.away_team,
  m.kickoff_at,
  m.status,
  m.home_score,
  m.away_score,
  m.manual_override,
  m.last_synced_at,
  'SERAIT_CONSERVE'::TEXT AS action
FROM public.matches AS m
WHERE m.source = 'fixturedownload'
ORDER BY m.round_number, m.kickoff_at;

-- ---------------------------------------------------------------------------
-- Contrôles rapides (lecture seule) — doivent coller aux garde-fous du cleanup
-- ---------------------------------------------------------------------------
SELECT
  (
    SELECT count(*)
    FROM public.players AS p
    WHERE lower(trim(p.display_name)) = lower('Vincent')
  ) AS participants_vincent,
  (
    SELECT count(*)
    FROM public.matches AS m
    WHERE m.source = 'fixturedownload'
  ) AS matchs_fixturedownload,
  (
    SELECT count(DISTINCT m.external_id)
    FROM public.matches AS m
    WHERE m.source = 'fixturedownload'
      AND m.external_id IS NOT NULL
      AND length(trim(m.external_id)) > 0
  ) AS external_id_uniques,
  (
    SELECT count(DISTINCT m.round_number)
    FROM public.matches AS m
    WHERE m.source = 'fixturedownload'
  ) AS journees_distinctes,
  (
    SELECT count(*)
    FROM public.players AS p
    WHERE lower(trim(p.display_name)) IS DISTINCT FROM lower('Vincent')
  ) AS participants_a_supprimer,
  (
    SELECT count(*)
    FROM public.matches AS m
    WHERE m.source IS DISTINCT FROM 'fixturedownload'
  ) AS matchs_a_supprimer,
  (
    SELECT count(*)
    FROM public.predictions
  ) AS pronostics_a_supprimer;
