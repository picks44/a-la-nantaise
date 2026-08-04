-- À la Nantaise — intégration API-Football (mode shadow)
-- Réutilise seasons / matches.season_id. Aucune activation publique.

-- ---------------------------------------------------------------------------
-- Étendre matches : live fournisseur + proposition de résultat (non officielle)
-- ---------------------------------------------------------------------------

ALTER TABLE public.matches
  ADD COLUMN IF NOT EXISTS provider_external_team_home_id INTEGER,
  ADD COLUMN IF NOT EXISTS provider_external_team_away_id INTEGER,
  ADD COLUMN IF NOT EXISTS provider_external_league_id INTEGER,
  ADD COLUMN IF NOT EXISTS provider_external_season_year INTEGER,
  ADD COLUMN IF NOT EXISTS provider_last_modified_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS provider_sync_state TEXT NOT NULL DEFAULT 'idle',
  ADD COLUMN IF NOT EXISTS provider_sync_error TEXT,
  ADD COLUMN IF NOT EXISTS live_status TEXT,
  ADD COLUMN IF NOT EXISTS live_elapsed INTEGER,
  ADD COLUMN IF NOT EXISTS live_extra INTEGER,
  ADD COLUMN IF NOT EXISTS live_period TEXT,
  ADD COLUMN IF NOT EXISTS live_home_score INTEGER,
  ADD COLUMN IF NOT EXISTS live_away_score INTEGER,
  ADD COLUMN IF NOT EXISTS live_ht_home_score INTEGER,
  ADD COLUMN IF NOT EXISTS live_ht_away_score INTEGER,
  ADD COLUMN IF NOT EXISTS live_refreshed_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS provider_proposed_home_score INTEGER,
  ADD COLUMN IF NOT EXISTS provider_proposed_away_score INTEGER,
  ADD COLUMN IF NOT EXISTS provider_proposed_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS official_result_source TEXT,
  ADD COLUMN IF NOT EXISTS official_result_validated_at TIMESTAMPTZ;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'matches_source_check'
      AND conrelid = 'public.matches'::regclass
  ) THEN
    ALTER TABLE public.matches DROP CONSTRAINT matches_source_check;
  END IF;

  ALTER TABLE public.matches
    ADD CONSTRAINT matches_source_check
    CHECK (source IN ('manual', 'fixturedownload', 'api_football'));

  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'matches_provider_sync_state_check'
      AND conrelid = 'public.matches'::regclass
  ) THEN
    ALTER TABLE public.matches
      ADD CONSTRAINT matches_provider_sync_state_check
      CHECK (
        provider_sync_state IN (
          'idle',
          'pending',
          'synced',
          'error',
          'conflict',
          'stale'
        )
      );
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'matches_official_result_source_check'
      AND conrelid = 'public.matches'::regclass
  ) THEN
    ALTER TABLE public.matches
      ADD CONSTRAINT matches_official_result_source_check
      CHECK (
        official_result_source IS NULL
        OR official_result_source IN (
          'manual',
          'admin_validated_provider'
        )
      );
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'matches_live_scores_both_or_neither'
      AND conrelid = 'public.matches'::regclass
  ) THEN
    ALTER TABLE public.matches
      ADD CONSTRAINT matches_live_scores_both_or_neither
      CHECK (
        (live_home_score IS NULL AND live_away_score IS NULL)
        OR (live_home_score IS NOT NULL AND live_away_score IS NOT NULL)
      );
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'matches_provider_proposed_scores_both_or_neither'
      AND conrelid = 'public.matches'::regclass
  ) THEN
    ALTER TABLE public.matches
      ADD CONSTRAINT matches_provider_proposed_scores_both_or_neither
      CHECK (
        (provider_proposed_home_score IS NULL AND provider_proposed_away_score IS NULL)
        OR (
          provider_proposed_home_score IS NOT NULL
          AND provider_proposed_away_score IS NOT NULL
        )
      );
  END IF;
END;
$$;

