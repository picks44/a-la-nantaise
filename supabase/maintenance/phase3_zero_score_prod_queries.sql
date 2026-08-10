-- =============================================================================
-- Phase 3 — Requêtes PRODUCTION préparées (NE PAS EXÉCUTER sans GO humain)
-- =============================================================================
-- Backup : snapshot UNIQUEMENT des lignes susceptibles d'être invalidées
--   - first_participation actifs
--   - champion_de_la_journee actifs sur journées dont MAX(SUM points joueur) = 0
-- Nom unique/versionné — ne pas réutiliser CREATE TABLE IF NOT EXISTS.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- 0) Saison active
-- ---------------------------------------------------------------------------
SELECT id, slug, name, is_active, starts_at, ends_at
FROM public.seasons
WHERE is_active = TRUE;

-- ---------------------------------------------------------------------------
-- 1) Totaux SUM par joueur / journée (base champion — jamais MAX match seul)
-- ---------------------------------------------------------------------------
WITH active_season AS (
  SELECT id FROM public.seasons WHERE is_active = TRUE LIMIT 1
),
round_player_totals AS (
  SELECT
    m.round_number,
    pr.player_id,
    p.display_name,
    SUM(pr.points)::INT AS round_points
  FROM public.predictions pr
  JOIN public.matches m ON m.id = pr.match_id
  JOIN public.players p ON p.id = pr.player_id
  JOIN active_season s ON s.id = m.season_id
  WHERE m.status = 'finished'
    AND pr.points IS NOT NULL
  GROUP BY m.round_number, pr.player_id, p.display_name
),
round_max AS (
  SELECT round_number, MAX(round_points)::INT AS max_round_points
  FROM round_player_totals
  GROUP BY round_number
)
SELECT
  t.round_number,
  t.display_name,
  t.round_points,
  m.max_round_points,
  (m.max_round_points > 0 AND t.round_points = m.max_round_points)
    AS would_be_champion_under_new_rule
FROM round_player_totals t
JOIN round_max m USING (round_number)
ORDER BY t.round_number, t.round_points DESC, t.display_name;

-- ---------------------------------------------------------------------------
-- 2) first_participation actifs
-- ---------------------------------------------------------------------------
WITH active_season AS (
  SELECT id FROM public.seasons WHERE is_active = TRUE LIMIT 1
)
SELECT
  pt.id,
  p.display_name,
  pt.award_key,
  pt.source_round_number,
  pt.awarded_at,
  pt.presented_at,
  pt.rule_version
FROM public.player_trophies pt
JOIN public.players p ON p.id = pt.player_id
JOIN active_season s ON s.id = pt.season_id
WHERE pt.is_active = TRUE
  AND pt.trophy_key = 'first_participation'
ORDER BY p.display_name;

-- ---------------------------------------------------------------------------
-- 3) Champions invalides (journée dont le meilleur SUM = 0)
-- ---------------------------------------------------------------------------
WITH active_season AS (
  SELECT id FROM public.seasons WHERE is_active = TRUE LIMIT 1
),
round_player_totals AS (
  SELECT m.round_number, pr.player_id, SUM(pr.points)::INT AS round_points
  FROM public.predictions pr
  JOIN public.matches m ON m.id = pr.match_id
  JOIN active_season s ON s.id = m.season_id
  WHERE m.status = 'finished' AND pr.points IS NOT NULL
  GROUP BY m.round_number, pr.player_id
),
zero_max_rounds AS (
  SELECT round_number
  FROM round_player_totals
  GROUP BY round_number
  HAVING MAX(round_points) = 0
)
SELECT
  pt.id,
  p.display_name,
  pt.award_key,
  pt.source_round_number,
  pt.awarded_at,
  pt.presented_at
FROM public.player_trophies pt
JOIN public.players p ON p.id = pt.player_id
JOIN active_season s ON s.id = pt.season_id
JOIN zero_max_rounds z ON z.round_number = pt.source_round_number
WHERE pt.is_active = TRUE
  AND pt.trophy_key = 'champion_de_la_journee'
ORDER BY pt.source_round_number, p.display_name;

