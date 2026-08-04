-- À la Nantaise — retrait de l’intégration API-Football (shadow)
-- Les migrations 190000 / 191000 restent immuables (déjà appliquées en prod).
-- Cette migration annule leurs objets runtime sans toucher au correctif trophées 192000.

-- ---------------------------------------------------------------------------
-- Garde-fous : interrompre si des données provider réelles existent
-- ---------------------------------------------------------------------------

DO $$
DECLARE
  v_count BIGINT;
  v_details TEXT := '';
BEGIN
  IF to_regclass('public.matches') IS NOT NULL
     AND EXISTS (
       SELECT 1
       FROM information_schema.columns
       WHERE table_schema = 'public'
         AND table_name = 'matches'
         AND column_name = 'source'
     )
  THEN
    SELECT count(*) INTO v_count
    FROM public.matches AS m
    WHERE m.source = 'api_football';

    IF v_count > 0 THEN
      v_details := v_details || format(
        ' matches.source=api_football (%s);',
        v_count
      );
    END IF;
  END IF;

  IF to_regclass('public.matches') IS NOT NULL THEN
    SELECT count(*) INTO v_count
    FROM public.matches AS m
    WHERE (
      (
        EXISTS (
          SELECT 1 FROM information_schema.columns c
          WHERE c.table_schema = 'public'
            AND c.table_name = 'matches'
            AND c.column_name = 'provider_sync_state'
        )
        AND m.provider_sync_state IS DISTINCT FROM 'idle'
      )
      OR (
        EXISTS (
          SELECT 1 FROM information_schema.columns c
          WHERE c.table_schema = 'public'
            AND c.table_name = 'matches'
            AND c.column_name = 'provider_external_team_home_id'
        )
        AND (
          m.provider_external_team_home_id IS NOT NULL
          OR m.provider_external_team_away_id IS NOT NULL
          OR m.provider_external_league_id IS NOT NULL
          OR m.provider_external_season_year IS NOT NULL
          OR m.provider_last_modified_at IS NOT NULL
          OR m.provider_sync_error IS NOT NULL
          OR m.live_status IS NOT NULL
          OR m.live_elapsed IS NOT NULL
          OR m.live_extra IS NOT NULL
          OR m.live_period IS NOT NULL
          OR m.live_home_score IS NOT NULL
          OR m.live_away_score IS NOT NULL
          OR m.live_ht_home_score IS NOT NULL
          OR m.live_ht_away_score IS NOT NULL
          OR m.live_refreshed_at IS NOT NULL
          OR m.provider_proposed_home_score IS NOT NULL
          OR m.provider_proposed_away_score IS NOT NULL
          OR m.provider_proposed_at IS NOT NULL
          -- `manual` (+ date associée) est une saisie admin légitime : ne pas bloquer.
          -- Bloquer uniquement une validation provider ou une provenance incohérente.
          OR (
            m.official_result_source IS NOT NULL
            AND m.official_result_source IS DISTINCT FROM 'manual'
          )
        )
      )
    );

    IF v_count > 0 THEN
      v_details := v_details || format(
        ' matches provider/live/proposal non neutres (%s);',
        v_count
      );
    END IF;
  END IF;

  IF to_regclass('public.provider_fixtures') IS NOT NULL THEN
    SELECT count(*) INTO v_count FROM public.provider_fixtures;
    IF v_count > 0 THEN
      v_details := v_details || format(' provider_fixtures (%s);', v_count);
    END IF;
  END IF;

  IF to_regclass('public.provider_fixture_events') IS NOT NULL THEN
    SELECT count(*) INTO v_count FROM public.provider_fixture_events;
    IF v_count > 0 THEN
      v_details := v_details || format(
        ' provider_fixture_events (%s);',
        v_count
      );
    END IF;
  END IF;

  IF to_regclass('public.provider_sync_conflicts') IS NOT NULL THEN
    SELECT count(*) INTO v_count FROM public.provider_sync_conflicts;
    IF v_count > 0 THEN
      v_details := v_details || format(
        ' provider_sync_conflicts (%s);',
        v_count
      );
    END IF;
  END IF;

  IF to_regclass('public.provider_competitions') IS NOT NULL THEN
    SELECT count(*) INTO v_count FROM public.provider_competitions;
    IF v_count > 0 THEN
      v_details := v_details || format(
        ' provider_competitions (%s);',
        v_count
      );
    END IF;
  END IF;

  IF to_regclass('public.provider_api_calls') IS NOT NULL THEN
    SELECT count(*) INTO v_count FROM public.provider_api_calls;
    IF v_count > 0 THEN
      v_details := v_details || format(' provider_api_calls (%s);', v_count);
    END IF;
  END IF;

  IF to_regclass('public.provider_api_quota_days') IS NOT NULL THEN
    SELECT count(*) INTO v_count
    FROM public.provider_api_quota_days AS q
    WHERE q.reserved_count > 0
       OR q.consumed_count > 0
       OR q.released_count > 0
       OR q.provider_reported_current IS NOT NULL
       OR q.provider_reported_limit IS NOT NULL;
    IF v_count > 0 THEN
      v_details := v_details || format(
        ' provider_api_quota_days significatifs (%s);',
        v_count
      );
    END IF;
  END IF;

  IF to_regclass('public.provider_settings') IS NOT NULL THEN
    SELECT count(*) INTO v_count
    FROM public.provider_settings AS s
    WHERE s.tracked_team_external_id IS NOT NULL
       OR NULLIF(trim(COALESCE(s.tracked_team_name, '')), '') IS NOT NULL
       OR s.tracked_team_verified_at IS NOT NULL
       OR s.active_season_year IS NOT NULL
       OR s.last_successful_call_at IS NOT NULL
       OR s.last_error_at IS NOT NULL
       OR s.last_error_code IS NOT NULL
       OR s.last_error_message IS NOT NULL
       OR s.next_scheduled_call_at IS NOT NULL
       OR s.manual_sync_cooldown_until IS NOT NULL
       OR s.last_coverage_check_at IS NOT NULL
       OR s.integration_enabled IS DISTINCT FROM TRUE
       OR s.shadow_enabled IS DISTINCT FROM TRUE
       OR s.public_provider_enabled IS DISTINCT FROM FALSE
       OR s.daily_quota_limit IS DISTINCT FROM 100
       OR s.quota_reserve IS DISTINCT FROM 10;
    IF v_count > 0 THEN
      v_details := v_details || format(
        ' provider_settings non défaut (%s);',
        v_count
      );
    END IF;
  END IF;

  IF v_details <> '' THEN
    RAISE EXCEPTION
      'API_FOOTBALL_REMOVAL_BLOCKED: données provider détectées — nettoyage manuel requis avant retrait.%',
      v_details
      USING ERRCODE = 'P0001';
  END IF;