-- ---------------------------------------------------------------------------
-- Configuration fournisseur (singleton)
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.provider_settings (
  id SMALLINT PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  provider TEXT NOT NULL DEFAULT 'api_football'
    CHECK (provider IN ('api_football')),
  integration_enabled BOOLEAN NOT NULL DEFAULT TRUE,
  shadow_enabled BOOLEAN NOT NULL DEFAULT TRUE,
  -- Figé à false dans cette branche ; aucun RPC admin ne peut le passer à true.
  public_provider_enabled BOOLEAN NOT NULL DEFAULT FALSE
    CHECK (public_provider_enabled = FALSE),
  tracked_team_external_id INTEGER,
  tracked_team_name TEXT,
  tracked_team_verified_at TIMESTAMPTZ,
  active_season_year INTEGER,
  daily_quota_limit INTEGER NOT NULL DEFAULT 100
    CHECK (daily_quota_limit > 0 AND daily_quota_limit <= 100000),
  quota_reserve INTEGER NOT NULL DEFAULT 10
    CHECK (quota_reserve >= 0 AND quota_reserve < daily_quota_limit),
  last_successful_call_at TIMESTAMPTZ,
  last_error_at TIMESTAMPTZ,
  last_error_code TEXT,
  last_error_message TEXT,
  next_scheduled_call_at TIMESTAMPTZ,
  manual_sync_cooldown_until TIMESTAMPTZ,
  last_coverage_check_at TIMESTAMPTZ,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

INSERT INTO public.provider_settings (id)
VALUES (1)
ON CONFLICT (id) DO NOTHING;

CREATE TRIGGER provider_settings_set_updated_at
  BEFORE UPDATE ON public.provider_settings
  FOR EACH ROW
  EXECUTE FUNCTION public.set_updated_at();

ALTER TABLE public.provider_settings ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.provider_settings FROM PUBLIC, anon, authenticated;

-- ---------------------------------------------------------------------------
-- Compétitions suivies (multi-compétitions, sans hardcode de league)
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.provider_competitions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  external_league_id INTEGER NOT NULL,
  external_season_year INTEGER NOT NULL,
  name TEXT NOT NULL,
  country TEXT,
  competition_type TEXT,
  enabled BOOLEAN NOT NULL DEFAULT TRUE,
  coverage_events BOOLEAN,
  coverage_lineups BOOLEAN,
  coverage_statistics_fixtures BOOLEAN,
  coverage_statistics_players BOOLEAN,
  coverage_checked_at TIMESTAMPTZ,
  coverage_accessible BOOLEAN,
  last_error_code TEXT,
  last_error_message TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT provider_competitions_league_season_unique
    UNIQUE (external_league_id, external_season_year)
);

CREATE TRIGGER provider_competitions_set_updated_at
  BEFORE UPDATE ON public.provider_competitions
  FOR EACH ROW
  EXECUTE FUNCTION public.set_updated_at();

ALTER TABLE public.provider_competitions ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.provider_competitions FROM PUBLIC, anon, authenticated;

-- ---------------------------------------------------------------------------
-- Snapshots fournisseur (stockage shadow / enrichissement)
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.provider_fixtures (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  provider TEXT NOT NULL DEFAULT 'api_football'
    CHECK (provider = 'api_football'),
  external_fixture_id TEXT NOT NULL,
  season_id UUID REFERENCES public.seasons (id) ON DELETE SET NULL,
  match_id UUID REFERENCES public.matches (id) ON DELETE SET NULL,
  external_league_id INTEGER NOT NULL,
  external_season_year INTEGER NOT NULL,
  round_label TEXT,
  round_number INTEGER,
  home_team TEXT NOT NULL,
  away_team TEXT NOT NULL,
  home_team_external_id INTEGER,
  away_team_external_id INTEGER,
  kickoff_at TIMESTAMPTZ NOT NULL,
  venue_name TEXT,
  provider_status_raw TEXT NOT NULL,
  provider_status_normalized TEXT NOT NULL,
  live_elapsed INTEGER,
  live_extra INTEGER,
  live_period TEXT,
  live_home_score INTEGER,
  live_away_score INTEGER,
  ht_home_score INTEGER,
  ht_away_score INTEGER,
  proposed_home_score INTEGER,
  proposed_away_score INTEGER,
  lineups_json JSONB NOT NULL DEFAULT '[]'::JSONB,
  events_json JSONB NOT NULL DEFAULT '[]'::JSONB,
  statistics_json JSONB NOT NULL DEFAULT '[]'::JSONB,
  players_statistics_json JSONB NOT NULL DEFAULT '[]'::JSONB,
  provider_updated_at TIMESTAMPTZ,
  last_synced_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  sync_state TEXT NOT NULL DEFAULT 'synced'
    CHECK (sync_state IN ('pending', 'synced', 'error', 'conflict', 'stale')),
  sync_error TEXT,
  applied_to_match BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT provider_fixtures_external_unique
    UNIQUE (provider, external_fixture_id),
  CONSTRAINT provider_fixtures_live_scores_both_or_neither CHECK (
    (live_home_score IS NULL AND live_away_score IS NULL)
    OR (live_home_score IS NOT NULL AND live_away_score IS NOT NULL)
  ),
  CONSTRAINT provider_fixtures_proposed_scores_both_or_neither CHECK (
    (proposed_home_score IS NULL AND proposed_away_score IS NULL)
    OR (proposed_home_score IS NOT NULL AND proposed_away_score IS NOT NULL)
  )
);

CREATE INDEX IF NOT EXISTS provider_fixtures_kickoff_idx
  ON public.provider_fixtures (kickoff_at, id);

CREATE INDEX IF NOT EXISTS provider_fixtures_match_id_idx
  ON public.provider_fixtures (match_id)
  WHERE match_id IS NOT NULL;

CREATE TRIGGER provider_fixtures_set_updated_at
  BEFORE UPDATE ON public.provider_fixtures
  FOR EACH ROW
  EXECUTE FUNCTION public.set_updated_at();

ALTER TABLE public.provider_fixtures ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.provider_fixtures FROM PUBLIC, anon, authenticated;

