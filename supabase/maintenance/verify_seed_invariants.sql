-- =============================================================================
-- À la Nantaise — invariants du seed local (lecture seule)
-- Fichier : supabase/maintenance/verify_seed_invariants.sql
-- =============================================================================
-- Prérequis : stack DEV après `supabase db reset` (ports 54xxx).
-- Contrat seed standard : codes + 8 joueurs ; 0 match ; 0 prediction.
-- Aucune écriture. Aucune empreinte de secret attendue. Aucun secret affiché.
-- Usage (après validation humaine du reset) :
--   psql "$DEV_DB_URL" -v ON_ERROR_STOP=1 -f supabase/maintenance/verify_seed_invariants.sql
-- =============================================================================

DO $$
DECLARE
  v_season_id UUID;
  v_player_count INTEGER;
  v_dup_players INTEGER;
  v_missing_pin INTEGER;
  v_access_ok BOOLEAN;
  v_admin_ok BOOLEAN;
  v_match_count INTEGER;
  v_seed_j_count INTEGER;
  v_manual_count INTEGER;
  v_pred_count INTEGER;
BEGIN
  v_season_id := public.get_active_season_id();

  -- ---- Joueurs (8 UUID seed, actifs, uniques, PIN hash présent) ----
  SELECT COUNT(*)::INTEGER INTO v_player_count
  FROM public.players AS p
  WHERE p.id IN (
    '11111111-1111-1111-1111-111111111101',
    '11111111-1111-1111-1111-111111111102',
    '11111111-1111-1111-1111-111111111103',
    '11111111-1111-1111-1111-111111111104',
    '11111111-1111-1111-1111-111111111105',
    '11111111-1111-1111-1111-111111111106',
    '11111111-1111-1111-1111-111111111107',
    '11111111-1111-1111-1111-111111111108'
  )
    AND p.is_active = TRUE;

  IF v_player_count <> 8 THEN
    RAISE EXCEPTION 'SEED_INVARIANT: expected 8 active seed players, got %', v_player_count;
  END IF;

  SELECT COUNT(*)::INTEGER INTO v_dup_players
  FROM (
    SELECT lower(trim(p.display_name)) AS n
    FROM public.players AS p
    GROUP BY 1
    HAVING COUNT(*) > 1
  ) AS d;

  IF v_dup_players <> 0 THEN
    RAISE EXCEPTION 'SEED_INVARIANT: duplicate player display_name detected';
  END IF;

  SELECT COUNT(*)::INTEGER INTO v_missing_pin
  FROM public.players AS p
  WHERE p.id IN (
    '11111111-1111-1111-1111-111111111101',
    '11111111-1111-1111-1111-111111111102',
    '11111111-1111-1111-1111-111111111103',
    '11111111-1111-1111-1111-111111111104',
    '11111111-1111-1111-1111-111111111105',
    '11111111-1111-1111-1111-111111111106',
    '11111111-1111-1111-1111-111111111107',
    '11111111-1111-1111-1111-111111111108'
  )
    AND (p.pin_hash IS NULL OR length(trim(p.pin_hash)) = 0);

  IF v_missing_pin <> 0 THEN
    RAISE EXCEPTION 'SEED_INVARIANT: % seed players missing pin_hash', v_missing_pin;
  END IF;

  -- ---- Accès (présence / non-vide uniquement — jamais la valeur) ----
  SELECT
    EXISTS (
      SELECT 1
      FROM public.app_settings AS s
      WHERE s.key = 'access_code_hash'
        AND length(trim(s.value)) > 0
    ),
    EXISTS (
      SELECT 1
      FROM public.app_settings AS s
      WHERE s.key = 'admin_code_hash'
        AND length(trim(s.value)) > 0
    )
  INTO v_access_ok, v_admin_ok;

  IF NOT v_access_ok OR NOT v_admin_ok THEN
    RAISE EXCEPTION 'SEED_INVARIANT: access/admin code hashes missing or empty';
  END IF;

  -- ---- Calendrier : seed standard = aucun match / aucun prono ----
  SELECT COUNT(*)::INTEGER INTO v_match_count
  FROM public.matches;

  IF v_match_count <> 0 THEN
    RAISE EXCEPTION 'SEED_INVARIANT: expected 0 matches after standard seed, got %', v_match_count;
  END IF;

  SELECT COUNT(*)::INTEGER INTO v_seed_j_count
  FROM public.matches AS m
  WHERE m.external_id LIKE 'seed-j%';

  IF v_seed_j_count <> 0 THEN
    RAISE EXCEPTION 'SEED_INVARIANT: unexpected seed-j* external_id rows: %', v_seed_j_count;
  END IF;

  SELECT COUNT(*)::INTEGER INTO v_manual_count
  FROM public.matches AS m
  WHERE m.source = 'manual';

  IF v_manual_count <> 0 THEN
    RAISE EXCEPTION 'SEED_INVARIANT: expected 0 manual matches after standard seed, got %', v_manual_count;
  END IF;

  SELECT COUNT(*)::INTEGER INTO v_pred_count
  FROM public.predictions;

  IF v_pred_count <> 0 THEN
    RAISE EXCEPTION 'SEED_INVARIANT: expected 0 predictions after standard seed, got %', v_pred_count;
  END IF;

  -- Saison active : déjà garantie par get_active_season_id() (lève SEASON_NOT_FOUND sinon).
  IF v_season_id IS NULL THEN
    RAISE EXCEPTION 'SEED_INVARIANT: active season missing';
  END IF;

  RAISE NOTICE 'SEED_INVARIANTS_OK';
END;
$$;