END;
$$;

-- ---------------------------------------------------------------------------
-- Supprimer les fonctions (signatures exactes, IF EXISTS)
-- ---------------------------------------------------------------------------

DROP FUNCTION IF EXISTS public.provider_utc_today();
DROP FUNCTION IF EXISTS public.provider_reserve_api_call(TEXT, TEXT, UUID, UUID);
DROP FUNCTION IF EXISTS public.provider_finalize_api_call(
  UUID, TEXT, INTEGER, INTEGER, INTEGER, INTEGER, TEXT, TEXT, INTEGER, INTEGER
);
DROP FUNCTION IF EXISTS public.provider_update_coverage(
  INTEGER, INTEGER, TEXT, TEXT, TEXT,
  BOOLEAN, BOOLEAN, BOOLEAN, BOOLEAN, BOOLEAN, TEXT, TEXT
);
DROP FUNCTION IF EXISTS public.provider_upsert_fixture_shadow(JSONB);
DROP FUNCTION IF EXISTS public.provider_record_sync_conflict(TEXT, TEXT, UUID[], JSONB);
DROP FUNCTION IF EXISTS public.provider_get_sync_context();
DROP FUNCTION IF EXISTS public.provider_set_next_scheduled_call(TIMESTAMPTZ);
DROP FUNCTION IF EXISTS public.provider_set_tracked_team(INTEGER, TEXT, INTEGER);
DROP FUNCTION IF EXISTS public.admin_get_provider_status(TEXT);
DROP FUNCTION IF EXISTS public.admin_get_provider_competitions(TEXT);
DROP FUNCTION IF EXISTS public.admin_upsert_provider_competition(
  TEXT, INTEGER, INTEGER, TEXT, TEXT, TEXT, BOOLEAN
);
DROP FUNCTION IF EXISTS public.admin_update_provider_settings(
  TEXT, BOOLEAN, INTEGER, TEXT, INTEGER, BOOLEAN
);
DROP FUNCTION IF EXISTS public.admin_list_provider_fixtures(TEXT, INTEGER);
DROP FUNCTION IF EXISTS public.admin_list_provider_conflicts(TEXT);
DROP FUNCTION IF EXISTS public.admin_resolve_provider_conflict(TEXT, UUID, UUID);
DROP FUNCTION IF EXISTS public.admin_validate_provider_proposed_result(TEXT, UUID);
DROP FUNCTION IF EXISTS public.admin_begin_provider_manual_sync(TEXT, INTEGER);
DROP FUNCTION IF EXISTS public.get_public_match_center_enabled(TEXT);