-- Événements normalisés (clé stable anti-doublon)
CREATE TABLE IF NOT EXISTS public.provider_fixture_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  provider_fixture_id UUID NOT NULL
    REFERENCES public.provider_fixtures (id) ON DELETE CASCADE,
  external_event_key TEXT NOT NULL,
  event_type TEXT NOT NULL,
  detail TEXT,
  period TEXT,
  elapsed INTEGER,
  extra INTEGER,
  team_side TEXT CHECK (team_side IS NULL OR team_side IN ('home', 'away')),
  player_name TEXT,
  assist_name TEXT,
  sort_period INTEGER NOT NULL DEFAULT 0,
  sort_elapsed INTEGER NOT NULL DEFAULT 0,
  sort_extra INTEGER NOT NULL DEFAULT 0,
  raw_json JSONB NOT NULL DEFAULT '{}'::JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT provider_fixture_events_unique
    UNIQUE (provider_fixture_id, external_event_key)
);

CREATE INDEX IF NOT EXISTS provider_fixture_events_order_idx
  ON public.provider_fixture_events (
    provider_fixture_id,
    sort_period,
    sort_elapsed,
    sort_extra,
    external_event_key
  );

ALTER TABLE public.provider_fixture_events ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.provider_fixture_events FROM PUBLIC, anon, authenticated;

-- Conflits de rapprochement
CREATE TABLE IF NOT EXISTS public.provider_sync_conflicts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  provider TEXT NOT NULL DEFAULT 'api_football',
  external_fixture_id TEXT NOT NULL,
  reason TEXT NOT NULL,
  candidate_match_ids UUID[] NOT NULL DEFAULT '{}',
  payload_json JSONB NOT NULL DEFAULT '{}'::JSONB,
  resolved BOOLEAN NOT NULL DEFAULT FALSE,
  resolved_at TIMESTAMPTZ,
  resolved_match_id UUID REFERENCES public.matches (id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT provider_sync_conflicts_open_unique
    UNIQUE (provider, external_fixture_id, reason)
);

ALTER TABLE public.provider_sync_conflicts ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.provider_sync_conflicts FROM PUBLIC, anon, authenticated;

