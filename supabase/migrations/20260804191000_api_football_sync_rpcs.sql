-- À la Nantaise — RPCs de synchronisation API-Football (service_role + admin)

-- Accès service_role aux helpers quota / tables nécessaires
GRANT EXECUTE ON FUNCTION public.provider_reserve_api_call(TEXT, TEXT, UUID, UUID)
  TO service_role;
GRANT EXECUTE ON FUNCTION public.provider_finalize_api_call(
  UUID, TEXT, INTEGER, INTEGER, INTEGER, INTEGER, TEXT, TEXT, INTEGER, INTEGER
) TO service_role;
GRANT EXECUTE ON FUNCTION public.provider_utc_today() TO service_role;

GRANT SELECT, UPDATE ON TABLE public.provider_settings TO service_role;
GRANT SELECT, INSERT, UPDATE ON TABLE public.provider_competitions TO service_role;
GRANT SELECT, INSERT, UPDATE ON TABLE public.provider_fixtures TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.provider_fixture_events
  TO service_role;
GRANT SELECT, INSERT, UPDATE ON TABLE public.provider_sync_conflicts TO service_role;
GRANT SELECT, INSERT, UPDATE ON TABLE public.provider_api_quota_days TO service_role;
GRANT SELECT, INSERT, UPDATE ON TABLE public.provider_api_calls TO service_role;
GRANT SELECT ON TABLE public.matches TO service_role;
GRANT SELECT ON TABLE public.seasons TO service_role;