-- ---------------------------------------------------------------------------
-- Tables provider (ordre compatible FK)
-- ---------------------------------------------------------------------------

DROP TABLE IF EXISTS public.provider_fixture_events;
DROP TABLE IF EXISTS public.provider_api_calls;
DROP TABLE IF EXISTS public.provider_sync_conflicts;
DROP TABLE IF EXISTS public.provider_fixtures;
DROP TABLE IF EXISTS public.provider_competitions;
DROP TABLE IF EXISTS public.provider_api_quota_days;
DROP TABLE IF EXISTS public.provider_settings;

-- ---------------------------------------------------------------------------
-- Colonnes / contraintes provider sur matches
-- ---------------------------------------------------------------------------

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'matches_provider_sync_state_check'
      AND conrelid = 'public.matches'::regclass
  ) THEN
    ALTER TABLE public.matches DROP CONSTRAINT matches_provider_sync_state_check;
  END IF;

  IF EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'matches_official_result_source_check'
      AND conrelid = 'public.matches'::regclass
  ) THEN
    ALTER TABLE public.matches DROP CONSTRAINT matches_official_result_source_check;
  END IF;

  IF EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'matches_live_scores_both_or_neither'
      AND conrelid = 'public.matches'::regclass
  ) THEN
    ALTER TABLE public.matches DROP CONSTRAINT matches_live_scores_both_or_neither;
  END IF;

  IF EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'matches_provider_proposed_scores_both_or_neither'
      AND conrelid = 'public.matches'::regclass
  ) THEN
    ALTER TABLE public.matches
      DROP CONSTRAINT matches_provider_proposed_scores_both_or_neither;
  END IF;

  IF EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'matches_source_check'
      AND conrelid = 'public.matches'::regclass
  ) THEN
    ALTER TABLE public.matches DROP CONSTRAINT matches_source_check;
  END IF;

  ALTER TABLE public.matches
    ADD CONSTRAINT matches_source_check
    CHECK (source IN ('manual', 'fixturedownload'));
END;
$$;