-- ---------------------------------------------------------------------------
-- 4) Counts avant recalcul vs attendus après
-- ---------------------------------------------------------------------------
WITH active_season AS (
  SELECT id FROM public.seasons WHERE is_active = TRUE LIMIT 1
),
round_player_totals AS (
  SELECT m.round_number, pr.player_id, SUM(pr.points)::INT AS round_points
  FROM public.predictions pr
  JOIN public.matches m ON m.id = pr.match_id
  JOIN active_season s ON s.id = m.season_id
  WHERE m.status = 'finished' AND pr.points IS NOT NULL
  GROUP BY m.round_number, pr.player_id
),
zero_max_rounds AS (
  SELECT round_number
  FROM round_player_totals
  GROUP BY round_number
  HAVING MAX(round_points) = 0
)
SELECT
  p.display_name,
  pss.trophies_count AS stored_count,
  COUNT(pt.id) FILTER (WHERE pt.is_active) AS active_total,
  COUNT(pt.id) FILTER (
    WHERE pt.is_active AND pt.trophy_key = 'first_participation'
  ) AS active_fp,
  COUNT(pt.id) FILTER (
    WHERE pt.is_active
      AND pt.trophy_key = 'champion_de_la_journee'
      AND pt.source_round_number IN (SELECT round_number FROM zero_max_rounds)
  ) AS active_invalid_champions,
  COUNT(pt.id) FILTER (
    WHERE pt.is_active
      AND pt.trophy_key <> 'first_participation'
      AND NOT (
        pt.trophy_key = 'champion_de_la_journee'
        AND pt.source_round_number IN (SELECT round_number FROM zero_max_rounds)
      )
  ) AS expected_count_after_recalc
FROM public.player_season_stats pss
JOIN public.players p ON p.id = pss.player_id
JOIN active_season s ON s.id = pss.season_id
LEFT JOIN public.player_trophies pt
  ON pt.player_id = pss.player_id AND pt.season_id = pss.season_id
GROUP BY p.display_name, pss.trophies_count
ORDER BY p.display_name;

-- ---------------------------------------------------------------------------
-- 5) BACKUP (GO humain requis) — nom unique, échec si déjà existant
--    Remplacer YYYYMMDDHHMM par l'horodatage réel au moment de l'exécution.
-- ---------------------------------------------------------------------------
-- Pré-check :
--   SELECT to_regclass('public._backup_aln_trophy_fix_YYYYMMDDHHMM');
--   -- doit retourner NULL
--
-- CREATE TABLE public._backup_aln_trophy_fix_YYYYMMDDHHMM AS
-- WITH active_season AS (
--   SELECT id FROM public.seasons WHERE is_active = TRUE LIMIT 1
-- ),
-- round_player_totals AS (
--   SELECT m.round_number, pr.player_id, SUM(pr.points)::INT AS round_points
--   FROM public.predictions pr
--   JOIN public.matches m ON m.id = pr.match_id
--   JOIN active_season s ON s.id = m.season_id
--   WHERE m.status = 'finished' AND pr.points IS NOT NULL
--   GROUP BY m.round_number, pr.player_id
-- ),
-- zero_max_rounds AS (
--   SELECT round_number
--   FROM round_player_totals
--   GROUP BY round_number
--   HAVING MAX(round_points) = 0
-- )
-- SELECT pt.*
-- FROM public.player_trophies pt
-- JOIN active_season s ON s.id = pt.season_id
-- WHERE pt.is_active = TRUE
--   AND (
--     pt.trophy_key = 'first_participation'
--     OR (
--       pt.trophy_key = 'champion_de_la_journee'
--       AND pt.source_round_number IN (SELECT round_number FROM zero_max_rounds)
--     )
--   );
--
-- Vérif lignes :
--   SELECT COUNT(*) FROM public._backup_aln_trophy_fix_YYYYMMDDHHMM;

-- ---------------------------------------------------------------------------
-- 6) RECALCUL (GO humain séparé, après deploy SQL)
--    Remplacer <season_id> par l'id de la saison active.
-- ---------------------------------------------------------------------------
-- SELECT public.recalculate_season_achievements('<season_id>');

-- ---------------------------------------------------------------------------
-- 7) Vérifs post-recalcul (mêmes SELECT 2/3/4 — active_fp et
--    active_invalid_champions doivent être 0 ; stored_count = expected)
-- ---------------------------------------------------------------------------