CREATE OR REPLACE FUNCTION public.provider_update_coverage(
  p_external_league_id INTEGER,
  p_external_season_year INTEGER,
  p_name TEXT,
  p_country TEXT,
  p_competition_type TEXT,
  p_coverage_events BOOLEAN,
  p_coverage_lineups BOOLEAN,
  p_coverage_statistics_fixtures BOOLEAN,
  p_coverage_statistics_players BOOLEAN,
  p_coverage_accessible BOOLEAN,
  p_error_code TEXT DEFAULT NULL,
  p_error_message TEXT DEFAULT NULL
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  v_id UUID;
BEGIN
  INSERT INTO public.provider_competitions (
    external_league_id,
    external_season_year,
    name,
    country,
    competition_type,
    coverage_events,
    coverage_lineups,
    coverage_statistics_fixtures,
    coverage_statistics_players,
    coverage_checked_at,
    coverage_accessible,
    last_error_code,
    last_error_message,
    enabled
  )
  VALUES (
    p_external_league_id,
    p_external_season_year,
    COALESCE(NULLIF(trim(p_name), ''), 'Competition ' || p_external_league_id),
    NULLIF(trim(COALESCE(p_country, '')), ''),
    NULLIF(trim(COALESCE(p_competition_type, '')), ''),
    p_coverage_events,
    p_coverage_lineups,
    p_coverage_statistics_fixtures,
    p_coverage_statistics_players,
    now(),
    p_coverage_accessible,
    NULLIF(trim(COALESCE(p_error_code, '')), ''),
    NULLIF(left(trim(COALESCE(p_error_message, '')), 500), ''),
    TRUE
  )
  ON CONFLICT (external_league_id, external_season_year)
  DO UPDATE SET
    name = EXCLUDED.name,
    country = COALESCE(EXCLUDED.country, public.provider_competitions.country),
    competition_type = COALESCE(
      EXCLUDED.competition_type,
      public.provider_competitions.competition_type
    ),
    coverage_events = EXCLUDED.coverage_events,
    coverage_lineups = EXCLUDED.coverage_lineups,
    coverage_statistics_fixtures = EXCLUDED.coverage_statistics_fixtures,
    coverage_statistics_players = EXCLUDED.coverage_statistics_players,
    coverage_checked_at = now(),
    coverage_accessible = EXCLUDED.coverage_accessible,
    last_error_code = EXCLUDED.last_error_code,
    last_error_message = EXCLUDED.last_error_message,
    updated_at = now()
  RETURNING id INTO v_id;

  UPDATE public.provider_settings
  SET last_coverage_check_at = now()
  WHERE id = 1;

  RETURN v_id;
END;
$$;

REVOKE ALL ON FUNCTION public.provider_update_coverage(
  INTEGER, INTEGER, TEXT, TEXT, TEXT,
  BOOLEAN, BOOLEAN, BOOLEAN, BOOLEAN, BOOLEAN, TEXT, TEXT
) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.provider_update_coverage(
  INTEGER, INTEGER, TEXT, TEXT, TEXT,
  BOOLEAN, BOOLEAN, BOOLEAN, BOOLEAN, BOOLEAN, TEXT, TEXT
) FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION public.provider_update_coverage(
  INTEGER, INTEGER, TEXT, TEXT, TEXT,
  BOOLEAN, BOOLEAN, BOOLEAN, BOOLEAN, BOOLEAN, TEXT, TEXT
) TO service_role;

CREATE OR REPLACE FUNCTION public.provider_upsert_fixture_shadow(
  p_fixture JSONB
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  v_external_id TEXT := NULLIF(trim(p_fixture->>'external_fixture_id'), '');
  v_id UUID;
  v_event JSONB;
  v_events JSONB := COALESCE(p_fixture->'events', '[]'::JSONB);
BEGIN
  IF v_external_id IS NULL THEN
    RAISE EXCEPTION 'INVALID_INPUT'
      USING ERRCODE = '22023',
            DETAIL = 'external_fixture_id requis.';
  END IF;

  INSERT INTO public.provider_fixtures (
    provider,
    external_fixture_id,
    season_id,
    match_id,
    external_league_id,
    external_season_year,
    round_label,
    round_number,
    home_team,
    away_team,
    home_team_external_id,
    away_team_external_id,
    kickoff_at,
    venue_name,
    provider_status_raw,
    provider_status_normalized,
    live_elapsed,
    live_extra,
    live_period,
    live_home_score,
    live_away_score,
    ht_home_score,
    ht_away_score,
    proposed_home_score,
    proposed_away_score,
    lineups_json,
    events_json,
    statistics_json,
    players_statistics_json,
    provider_updated_at,
    last_synced_at,
    sync_state,
    sync_error,
    applied_to_match
  )
  VALUES (
    'api_football',
    v_external_id,
    NULLIF(p_fixture->>'season_id', '')::UUID,
    NULLIF(p_fixture->>'match_id', '')::UUID,
    (p_fixture->>'external_league_id')::INTEGER,
    (p_fixture->>'external_season_year')::INTEGER,
    NULLIF(p_fixture->>'round_label', ''),
    NULLIF(p_fixture->>'round_number', '')::INTEGER,
    trim(p_fixture->>'home_team'),
    trim(p_fixture->>'away_team'),
    NULLIF(p_fixture->>'home_team_external_id', '')::INTEGER,
    NULLIF(p_fixture->>'away_team_external_id', '')::INTEGER,
    (p_fixture->>'kickoff_at')::TIMESTAMPTZ,
    NULLIF(p_fixture->>'venue_name', ''),
    COALESCE(NULLIF(p_fixture->>'provider_status_raw', ''), 'NS'),
    COALESCE(NULLIF(p_fixture->>'provider_status_normalized', ''), 'scheduled'),
    NULLIF(p_fixture->>'live_elapsed', '')::INTEGER,
    NULLIF(p_fixture->>'live_extra', '')::INTEGER,
    NULLIF(p_fixture->>'live_period', ''),
    NULLIF(p_fixture->>'live_home_score', '')::INTEGER,
    NULLIF(p_fixture->>'live_away_score', '')::INTEGER,
    NULLIF(p_fixture->>'ht_home_score', '')::INTEGER,
    NULLIF(p_fixture->>'ht_away_score', '')::INTEGER,
    NULLIF(p_fixture->>'proposed_home_score', '')::INTEGER,
    NULLIF(p_fixture->>'proposed_away_score', '')::INTEGER,
    COALESCE(p_fixture->'lineups', '[]'::JSONB),
    COALESCE(p_fixture->'events', '[]'::JSONB),
    COALESCE(p_fixture->'statistics', '[]'::JSONB),
    COALESCE(p_fixture->'players_statistics', '[]'::JSONB),
    NULLIF(p_fixture->>'provider_updated_at', '')::TIMESTAMPTZ,
    now(),
    COALESCE(NULLIF(p_fixture->>'sync_state', ''), 'synced'),
    NULLIF(p_fixture->>'sync_error', ''),
    FALSE
  )
  ON CONFLICT (provider, external_fixture_id)
  DO UPDATE SET
    season_id = COALESCE(
      EXCLUDED.season_id,
      public.provider_fixtures.season_id
    ),
    match_id = COALESCE(EXCLUDED.match_id, public.provider_fixtures.match_id),
    external_league_id = EXCLUDED.external_league_id,
    external_season_year = EXCLUDED.external_season_year,
    round_label = EXCLUDED.round_label,
    round_number = EXCLUDED.round_number,
    home_team = EXCLUDED.home_team,
    away_team = EXCLUDED.away_team,
    home_team_external_id = EXCLUDED.home_team_external_id,
    away_team_external_id = EXCLUDED.away_team_external_id,
    kickoff_at = EXCLUDED.kickoff_at,
    venue_name = EXCLUDED.venue_name,
    provider_status_raw = EXCLUDED.provider_status_raw,
    provider_status_normalized = EXCLUDED.provider_status_normalized,
    live_elapsed = EXCLUDED.live_elapsed,
    live_extra = EXCLUDED.live_extra,
    live_period = EXCLUDED.live_period,
    live_home_score = EXCLUDED.live_home_score,
    live_away_score = EXCLUDED.live_away_score,
    ht_home_score = EXCLUDED.ht_home_score,
    ht_away_score = EXCLUDED.ht_away_score,
    proposed_home_score = EXCLUDED.proposed_home_score,
    proposed_away_score = EXCLUDED.proposed_away_score,
    lineups_json = EXCLUDED.lineups_json,
    events_json = EXCLUDED.events_json,
    statistics_json = EXCLUDED.statistics_json,
    players_statistics_json = EXCLUDED.players_statistics_json,
    provider_updated_at = EXCLUDED.provider_updated_at,
    last_synced_at = now(),
    sync_state = EXCLUDED.sync_state,
    sync_error = EXCLUDED.sync_error,
    -- Jamais d’application automatique en shadow.
    applied_to_match = FALSE,
    updated_at = now()
  RETURNING id INTO v_id;

  DELETE FROM public.provider_fixture_events
  WHERE provider_fixture_id = v_id;

  FOR v_event IN SELECT * FROM jsonb_array_elements(v_events)
  LOOP
    INSERT INTO public.provider_fixture_events (
      provider_fixture_id,
      external_event_key,
      event_type,
      detail,
      period,
      elapsed,
      extra,
      team_side,
      player_name,
      assist_name,
      sort_period,
      sort_elapsed,
      sort_extra,
      raw_json
    )
    VALUES (
      v_id,
      COALESCE(
        NULLIF(v_event->>'external_event_key', ''),
        md5(v_event::TEXT)
      ),
      COALESCE(NULLIF(v_event->>'event_type', ''), 'unknown'),
      NULLIF(v_event->>'detail', ''),
      NULLIF(v_event->>'period', ''),
      NULLIF(v_event->>'elapsed', '')::INTEGER,
      NULLIF(v_event->>'extra', '')::INTEGER,
      NULLIF(v_event->>'team_side', ''),
      NULLIF(v_event->>'player_name', ''),
      NULLIF(v_event->>'assist_name', ''),
      COALESCE(NULLIF(v_event->>'sort_period', '')::INTEGER, 0),
      COALESCE(NULLIF(v_event->>'elapsed', '')::INTEGER, 0),
      COALESCE(NULLIF(v_event->>'extra', '')::INTEGER, 0),
      v_event
    )
    ON CONFLICT (provider_fixture_id, external_event_key) DO NOTHING;
  END LOOP;

  RETURN v_id;
END;
$$;

REVOKE ALL ON FUNCTION public.provider_upsert_fixture_shadow(JSONB) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.provider_upsert_fixture_shadow(JSONB)
  FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION public.provider_upsert_fixture_shadow(JSONB)
  TO service_role;

CREATE OR REPLACE FUNCTION public.provider_record_sync_conflict(
  p_external_fixture_id TEXT,
  p_reason TEXT,
  p_candidate_match_ids UUID[],
  p_payload JSONB DEFAULT '{}'::JSONB
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  v_id UUID;
BEGIN
  INSERT INTO public.provider_sync_conflicts (
    provider,
    external_fixture_id,
    reason,
    candidate_match_ids,
    payload_json,
    resolved
  )
  VALUES (
    'api_football',
    trim(p_external_fixture_id),
    trim(p_reason),
    COALESCE(p_candidate_match_ids, '{}'),
    COALESCE(p_payload, '{}'::JSONB),
    FALSE
  )
  ON CONFLICT (provider, external_fixture_id, reason)
  DO UPDATE SET
    candidate_match_ids = EXCLUDED.candidate_match_ids,
    payload_json = EXCLUDED.payload_json,
    resolved = FALSE,
    resolved_at = NULL,
    resolved_match_id = NULL
  RETURNING id INTO v_id;

  RETURN v_id;
END;
$$;

REVOKE ALL ON FUNCTION public.provider_record_sync_conflict(
  TEXT, TEXT, UUID[], JSONB
) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.provider_record_sync_conflict(
  TEXT, TEXT, UUID[], JSONB
) FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION public.provider_record_sync_conflict(
  TEXT, TEXT, UUID[], JSONB
) TO service_role;

CREATE OR REPLACE FUNCTION public.provider_get_sync_context()
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  v_settings public.provider_settings%ROWTYPE;
  v_day DATE := public.provider_utc_today();
  v_quota public.provider_api_quota_days%ROWTYPE;
  v_active_season UUID;
BEGIN
  SELECT * INTO v_settings FROM public.provider_settings WHERE id = 1;
  SELECT * INTO v_quota FROM public.provider_api_quota_days WHERE quota_date = v_day;
  v_active_season := public.get_active_season_id();

  RETURN jsonb_build_object(
    'settings', jsonb_build_object(
      'integration_enabled', v_settings.integration_enabled,
      'shadow_enabled', v_settings.shadow_enabled,
      'public_provider_enabled', v_settings.public_provider_enabled,
      'tracked_team_external_id', v_settings.tracked_team_external_id,
      'tracked_team_name', v_settings.tracked_team_name,
      'tracked_team_verified_at', v_settings.tracked_team_verified_at,
      'active_season_year', v_settings.active_season_year,
      'daily_quota_limit', v_settings.daily_quota_limit,
      'quota_reserve', v_settings.quota_reserve,
      'next_scheduled_call_at', v_settings.next_scheduled_call_at,
      'last_coverage_check_at', v_settings.last_coverage_check_at
    ),
    'quota', jsonb_build_object(
      'quota_date', v_day,
      'reserved_count', COALESCE(v_quota.reserved_count, 0),
      'consumed_count', COALESCE(v_quota.consumed_count, 0),
      'released_count', COALESCE(v_quota.released_count, 0),
      'remaining_usable', GREATEST(
        v_settings.daily_quota_limit
          - v_settings.quota_reserve
          - COALESCE(v_quota.reserved_count, 0)
          - COALESCE(v_quota.consumed_count, 0),
        0
      )
    ),
    'active_season_id', v_active_season,
    'competitions', COALESCE(
      (
        SELECT jsonb_agg(
          jsonb_build_object(
            'id', c.id,
            'external_league_id', c.external_league_id,
            'external_season_year', c.external_season_year,
            'name', c.name,
            'enabled', c.enabled,
            'coverage_events', c.coverage_events,
            'coverage_lineups', c.coverage_lineups,
            'coverage_statistics_fixtures', c.coverage_statistics_fixtures,
            'coverage_statistics_players', c.coverage_statistics_players,
            'coverage_accessible', c.coverage_accessible
          )
          ORDER BY c.name
        )
        FROM public.provider_competitions AS c
        WHERE c.enabled
      ),
      '[]'::JSONB
    ),
    'matches', COALESCE(
      (
        SELECT jsonb_agg(
          jsonb_build_object(
            'id', m.id,
            'season_id', m.season_id,
            'external_id', m.external_id,
            'source', m.source,
            'round_number', m.round_number,
            'home_team', m.home_team,
            'away_team', m.away_team,
            'kickoff_at', m.kickoff_at,
            'status', m.status,
            'manual_override', m.manual_override,
            'kickoff_time_confirmed', m.kickoff_time_confirmed,
            'home_score', m.home_score,
            'away_score', m.away_score,
            'official_result_source', m.official_result_source
          )
          ORDER BY m.kickoff_at
        )
        FROM public.matches AS m
        WHERE m.season_id = v_active_season
      ),
      '[]'::JSONB
    ),
    'provider_fixtures', COALESCE(
      (
        SELECT jsonb_agg(
          jsonb_build_object(
            'id', f.id,
            'external_fixture_id', f.external_fixture_id,
            'match_id', f.match_id,
            'kickoff_at', f.kickoff_at,
            'provider_status_normalized', f.provider_status_normalized,
            'last_synced_at', f.last_synced_at,
            'external_league_id', f.external_league_id,
            'external_season_year', f.external_season_year
          )
          ORDER BY f.kickoff_at
        )
        FROM public.provider_fixtures AS f
        WHERE f.kickoff_at >= (now() - interval '2 days')
           OR f.provider_status_normalized NOT IN (
             'finished', 'cancelled', 'abandoned', 'awarded'
           )
      ),
      '[]'::JSONB
    )
  );
END;
$$;

REVOKE ALL ON FUNCTION public.provider_get_sync_context() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.provider_get_sync_context() FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION public.provider_get_sync_context() TO service_role;

CREATE OR REPLACE FUNCTION public.provider_set_next_scheduled_call(
  p_next_at TIMESTAMPTZ
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
BEGIN
  UPDATE public.provider_settings
  SET next_scheduled_call_at = p_next_at
  WHERE id = 1;
END;
$$;

REVOKE ALL ON FUNCTION public.provider_set_next_scheduled_call(TIMESTAMPTZ)
  FROM PUBLIC;
REVOKE ALL ON FUNCTION public.provider_set_next_scheduled_call(TIMESTAMPTZ)
  FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION public.provider_set_next_scheduled_call(TIMESTAMPTZ)
  TO service_role;

CREATE OR REPLACE FUNCTION public.provider_set_tracked_team(
  p_external_id INTEGER,
  p_name TEXT,
  p_season_year INTEGER DEFAULT NULL
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
BEGIN
  UPDATE public.provider_settings
  SET
    tracked_team_external_id = p_external_id,
    tracked_team_name = NULLIF(trim(p_name), ''),
    tracked_team_verified_at = now(),
    active_season_year = COALESCE(p_season_year, active_season_year),
    shadow_enabled = TRUE,
    public_provider_enabled = FALSE
  WHERE id = 1;
END;
$$;

REVOKE ALL ON FUNCTION public.provider_set_tracked_team(INTEGER, TEXT, INTEGER)
  FROM PUBLIC;
REVOKE ALL ON FUNCTION public.provider_set_tracked_team(INTEGER, TEXT, INTEGER)
  FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION public.provider_set_tracked_team(INTEGER, TEXT, INTEGER)
  TO service_role;