ALTER TABLE public.matches
  DROP COLUMN IF EXISTS provider_external_team_home_id,
  DROP COLUMN IF EXISTS provider_external_team_away_id,
  DROP COLUMN IF EXISTS provider_external_league_id,
  DROP COLUMN IF EXISTS provider_external_season_year,
  DROP COLUMN IF EXISTS provider_last_modified_at,
  DROP COLUMN IF EXISTS provider_sync_state,
  DROP COLUMN IF EXISTS provider_sync_error,
  DROP COLUMN IF EXISTS live_status,
  DROP COLUMN IF EXISTS live_elapsed,
  DROP COLUMN IF EXISTS live_extra,
  DROP COLUMN IF EXISTS live_period,
  DROP COLUMN IF EXISTS live_home_score,
  DROP COLUMN IF EXISTS live_away_score,
  DROP COLUMN IF EXISTS live_ht_home_score,
  DROP COLUMN IF EXISTS live_ht_away_score,
  DROP COLUMN IF EXISTS live_refreshed_at,
  DROP COLUMN IF EXISTS provider_proposed_home_score,
  DROP COLUMN IF EXISTS provider_proposed_away_score,
  DROP COLUMN IF EXISTS provider_proposed_at,
  DROP COLUMN IF EXISTS official_result_source,
  DROP COLUMN IF EXISTS official_result_validated_at;

-- ---------------------------------------------------------------------------
-- Restaurer admin_set_match_result sans colonnes provider
-- (équivalent post-admin_sessions, avant 190000)
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.admin_set_match_result(
  p_admin_session_token TEXT,
  p_match_id UUID,
  p_home_score INTEGER,
  p_away_score INTEGER
)
RETURNS TABLE (
  id UUID,
  external_id TEXT,
  round_number INTEGER,
  home_team TEXT,
  away_team TEXT,
  kickoff_at TIMESTAMPTZ,
  status TEXT,
  home_score INTEGER,
  away_score INTEGER,
  created_at TIMESTAMPTZ,
  updated_at TIMESTAMPTZ,
  source TEXT,
  last_synced_at TIMESTAMPTZ,
  manual_override BOOLEAN,
  source_home_team TEXT,
  source_away_team TEXT,
  source_kickoff_at TIMESTAMPTZ,
  source_home_score INTEGER,
  source_away_score INTEGER,
  source_status TEXT,
  recalculated_count INTEGER
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  recalc INTEGER := 0;
BEGIN
  PERFORM public.assert_admin_session(p_admin_session_token);

  IF p_match_id IS NULL THEN
    RAISE EXCEPTION 'MATCH_NOT_FOUND'
      USING ERRCODE = 'P0002',
            DETAIL = 'Identifiant de match manquant.';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.matches AS m WHERE m.id = p_match_id
  ) THEN
    RAISE EXCEPTION 'MATCH_NOT_FOUND'
      USING ERRCODE = 'P0002',
            DETAIL = 'Match introuvable.';
  END IF;

  PERFORM public.assert_match_scores('finished', p_home_score, p_away_score);

  UPDATE public.matches AS m
  SET
    status = 'finished',
    home_score = p_home_score,
    away_score = p_away_score,
    manual_override = TRUE,
    updated_at = now()
  WHERE m.id = p_match_id;

  recalc := public.recalculate_points_for_match(p_match_id);

  RETURN QUERY
  SELECT
    m.id,
    m.external_id,
    m.round_number,
    m.home_team,
    m.away_team,
    m.kickoff_at,
    m.status,
    m.home_score,
    m.away_score,
    m.created_at,
    m.updated_at,
    m.source,
    m.last_synced_at,
    m.manual_override,
    m.source_home_team,
    m.source_away_team,
    m.source_kickoff_at,
    m.source_home_score,
    m.source_away_score,
    m.source_status,
    recalc
  FROM public.matches AS m
  WHERE m.id = p_match_id;
END;
$$;

REVOKE ALL ON FUNCTION public.admin_set_match_result(TEXT, UUID, INTEGER, INTEGER)
  FROM PUBLIC;
REVOKE ALL ON FUNCTION public.admin_set_match_result(TEXT, UUID, INTEGER, INTEGER)
  FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION public.admin_set_match_result(TEXT, UUID, INTEGER, INTEGER)
  TO anon, authenticated;