-- ---------------------------------------------------------------------------
-- Quota atomique (UTC) + journal d’appels
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.provider_api_quota_days (
  quota_date DATE PRIMARY KEY,
  reserved_count INTEGER NOT NULL DEFAULT 0 CHECK (reserved_count >= 0),
  consumed_count INTEGER NOT NULL DEFAULT 0 CHECK (consumed_count >= 0),
  released_count INTEGER NOT NULL DEFAULT 0 CHECK (released_count >= 0),
  provider_reported_current INTEGER,
  provider_reported_limit INTEGER,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TRIGGER provider_api_quota_days_set_updated_at
  BEFORE UPDATE ON public.provider_api_quota_days
  FOR EACH ROW
  EXECUTE FUNCTION public.set_updated_at();

ALTER TABLE public.provider_api_quota_days ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.provider_api_quota_days FROM PUBLIC, anon, authenticated;

CREATE TABLE IF NOT EXISTS public.provider_api_calls (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  quota_date DATE NOT NULL REFERENCES public.provider_api_quota_days (quota_date),
  reservation_status TEXT NOT NULL
    CHECK (reservation_status IN ('reserved', 'consumed', 'released', 'failed')),
  endpoint TEXT NOT NULL,
  http_status INTEGER,
  origin TEXT NOT NULL
    CHECK (origin IN (
      'cron',
      'admin_manual',
      'coverage_check',
      'discover',
      'system'
    )),
  match_id UUID REFERENCES public.matches (id) ON DELETE SET NULL,
  provider_fixture_id UUID REFERENCES public.provider_fixtures (id) ON DELETE SET NULL,
  rate_limit_remaining INTEGER,
  rate_limit_limit INTEGER,
  duration_ms INTEGER,
  error_code TEXT,
  error_message TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  finalized_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS provider_api_calls_day_idx
  ON public.provider_api_calls (quota_date, created_at DESC);

ALTER TABLE public.provider_api_calls ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.provider_api_calls FROM PUBLIC, anon, authenticated;

-- ---------------------------------------------------------------------------
-- Helpers internes quota
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.provider_utc_today()
RETURNS DATE
LANGUAGE sql
STABLE
SET search_path = public
AS $$
  SELECT (timezone('utc', now()))::DATE;
$$;

REVOKE ALL ON FUNCTION public.provider_utc_today() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.provider_utc_today() FROM anon, authenticated;

CREATE OR REPLACE FUNCTION public.provider_reserve_api_call(
  p_endpoint TEXT,
  p_origin TEXT,
  p_match_id UUID DEFAULT NULL,
  p_provider_fixture_id UUID DEFAULT NULL
)
RETURNS TABLE (
  out_call_id UUID,
  out_quota_date DATE,
  remaining_usable INTEGER,
  reserved_count INTEGER,
  consumed_count INTEGER,
  daily_limit INTEGER,
  reserve_floor INTEGER
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  v_settings public.provider_settings%ROWTYPE;
  v_day DATE := public.provider_utc_today();
  v_usable INTEGER;
  v_reserved INTEGER;
  v_consumed INTEGER;
  v_call_id UUID;
BEGIN
  SELECT *
  INTO v_settings
  FROM public.provider_settings
  WHERE id = 1
  FOR UPDATE;

  IF NOT FOUND OR NOT v_settings.integration_enabled THEN
    RAISE EXCEPTION 'PROVIDER_DISABLED'
      USING ERRCODE = 'P0001',
            DETAIL = 'Intégration fournisseur désactivée.';
  END IF;

  IF p_endpoint IS NULL OR length(trim(p_endpoint)) = 0 THEN
    RAISE EXCEPTION 'INVALID_INPUT'
      USING ERRCODE = '22023',
            DETAIL = 'Endpoint requis.';
  END IF;

  IF p_origin NOT IN (
    'cron', 'admin_manual', 'coverage_check', 'discover', 'system'
  ) THEN
    RAISE EXCEPTION 'INVALID_INPUT'
      USING ERRCODE = '22023',
            DETAIL = 'Origine d’appel invalide.';
  END IF;

  INSERT INTO public.provider_api_quota_days AS q (quota_date)
  VALUES (v_day)
  ON CONFLICT (quota_date) DO NOTHING;

  SELECT q.reserved_count, q.consumed_count
  INTO v_reserved, v_consumed
  FROM public.provider_api_quota_days AS q
  WHERE q.quota_date = v_day
  FOR UPDATE;

  -- Budget utilisable = limite - réserve - déjà réservés - déjà consommés.
  v_usable :=
    v_settings.daily_quota_limit
    - v_settings.quota_reserve
    - v_reserved
    - v_consumed;

  IF v_usable < 1 THEN
    RAISE EXCEPTION 'PROVIDER_QUOTA_EXHAUSTED'
      USING ERRCODE = 'P0001',
            DETAIL = 'Quota API-Football insuffisant (réserve conservée).';
  END IF;

  UPDATE public.provider_api_quota_days AS q
  SET reserved_count = q.reserved_count + 1
  WHERE q.quota_date = v_day
  RETURNING q.reserved_count, q.consumed_count
  INTO v_reserved, v_consumed;

  INSERT INTO public.provider_api_calls (
    quota_date,
    reservation_status,
    endpoint,
    origin,
    match_id,
    provider_fixture_id
  )
  VALUES (
    v_day,
    'reserved',
    trim(p_endpoint),
    p_origin,
    p_match_id,
    p_provider_fixture_id
  )
  RETURNING id INTO v_call_id;

  RETURN QUERY
  SELECT
    v_call_id,
    v_day,
    GREATEST(
      v_settings.daily_quota_limit
        - v_settings.quota_reserve
        - v_reserved
        - v_consumed,
      0
    ),
    v_reserved,
    v_consumed,
    v_settings.daily_quota_limit,
    v_settings.quota_reserve;
END;
$$;

REVOKE ALL ON FUNCTION public.provider_reserve_api_call(TEXT, TEXT, UUID, UUID)
  FROM PUBLIC;
REVOKE ALL ON FUNCTION public.provider_reserve_api_call(TEXT, TEXT, UUID, UUID)
  FROM anon, authenticated;
-- Appelé uniquement via service_role (Edge) ou SECURITY DEFINER chainés.

CREATE OR REPLACE FUNCTION public.provider_finalize_api_call(
  p_call_id UUID,
  p_status TEXT,
  p_http_status INTEGER DEFAULT NULL,
  p_rate_limit_remaining INTEGER DEFAULT NULL,
  p_rate_limit_limit INTEGER DEFAULT NULL,
  p_duration_ms INTEGER DEFAULT NULL,
  p_error_code TEXT DEFAULT NULL,
  p_error_message TEXT DEFAULT NULL,
  p_provider_reported_current INTEGER DEFAULT NULL,
  p_provider_reported_limit INTEGER DEFAULT NULL
)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  v_call public.provider_api_calls%ROWTYPE;
BEGIN
  IF p_status NOT IN ('consumed', 'released', 'failed') THEN
    RAISE EXCEPTION 'INVALID_INPUT'
      USING ERRCODE = '22023',
            DETAIL = 'Statut de finalisation invalide.';
  END IF;

  SELECT *
  INTO v_call
  FROM public.provider_api_calls
  WHERE id = p_call_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'PROVIDER_CALL_NOT_FOUND'
      USING ERRCODE = 'P0002',
            DETAIL = 'Réservation d’appel introuvable.';
  END IF;

  IF v_call.reservation_status <> 'reserved' THEN
    RETURN FALSE;
  END IF;

  PERFORM 1
  FROM public.provider_api_quota_days AS q
  WHERE q.quota_date = v_call.quota_date
  FOR UPDATE;

  IF p_status = 'consumed' THEN
    UPDATE public.provider_api_quota_days AS q
    SET
      reserved_count = GREATEST(q.reserved_count - 1, 0),
      consumed_count = q.consumed_count + 1,
      provider_reported_current = COALESCE(
        p_provider_reported_current,
        q.provider_reported_current
      ),
      provider_reported_limit = COALESCE(
        p_provider_reported_limit,
        q.provider_reported_limit
      )
    WHERE q.quota_date = v_call.quota_date;
  ELSIF p_status = 'released' THEN
    UPDATE public.provider_api_quota_days AS q
    SET
      reserved_count = GREATEST(q.reserved_count - 1, 0),
      released_count = q.released_count + 1
    WHERE q.quota_date = v_call.quota_date;
  ELSE
    -- failed : l’appel a eu lieu ou non ; on libère la réservation et on trace.
    UPDATE public.provider_api_quota_days AS q
    SET
      reserved_count = GREATEST(q.reserved_count - 1, 0),
      released_count = q.released_count + 1,
      provider_reported_current = COALESCE(
        p_provider_reported_current,
        q.provider_reported_current
      ),
      provider_reported_limit = COALESCE(
        p_provider_reported_limit,
        q.provider_reported_limit
      )
    WHERE q.quota_date = v_call.quota_date;
  END IF;

  UPDATE public.provider_api_calls
  SET
    reservation_status = p_status,
    http_status = p_http_status,
    rate_limit_remaining = p_rate_limit_remaining,
    rate_limit_limit = p_rate_limit_limit,
    duration_ms = p_duration_ms,
    error_code = NULLIF(trim(COALESCE(p_error_code, '')), ''),
    error_message = NULLIF(left(trim(COALESCE(p_error_message, '')), 500), ''),
    finalized_at = now()
  WHERE id = p_call_id;

  IF p_status = 'consumed' THEN
    UPDATE public.provider_settings
    SET
      last_successful_call_at = now(),
      last_error_at = NULL,
      last_error_code = NULL,
      last_error_message = NULL
    WHERE id = 1;
  ELSIF p_error_code IS NOT NULL THEN
    UPDATE public.provider_settings
    SET
      last_error_at = now(),
      last_error_code = left(trim(p_error_code), 80),
      last_error_message = left(trim(COALESCE(p_error_message, p_error_code)), 500)
    WHERE id = 1;
  END IF;

  RETURN TRUE;
END;
$$;

REVOKE ALL ON FUNCTION public.provider_finalize_api_call(
  UUID, TEXT, INTEGER, INTEGER, INTEGER, INTEGER, TEXT, TEXT, INTEGER, INTEGER
) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.provider_finalize_api_call(
  UUID, TEXT, INTEGER, INTEGER, INTEGER, INTEGER, TEXT, TEXT, INTEGER, INTEGER
) FROM anon, authenticated;

-- ---------------------------------------------------------------------------
-- RPCs admin lecture / config (sans activer public_provider_enabled)
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.admin_get_provider_status(
  p_admin_session_token TEXT
)
RETURNS TABLE (
  provider TEXT,
  integration_enabled BOOLEAN,
  shadow_enabled BOOLEAN,
  public_provider_enabled BOOLEAN,
  public_activation_message TEXT,
  tracked_team_external_id INTEGER,
  tracked_team_name TEXT,
  tracked_team_verified_at TIMESTAMPTZ,
  active_season_year INTEGER,
  daily_quota_limit INTEGER,
  quota_reserve INTEGER,
  quota_date DATE,
  reserved_count INTEGER,
  consumed_count INTEGER,
  released_count INTEGER,
  remaining_usable INTEGER,
  provider_reported_current INTEGER,
  provider_reported_limit INTEGER,
  last_successful_call_at TIMESTAMPTZ,
  last_error_at TIMESTAMPTZ,
  last_error_code TEXT,
  last_error_message TEXT,
  next_scheduled_call_at TIMESTAMPTZ,
  manual_sync_cooldown_until TIMESTAMPTZ,
  last_coverage_check_at TIMESTAMPTZ,
  api_key_configured BOOLEAN
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  v_settings public.provider_settings%ROWTYPE;
  v_day DATE := public.provider_utc_today();
  v_reserved INTEGER := 0;
  v_consumed INTEGER := 0;
  v_released INTEGER := 0;
  v_reported_current INTEGER;
  v_reported_limit INTEGER;
BEGIN
  PERFORM public.assert_admin_session(p_admin_session_token);

  SELECT * INTO v_settings FROM public.provider_settings WHERE id = 1;

  SELECT
    q.reserved_count,
    q.consumed_count,
    q.released_count,
    q.provider_reported_current,
    q.provider_reported_limit
  INTO
    v_reserved,
    v_consumed,
    v_released,
    v_reported_current,
    v_reported_limit
  FROM public.provider_api_quota_days AS q
  WHERE q.quota_date = v_day;

  RETURN QUERY
  SELECT
    v_settings.provider,
    v_settings.integration_enabled,
    v_settings.shadow_enabled,
    v_settings.public_provider_enabled,
    'Activation publique indisponible en mode shadow'::TEXT,
    v_settings.tracked_team_external_id,
    v_settings.tracked_team_name,
    v_settings.tracked_team_verified_at,
    v_settings.active_season_year,
    v_settings.daily_quota_limit,
    v_settings.quota_reserve,
    v_day,
    COALESCE(v_reserved, 0),
    COALESCE(v_consumed, 0),
    COALESCE(v_released, 0),
    GREATEST(
      v_settings.daily_quota_limit
        - v_settings.quota_reserve
        - COALESCE(v_reserved, 0)
        - COALESCE(v_consumed, 0),
      0
    ),
    v_reported_current,
    v_reported_limit,
    v_settings.last_successful_call_at,
    v_settings.last_error_at,
    v_settings.last_error_code,
    v_settings.last_error_message,
    v_settings.next_scheduled_call_at,
    v_settings.manual_sync_cooldown_until,
    v_settings.last_coverage_check_at,
    -- La clé n’est jamais exposée ; seul un booléen est renvoyé (renseigné par l’Edge).
    FALSE;
END;
$$;

REVOKE ALL ON FUNCTION public.admin_get_provider_status(TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.admin_get_provider_status(TEXT) FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION public.admin_get_provider_status(TEXT) TO anon, authenticated;

CREATE OR REPLACE FUNCTION public.admin_get_provider_competitions(
  p_admin_session_token TEXT
)
RETURNS SETOF public.provider_competitions
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
BEGIN
  PERFORM public.assert_admin_session(p_admin_session_token);

  RETURN QUERY
  SELECT c.*
  FROM public.provider_competitions AS c
  ORDER BY c.enabled DESC, c.name ASC, c.external_season_year DESC;
END;
$$;

REVOKE ALL ON FUNCTION public.admin_get_provider_competitions(TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.admin_get_provider_competitions(TEXT)
  FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION public.admin_get_provider_competitions(TEXT)
  TO anon, authenticated;

CREATE OR REPLACE FUNCTION public.admin_upsert_provider_competition(
  p_admin_session_token TEXT,
  p_external_league_id INTEGER,
  p_external_season_year INTEGER,
  p_name TEXT,
  p_country TEXT DEFAULT NULL,
  p_competition_type TEXT DEFAULT NULL,
  p_enabled BOOLEAN DEFAULT TRUE
)
RETURNS SETOF public.provider_competitions
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
BEGIN
  PERFORM public.assert_admin_session(p_admin_session_token);

  IF p_external_league_id IS NULL OR p_external_league_id < 1 THEN
    RAISE EXCEPTION 'INVALID_INPUT'
      USING ERRCODE = '22023',
            DETAIL = 'Identifiant de compétition invalide.';
  END IF;

  IF p_external_season_year IS NULL
     OR p_external_season_year < 2000
     OR p_external_season_year > 2100 THEN
    RAISE EXCEPTION 'INVALID_INPUT'
      USING ERRCODE = '22023',
            DETAIL = 'Saison externe invalide.';
  END IF;

  IF p_name IS NULL OR length(trim(p_name)) < 2 THEN
    RAISE EXCEPTION 'INVALID_INPUT'
      USING ERRCODE = '22023',
            DETAIL = 'Nom de compétition requis.';
  END IF;

  INSERT INTO public.provider_competitions (
    external_league_id,
    external_season_year,
    name,
    country,
    competition_type,
    enabled
  )
  VALUES (
    p_external_league_id,
    p_external_season_year,
    trim(p_name),
    NULLIF(trim(COALESCE(p_country, '')), ''),
    NULLIF(trim(COALESCE(p_competition_type, '')), ''),
    COALESCE(p_enabled, TRUE)
  )
  ON CONFLICT (external_league_id, external_season_year)
  DO UPDATE SET
    name = EXCLUDED.name,
    country = EXCLUDED.country,
    competition_type = EXCLUDED.competition_type,
    enabled = EXCLUDED.enabled,
    updated_at = now();

  RETURN QUERY
  SELECT c.*
  FROM public.provider_competitions AS c
  WHERE c.external_league_id = p_external_league_id
    AND c.external_season_year = p_external_season_year;
END;
$$;

REVOKE ALL ON FUNCTION public.admin_upsert_provider_competition(
  TEXT, INTEGER, INTEGER, TEXT, TEXT, TEXT, BOOLEAN
) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.admin_upsert_provider_competition(
  TEXT, INTEGER, INTEGER, TEXT, TEXT, TEXT, BOOLEAN
) FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION public.admin_upsert_provider_competition(
  TEXT, INTEGER, INTEGER, TEXT, TEXT, TEXT, BOOLEAN
) TO anon, authenticated;

CREATE OR REPLACE FUNCTION public.admin_update_provider_settings(
  p_admin_session_token TEXT,
  p_integration_enabled BOOLEAN DEFAULT NULL,
  p_tracked_team_external_id INTEGER DEFAULT NULL,
  p_tracked_team_name TEXT DEFAULT NULL,
  p_active_season_year INTEGER DEFAULT NULL,
  p_mark_team_verified BOOLEAN DEFAULT FALSE
)
RETURNS SETOF public.provider_settings
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
BEGIN
  PERFORM public.assert_admin_session(p_admin_session_token);

  -- public_provider_enabled et shadow_enabled ne sont pas acceptés ici.

  UPDATE public.provider_settings AS s
  SET
    integration_enabled = COALESCE(p_integration_enabled, s.integration_enabled),
    tracked_team_external_id = COALESCE(
      p_tracked_team_external_id,
      s.tracked_team_external_id
    ),
    tracked_team_name = CASE
      WHEN p_tracked_team_name IS NULL THEN s.tracked_team_name
      ELSE NULLIF(trim(p_tracked_team_name), '')
    END,
    active_season_year = COALESCE(p_active_season_year, s.active_season_year),
    tracked_team_verified_at = CASE
      WHEN COALESCE(p_mark_team_verified, FALSE)
        AND COALESCE(p_tracked_team_external_id, s.tracked_team_external_id) IS NOT NULL
      THEN now()
      ELSE s.tracked_team_verified_at
    END,
    -- Garantit le mode shadow de cette branche.
    shadow_enabled = TRUE,
    public_provider_enabled = FALSE,
    updated_at = now()
  WHERE s.id = 1;

  RETURN QUERY SELECT s.* FROM public.provider_settings AS s WHERE s.id = 1;
END;
$$;

REVOKE ALL ON FUNCTION public.admin_update_provider_settings(
  TEXT, BOOLEAN, INTEGER, TEXT, INTEGER, BOOLEAN
) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.admin_update_provider_settings(
  TEXT, BOOLEAN, INTEGER, TEXT, INTEGER, BOOLEAN
) FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION public.admin_update_provider_settings(
  TEXT, BOOLEAN, INTEGER, TEXT, INTEGER, BOOLEAN
) TO anon, authenticated;

CREATE OR REPLACE FUNCTION public.admin_list_provider_fixtures(
  p_admin_session_token TEXT,
  p_limit INTEGER DEFAULT 50
)
RETURNS SETOF public.provider_fixtures
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  v_limit INTEGER := LEAST(GREATEST(COALESCE(p_limit, 50), 1), 200);
BEGIN
  PERFORM public.assert_admin_session(p_admin_session_token);

  RETURN QUERY
  SELECT f.*
  FROM public.provider_fixtures AS f
  ORDER BY f.kickoff_at DESC, f.id DESC
  LIMIT v_limit;
END;
$$;

REVOKE ALL ON FUNCTION public.admin_list_provider_fixtures(TEXT, INTEGER)
  FROM PUBLIC;
REVOKE ALL ON FUNCTION public.admin_list_provider_fixtures(TEXT, INTEGER)
  FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION public.admin_list_provider_fixtures(TEXT, INTEGER)
  TO anon, authenticated;

CREATE OR REPLACE FUNCTION public.admin_list_provider_conflicts(
  p_admin_session_token TEXT
)
RETURNS SETOF public.provider_sync_conflicts
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
BEGIN
  PERFORM public.assert_admin_session(p_admin_session_token);

  RETURN QUERY
  SELECT c.*
  FROM public.provider_sync_conflicts AS c
  WHERE c.resolved = FALSE
  ORDER BY c.created_at DESC;
END;
$$;

REVOKE ALL ON FUNCTION public.admin_list_provider_conflicts(TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.admin_list_provider_conflicts(TEXT)
  FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION public.admin_list_provider_conflicts(TEXT)
  TO anon, authenticated;

CREATE OR REPLACE FUNCTION public.admin_resolve_provider_conflict(
  p_admin_session_token TEXT,
  p_conflict_id UUID,
  p_match_id UUID
)
RETURNS SETOF public.provider_sync_conflicts
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  v_conflict public.provider_sync_conflicts%ROWTYPE;
BEGIN
  PERFORM public.assert_admin_session(p_admin_session_token);

  SELECT * INTO v_conflict
  FROM public.provider_sync_conflicts
  WHERE id = p_conflict_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'PROVIDER_CONFLICT_NOT_FOUND'
      USING ERRCODE = 'P0002',
            DETAIL = 'Conflit introuvable.';
  END IF;

  IF NOT EXISTS (SELECT 1 FROM public.matches WHERE id = p_match_id) THEN
    RAISE EXCEPTION 'MATCH_NOT_FOUND'
      USING ERRCODE = 'P0002',
            DETAIL = 'Match introuvable.';
  END IF;

  UPDATE public.provider_fixtures AS f
  SET
    match_id = p_match_id,
    sync_state = 'synced',
    sync_error = NULL,
    updated_at = now()
  WHERE f.provider = v_conflict.provider
    AND f.external_fixture_id = v_conflict.external_fixture_id;

  UPDATE public.provider_sync_conflicts
  SET
    resolved = TRUE,
    resolved_at = now(),
    resolved_match_id = p_match_id
  WHERE id = p_conflict_id;

  RETURN QUERY
  SELECT c.*
  FROM public.provider_sync_conflicts AS c
  WHERE c.id = p_conflict_id;
END;
$$;

REVOKE ALL ON FUNCTION public.admin_resolve_provider_conflict(TEXT, UUID, UUID)
  FROM PUBLIC;
REVOKE ALL ON FUNCTION public.admin_resolve_provider_conflict(TEXT, UUID, UUID)
  FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION public.admin_resolve_provider_conflict(TEXT, UUID, UUID)
  TO anon, authenticated;

-- Validation admin d’un résultat proposé (écrit le résultat officiel).
-- En shadow, applicable uniquement via action admin explicite.
CREATE OR REPLACE FUNCTION public.admin_validate_provider_proposed_result(
  p_admin_session_token TEXT,
  p_match_id UUID
)
RETURNS TABLE (
  id UUID,
  home_score INTEGER,
  away_score INTEGER,
  official_result_source TEXT,
  recalculated_count INTEGER
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  v_match public.matches%ROWTYPE;
  v_recalc INTEGER := 0;
BEGIN
  PERFORM public.assert_admin_session(p_admin_session_token);

  SELECT * INTO v_match
  FROM public.matches
  WHERE matches.id = p_match_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'MATCH_NOT_FOUND'
      USING ERRCODE = 'P0002',
            DETAIL = 'Match introuvable.';
  END IF;

  IF v_match.manual_override
     AND v_match.official_result_source = 'manual'
     AND v_match.status = 'finished'
     AND v_match.home_score IS NOT NULL THEN
    RAISE EXCEPTION 'MANUAL_RESULT_PROTECTED'
      USING ERRCODE = 'P0001',
            DETAIL = 'Une correction manuelle protège déjà ce résultat.';
  END IF;

  IF v_match.provider_proposed_home_score IS NULL
     OR v_match.provider_proposed_away_score IS NULL THEN
    RAISE EXCEPTION 'PROVIDER_PROPOSAL_MISSING'
      USING ERRCODE = 'P0002',
            DETAIL = 'Aucune proposition de résultat fournisseur.';
  END IF;

  UPDATE public.matches AS m
  SET
    status = 'finished',
    home_score = v_match.provider_proposed_home_score,
    away_score = v_match.provider_proposed_away_score,
    official_result_source = 'admin_validated_provider',
    official_result_validated_at = now(),
    manual_override = FALSE,
    updated_at = now()
  WHERE m.id = p_match_id;

  v_recalc := public.recalculate_points_for_match(p_match_id);

  RETURN QUERY
  SELECT
    m.id,
    m.home_score,
    m.away_score,
    m.official_result_source,
    v_recalc
  FROM public.matches AS m
  WHERE m.id = p_match_id;
END;
$$;

REVOKE ALL ON FUNCTION public.admin_validate_provider_proposed_result(TEXT, UUID)
  FROM PUBLIC;
REVOKE ALL ON FUNCTION public.admin_validate_provider_proposed_result(TEXT, UUID)
  FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION public.admin_validate_provider_proposed_result(TEXT, UUID)
  TO anon, authenticated;

-- Marque une correction manuelle comme source officielle prioritaire.
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
    official_result_source = 'manual',
    official_result_validated_at = now(),
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

-- Anti-spam sync manuelle
CREATE OR REPLACE FUNCTION public.admin_begin_provider_manual_sync(
  p_admin_session_token TEXT,
  p_cooldown_seconds INTEGER DEFAULT 30
)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  v_settings public.provider_settings%ROWTYPE;
  v_cooldown INTEGER := LEAST(GREATEST(COALESCE(p_cooldown_seconds, 30), 5), 300);
BEGIN
  PERFORM public.assert_admin_session(p_admin_session_token);

  SELECT * INTO v_settings
  FROM public.provider_settings
  WHERE id = 1
  FOR UPDATE;

  IF NOT v_settings.integration_enabled THEN
    RAISE EXCEPTION 'PROVIDER_DISABLED'
      USING ERRCODE = 'P0001',
            DETAIL = 'Intégration fournisseur désactivée.';
  END IF;

  IF v_settings.manual_sync_cooldown_until IS NOT NULL
     AND v_settings.manual_sync_cooldown_until > now() THEN
    RAISE EXCEPTION 'PROVIDER_SYNC_COOLDOWN'
      USING ERRCODE = 'P0001',
            DETAIL = 'Synchronisation manuelle trop fréquente.';
  END IF;

  UPDATE public.provider_settings
  SET manual_sync_cooldown_until = now() + make_interval(secs => v_cooldown)
  WHERE id = 1;

  RETURN TRUE;
END;
$$;

REVOKE ALL ON FUNCTION public.admin_begin_provider_manual_sync(TEXT, INTEGER)
  FROM PUBLIC;
REVOKE ALL ON FUNCTION public.admin_begin_provider_manual_sync(TEXT, INTEGER)
  FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION public.admin_begin_provider_manual_sync(TEXT, INTEGER)
  TO anon, authenticated;

-- Lecteur public : le centre du match n’est exposé que si public_provider_enabled.
-- Dans cette branche le CHECK garantit false → toujours masqué.
CREATE OR REPLACE FUNCTION public.get_public_match_center_enabled(
  p_session_token TEXT
)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  v_enabled BOOLEAN;
BEGIN
  PERFORM public.assert_player_session(p_session_token);

  SELECT s.public_provider_enabled
  INTO v_enabled
  FROM public.provider_settings AS s
  WHERE s.id = 1;

  RETURN COALESCE(v_enabled, FALSE);
END;
$$;

REVOKE ALL ON FUNCTION public.get_public_match_center_enabled(TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.get_public_match_center_enabled(TEXT)
  FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_public_match_center_enabled(TEXT)
  TO anon, authenticated;

COMMENT ON TABLE public.provider_settings IS
  'Config API-Football. public_provider_enabled figé à false jusqu’à feature/api-football-cutover.';
COMMENT ON COLUMN public.matches.live_home_score IS
  'Score live fournisseur (informatif). Ne calcule jamais les points.';
COMMENT ON COLUMN public.matches.official_result_source IS
  'manual = correction prioritaire ; admin_validated_provider = proposition validée.';
