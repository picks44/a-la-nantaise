-- Provenance de confirmation d’horaire + préservation des overrides manuels
-- à la synchronisation. Nettoyage sûr des sessions admin expirées.
--
-- Fixture Download ne fournit pas de marqueur « horaire confirmé ».
-- Heuristique : 00:00:00 Europe/Paris (été CEST / hiver CET) = provisoire.
-- Ne jamais comparer naïvement l’heure UTC à 00:00.

-- ---------------------------------------------------------------------------
-- Provenance : feed | heuristic | manual
-- ---------------------------------------------------------------------------

ALTER TABLE public.matches
  ADD COLUMN IF NOT EXISTS kickoff_confirmation_source TEXT NOT NULL DEFAULT 'feed';

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'matches_kickoff_confirmation_source_check'
  ) THEN
    ALTER TABLE public.matches
      ADD CONSTRAINT matches_kickoff_confirmation_source_check
      CHECK (kickoff_confirmation_source IN ('feed', 'heuristic', 'manual'));
  END IF;
END;
$$;

COMMENT ON COLUMN public.matches.kickoff_confirmation_source IS
  'Origine de kickoff_time_confirmed : feed (horaire source non-minuit), '
  'heuristic (placeholder minuit Paris), manual (confirmation admin). '
  'La sync ne peut pas rétrograder une confirmation manual vers non confirmé.';

-- Backfill provenance depuis l’état actuel.
UPDATE public.matches AS m
SET kickoff_confirmation_source = CASE
  WHEN m.source = 'manual' THEN 'manual'
  WHEN m.kickoff_time_confirmed IS FALSE THEN 'heuristic'
  WHEN public.is_paris_midnight_kickoff(m.kickoff_at)
       AND m.status IN ('scheduled', 'postponed')
    THEN 'heuristic'
  ELSE 'feed'
END
WHERE m.kickoff_confirmation_source = 'feed'
  AND (
    m.source = 'manual'
    OR m.kickoff_time_confirmed IS FALSE
    OR (
      public.is_paris_midnight_kickoff(m.kickoff_at)
      AND m.status IN ('scheduled', 'postponed')
    )
  );

-- ---------------------------------------------------------------------------
-- is_paris_midnight_kickoff : STABLE (fuseau nommé), pas UTC naïf
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.is_paris_midnight_kickoff(p_kickoff TIMESTAMPTZ)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SET search_path = public
AS $$
  SELECT p_kickoff IS NOT NULL
    AND (p_kickoff AT TIME ZONE 'Europe/Paris')::time = TIME '00:00:00';
$$;

REVOKE ALL ON FUNCTION public.is_paris_midnight_kickoff(TIMESTAMPTZ) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.is_paris_midnight_kickoff(TIMESTAMPTZ)
  FROM anon, authenticated;

-- ---------------------------------------------------------------------------
-- Helper : décision confirmé + provenance pour un kickoff issu du feed
-- Préserve une confirmation manuelle tant que le feed reste à minuit Paris.
-- Un vrai horaire non-minuit du feed devient confirmé (source=feed).
-- Matchs terminés : toujours confirmés.
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.resolve_kickoff_confirmation(
  p_kickoff TIMESTAMPTZ,
  p_status TEXT,
  p_existing_confirmed BOOLEAN,
  p_existing_source TEXT
)
RETURNS TABLE (
  confirmed BOOLEAN,
  confirmation_source TEXT
)
LANGUAGE plpgsql
STABLE
SET search_path = public
AS $$
DECLARE
  v_status TEXT := COALESCE(nullif(trim(p_status), ''), 'scheduled');
  v_existing_source TEXT := COALESCE(p_existing_source, 'feed');
BEGIN
  IF v_status = 'finished' THEN
    confirmed := TRUE;
    confirmation_source := CASE
      WHEN v_existing_source = 'manual' THEN 'manual'
      ELSE 'feed'
    END;
    RETURN NEXT;
    RETURN;
  END IF;

  -- Report / annulation : ne pas « ouvrir » via une confirmation feed ;
  -- conserver une confirmation manuelle ; sinon appliquer l’heuristique.
  IF v_status IN ('postponed', 'cancelled') THEN
    IF v_existing_source = 'manual' AND COALESCE(p_existing_confirmed, FALSE) THEN
      confirmed := TRUE;
      confirmation_source := 'manual';
    ELSIF public.is_paris_midnight_kickoff(p_kickoff) THEN
      confirmed := FALSE;
      confirmation_source := 'heuristic';
    ELSE
      confirmed := TRUE;
      confirmation_source := 'feed';
    END IF;
    RETURN NEXT;
    RETURN;
  END IF;

  IF public.is_paris_midnight_kickoff(p_kickoff) THEN
    IF v_existing_source = 'manual' AND COALESCE(p_existing_confirmed, FALSE) THEN
      confirmed := TRUE;
      confirmation_source := 'manual';
    ELSE
      confirmed := FALSE;
      confirmation_source := 'heuristic';
    END IF;
  ELSE
    confirmed := TRUE;
    confirmation_source := 'feed';
  END IF;

  RETURN NEXT;
END;
$$;

REVOKE ALL ON FUNCTION public.resolve_kickoff_confirmation(TIMESTAMPTZ, TEXT, BOOLEAN, TEXT)
  FROM PUBLIC;
REVOKE ALL ON FUNCTION public.resolve_kickoff_confirmation(TIMESTAMPTZ, TEXT, BOOLEAN, TEXT)
  FROM anon, authenticated;

-- ---------------------------------------------------------------------------
-- Nettoyage sessions admin expirées / révoquées (jamais les sessions valides)
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.cleanup_expired_admin_sessions()
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  v_deleted INTEGER;
BEGIN
  DELETE FROM public.admin_sessions AS s
  WHERE s.expires_at <= now()
     OR s.revoked_at IS NOT NULL;

  GET DIAGNOSTICS v_deleted = ROW_COUNT;
  RETURN v_deleted;
END;
$$;

REVOKE ALL ON FUNCTION public.cleanup_expired_admin_sessions() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.cleanup_expired_admin_sessions()
  FROM anon, authenticated;

-- Appelé à chaque login_admin pour éviter l’accumulation (cron / connexions).
CREATE OR REPLACE FUNCTION public.login_admin(p_admin_code TEXT)
RETURNS TABLE (
  session_token TEXT
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  v_state public.admin_auth_state%ROWTYPE;
  stored_hash TEXT;
  v_raw BYTEA;
  v_token TEXT;
  v_hash BYTEA;
BEGIN
  PERFORM public.cleanup_expired_admin_sessions();

  SELECT a.*
  INTO v_state
  FROM public.admin_auth_state AS a
  WHERE a.id = TRUE
  FOR UPDATE;

  IF NOT FOUND THEN
    INSERT INTO public.admin_auth_state (id, failed_attempts, locked_until)
    VALUES (TRUE, 0, NULL)
    RETURNING * INTO v_state;
  END IF;

  IF v_state.locked_until IS NOT NULL
     AND v_state.locked_until > now() THEN
    RAISE EXCEPTION 'ADMIN_LOCKED'
      USING ERRCODE = '28000',
            DETAIL = 'Trop de tentatives. Réessaie dans 15 minutes.';
  END IF;

  SELECT s.value
  INTO stored_hash
  FROM public.app_settings AS s
  WHERE s.key = 'admin_code_hash';

  IF stored_hash IS NULL OR stored_hash = '' THEN
    RAISE EXCEPTION 'ADMIN_CODE_NOT_CONFIGURED'
      USING ERRCODE = 'P0001',
            DETAIL = 'Le hash du code administrateur n’a pas encore été défini.';
  END IF;

  IF p_admin_code IS NULL
     OR length(trim(p_admin_code)) = 0
     OR stored_hash <> extensions.crypt(trim(p_admin_code), stored_hash)
  THEN
    UPDATE public.admin_auth_state AS a
    SET
      failed_attempts = a.failed_attempts + 1,
      locked_until = CASE
        WHEN a.failed_attempts + 1 >= 5
          THEN now() + interval '15 minutes'
        ELSE a.locked_until
      END
    WHERE a.id = TRUE;

    RETURN;
  END IF;

  UPDATE public.admin_auth_state AS a
  SET
    failed_attempts = 0,
    locked_until = NULL
  WHERE a.id = TRUE;

  UPDATE public.admin_sessions AS s
  SET revoked_at = now()
  WHERE s.revoked_at IS NULL;

  v_raw := extensions.gen_random_bytes(32);
  v_token := encode(v_raw, 'hex');
  v_hash := public.hash_session_token(v_token);

  INSERT INTO public.admin_sessions (token_hash, expires_at)
  VALUES (v_hash, now() + interval '12 hours');

  -- Purge immédiatement les sessions qu’on vient de révoquer + expirées.
  PERFORM public.cleanup_expired_admin_sessions();

  RETURN QUERY
  SELECT v_token;
END;
$$;

-- ---------------------------------------------------------------------------
-- admin_commit_fixture_sync : utilise resolve_kickoff_confirmation
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.admin_commit_fixture_sync(
  p_admin_session_token TEXT,
  p_plan JSONB
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  synced_at TIMESTAMPTZ;
  create_item JSONB;
  update_item JSONB;
  new_id UUID;
  created_count INTEGER := 0;
  updated_count INTEGER := 0;
  unchanged_count INTEGER := 0;
  new_results_count INTEGER := 0;
  points_recalculated INTEGER := 0;
  protected_count INTEGER := 0;
  recalc INTEGER;
  v_confirm RECORD;
  v_existing_confirmed BOOLEAN;
  v_existing_source TEXT;
BEGIN
  PERFORM public.assert_admin_session(p_admin_session_token);

  IF p_plan IS NULL OR jsonb_typeof(p_plan) <> 'object' THEN
    RAISE EXCEPTION 'INVALID_SYNC_PLAN'
      USING ERRCODE = '22023',
            DETAIL = 'Plan de synchronisation invalide.';
  END IF;

  IF COALESCE(jsonb_array_length(p_plan->'conflicts'), 0) > 0 THEN
    RAISE EXCEPTION 'SYNC_CONFLICT'
      USING ERRCODE = 'P0001',
            DETAIL = 'Des conflits empêchent la synchronisation.';
  END IF;

  synced_at := COALESCE((p_plan->>'synced_at')::TIMESTAMPTZ, now());

  FOR create_item IN
    SELECT value FROM jsonb_array_elements(COALESCE(p_plan->'creates', '[]'::jsonb))
  LOOP
    SELECT * INTO v_confirm
    FROM public.resolve_kickoff_confirmation(
      (create_item->>'kickoff_at')::TIMESTAMPTZ,
      create_item->>'status',
      NULL,
      NULL
    );

    INSERT INTO public.matches (
      external_id,
      round_number,
      home_team,
      away_team,
      kickoff_at,
      kickoff_time_confirmed,
      kickoff_confirmation_source,
      status,
      home_score,
      away_score,
      source,
      last_synced_at,
      manual_override,
      source_home_team,
      source_away_team,
      source_kickoff_at,
      source_home_score,
      source_away_score,
      source_status
    )
    VALUES (
      create_item->>'external_id',
      (create_item->>'round_number')::INTEGER,
      create_item->>'home_team',
      create_item->>'away_team',
      (create_item->>'kickoff_at')::TIMESTAMPTZ,
      v_confirm.confirmed,
      v_confirm.confirmation_source,
      create_item->>'status',
      NULLIF(create_item->>'home_score', '')::INTEGER,
      NULLIF(create_item->>'away_score', '')::INTEGER,
      'fixturedownload',
      synced_at,
      FALSE,
      create_item->>'home_team',
      create_item->>'away_team',
      (create_item->>'kickoff_at')::TIMESTAMPTZ,
      NULLIF(create_item->>'home_score', '')::INTEGER,
      NULLIF(create_item->>'away_score', '')::INTEGER,
      create_item->>'status'
    )
    RETURNING id INTO new_id;

    created_count := created_count + 1;

    IF create_item->>'status' = 'finished' THEN
      new_results_count := new_results_count + 1;
      recalc := public.recalculate_points_for_match(new_id);
      points_recalculated := points_recalculated + recalc;
    END IF;
  END LOOP;

  FOR update_item IN
    SELECT value FROM jsonb_array_elements(COALESCE(p_plan->'updates', '[]'::jsonb))
  LOOP
    IF COALESCE((update_item->>'protected')::BOOLEAN, FALSE) THEN
      protected_count := protected_count + 1;

      UPDATE public.matches AS m
      SET
        external_id = update_item->>'external_id',
        source = 'fixturedownload',
        last_synced_at = synced_at,
        source_home_team = update_item->>'source_home_team',
        source_away_team = update_item->>'source_away_team',
        source_kickoff_at = (update_item->>'source_kickoff_at')::TIMESTAMPTZ,
        source_home_score = NULLIF(update_item->>'source_home_score', '')::INTEGER,
        source_away_score = NULLIF(update_item->>'source_away_score', '')::INTEGER,
        source_status = update_item->>'source_status',
        updated_at = now()
      WHERE m.id = (update_item->>'id')::UUID;
    ELSIF COALESCE((update_item->>'unchanged')::BOOLEAN, FALSE) THEN
      unchanged_count := unchanged_count + 1;

      UPDATE public.matches AS m
      SET
        external_id = update_item->>'external_id',
        source = 'fixturedownload',
        last_synced_at = synced_at,
        source_home_team = update_item->>'source_home_team',
        source_away_team = update_item->>'source_away_team',
        source_kickoff_at = (update_item->>'source_kickoff_at')::TIMESTAMPTZ,
        source_home_score = NULLIF(update_item->>'source_home_score', '')::INTEGER,
        source_away_score = NULLIF(update_item->>'source_away_score', '')::INTEGER,
        source_status = update_item->>'source_status',
        updated_at = now()
      WHERE m.id = (update_item->>'id')::UUID;
    ELSE
      updated_count := updated_count + 1;

      IF COALESCE((update_item->>'new_result')::BOOLEAN, FALSE) THEN
        new_results_count := new_results_count + 1;
      END IF;

      SELECT m.kickoff_time_confirmed, m.kickoff_confirmation_source
      INTO v_existing_confirmed, v_existing_source
      FROM public.matches AS m
      WHERE m.id = (update_item->>'id')::UUID;

      SELECT * INTO v_confirm
      FROM public.resolve_kickoff_confirmation(
        (update_item->>'kickoff_at')::TIMESTAMPTZ,
        update_item->>'status',
        v_existing_confirmed,
        v_existing_source
      );

      UPDATE public.matches AS m
      SET
        external_id = update_item->>'external_id',
        source = 'fixturedownload',
        round_number = (update_item->>'round_number')::INTEGER,
        home_team = update_item->>'home_team',
        away_team = update_item->>'away_team',
        kickoff_at = (update_item->>'kickoff_at')::TIMESTAMPTZ,
        kickoff_time_confirmed = v_confirm.confirmed,
        kickoff_confirmation_source = v_confirm.confirmation_source,
        status = update_item->>'status',
        home_score = NULLIF(update_item->>'home_score', '')::INTEGER,
        away_score = NULLIF(update_item->>'away_score', '')::INTEGER,
        last_synced_at = synced_at,
        source_home_team = update_item->>'source_home_team',
        source_away_team = update_item->>'source_away_team',
        source_kickoff_at = (update_item->>'source_kickoff_at')::TIMESTAMPTZ,
        source_home_score = NULLIF(update_item->>'source_home_score', '')::INTEGER,
        source_away_score = NULLIF(update_item->>'source_away_score', '')::INTEGER,
        source_status = update_item->>'source_status',
        updated_at = now()
      WHERE m.id = (update_item->>'id')::UUID;

      IF COALESCE((update_item->>'recalculate')::BOOLEAN, FALSE) THEN
        recalc := public.recalculate_points_for_match((update_item->>'id')::UUID);
        points_recalculated := points_recalculated + recalc;
      END IF;
    END IF;
  END LOOP;

  INSERT INTO public.app_settings (key, value)
  VALUES ('fixture_sync_last_at', synced_at::TEXT)
  ON CONFLICT (key) DO UPDATE
  SET
    value = EXCLUDED.value,
    updated_at = now();

  RETURN jsonb_build_object(
    'created', created_count,
    'updated', updated_count,
    'unchanged', unchanged_count,
    'new_results', new_results_count,
    'points_recalculated', points_recalculated,
    'conflicts', '[]'::jsonb,
    'protected', protected_count,
    'last_synced_at', synced_at
  );
END;
$$;

-- ---------------------------------------------------------------------------
-- admin_create_match / admin_update_match :
-- p_kickoff_time_confirmed DEFAULT NULL (pas DEFAULT true accidentel).
-- NULL + minuit Paris → non confirmé (heuristic) ; NULL + autre → confirmé manual.
-- Valeur explicite → source = manual.
-- ---------------------------------------------------------------------------

DROP FUNCTION IF EXISTS public.admin_create_match(TEXT, INTEGER, TEXT, TEXT, TIMESTAMPTZ, TEXT, INTEGER, INTEGER, TEXT, BOOLEAN);

CREATE OR REPLACE FUNCTION public.admin_create_match(
  p_admin_session_token TEXT,
  p_round_number INTEGER,
  p_home_team TEXT,
  p_away_team TEXT,
  p_kickoff_at TIMESTAMPTZ,
  p_status TEXT DEFAULT 'scheduled',
  p_home_score INTEGER DEFAULT NULL,
  p_away_score INTEGER DEFAULT NULL,
  p_external_id TEXT DEFAULT NULL,
  p_kickoff_time_confirmed BOOLEAN DEFAULT NULL
)
RETURNS TABLE (
  id UUID,
  external_id TEXT,
  round_number INTEGER,
  home_team TEXT,
  away_team TEXT,
  kickoff_at TIMESTAMPTZ,
  kickoff_time_confirmed BOOLEAN,
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
  home_clean TEXT;
  away_clean TEXT;
  status_clean TEXT;
  external_clean TEXT;
  new_id UUID;
  recalc INTEGER := 0;
  confirmed BOOLEAN;
  confirm_source TEXT;
BEGIN
  PERFORM public.assert_admin_session(p_admin_session_token);

  IF p_round_number IS NULL OR p_round_number < 1 OR p_round_number > 34 THEN
    RAISE EXCEPTION 'INVALID_ROUND'
      USING ERRCODE = '22023',
            DETAIL = 'Le numéro de journée doit être entre 1 et 34.';
  END IF;

  IF p_kickoff_at IS NULL THEN
    RAISE EXCEPTION 'INVALID_KICKOFF'
      USING ERRCODE = '22023',
            DETAIL = 'La date de coup d’envoi est obligatoire.';
  END IF;

  home_clean := trim(COALESCE(p_home_team, ''));
  away_clean := trim(COALESCE(p_away_team, ''));
  status_clean := COALESCE(nullif(trim(p_status), ''), 'scheduled');
  external_clean := nullif(trim(COALESCE(p_external_id, '')), '');

  IF p_kickoff_time_confirmed IS NULL THEN
    IF status_clean = 'finished' THEN
      confirmed := TRUE;
      confirm_source := 'manual';
    ELSIF public.is_paris_midnight_kickoff(p_kickoff_at) THEN
      confirmed := FALSE;
      confirm_source := 'heuristic';
    ELSE
      confirmed := TRUE;
      confirm_source := 'manual';
    END IF;
  ELSE
    confirmed := p_kickoff_time_confirmed;
    confirm_source := 'manual';
  END IF;

  IF status_clean NOT IN ('scheduled', 'live', 'finished', 'postponed', 'cancelled') THEN
    RAISE EXCEPTION 'INVALID_STATUS'
      USING ERRCODE = '22023',
            DETAIL = 'Statut de match invalide.';
  END IF;

  PERFORM public.assert_nantes_fixture(home_clean, away_clean);
  PERFORM public.assert_match_scores(status_clean, p_home_score, p_away_score);

  INSERT INTO public.matches AS m (
    external_id,
    round_number,
    home_team,
    away_team,
    kickoff_at,
    kickoff_time_confirmed,
    kickoff_confirmation_source,
    status,
    home_score,
    away_score,
    source,
    manual_override
  )
  VALUES (
    external_clean,
    p_round_number,
    home_clean,
    away_clean,
    p_kickoff_at,
    confirmed,
    confirm_source,
    status_clean,
    p_home_score,
    p_away_score,
    'manual',
    TRUE
  )
  RETURNING m.id INTO new_id;

  IF status_clean = 'finished' THEN
    recalc := public.recalculate_points_for_match(new_id);
  END IF;

  RETURN QUERY
  SELECT
    m.id,
    m.external_id,
    m.round_number,
    m.home_team,
    m.away_team,
    m.kickoff_at,
    m.kickoff_time_confirmed,
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
  WHERE m.id = new_id;
END;
$$;

REVOKE ALL ON FUNCTION public.admin_create_match(TEXT, INTEGER, TEXT, TEXT, TIMESTAMPTZ, TEXT, INTEGER, INTEGER, TEXT, BOOLEAN)
  FROM PUBLIC;
REVOKE ALL ON FUNCTION public.admin_create_match(TEXT, INTEGER, TEXT, TEXT, TIMESTAMPTZ, TEXT, INTEGER, INTEGER, TEXT, BOOLEAN)
  FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION public.admin_create_match(TEXT, INTEGER, TEXT, TEXT, TIMESTAMPTZ, TEXT, INTEGER, INTEGER, TEXT, BOOLEAN)
  TO anon, authenticated;

DROP FUNCTION IF EXISTS public.admin_update_match(TEXT, UUID, INTEGER, TEXT, TEXT, TIMESTAMPTZ, TEXT, INTEGER, INTEGER, TEXT, BOOLEAN);

CREATE OR REPLACE FUNCTION public.admin_update_match(
  p_admin_session_token TEXT,
  p_match_id UUID,
  p_round_number INTEGER,
  p_home_team TEXT,
  p_away_team TEXT,
  p_kickoff_at TIMESTAMPTZ,
  p_status TEXT DEFAULT 'scheduled',
  p_home_score INTEGER DEFAULT NULL,
  p_away_score INTEGER DEFAULT NULL,
  p_external_id TEXT DEFAULT NULL,
  p_kickoff_time_confirmed BOOLEAN DEFAULT NULL
)
RETURNS TABLE (
  id UUID,
  external_id TEXT,
  round_number INTEGER,
  home_team TEXT,
  away_team TEXT,
  kickoff_at TIMESTAMPTZ,
  kickoff_time_confirmed BOOLEAN,
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
  home_clean TEXT;
  away_clean TEXT;
  status_clean TEXT;
  external_clean TEXT;
  recalc INTEGER := 0;
  confirmed BOOLEAN;
  confirm_source TEXT;
  v_prev_confirmed BOOLEAN;
  v_prev_source TEXT;
BEGIN
  PERFORM public.assert_admin_session(p_admin_session_token);

  IF p_match_id IS NULL THEN
    RAISE EXCEPTION 'MATCH_NOT_FOUND'
      USING ERRCODE = '22023',
            DETAIL = 'Match introuvable.';
  END IF;

  IF p_round_number IS NULL OR p_round_number < 1 OR p_round_number > 34 THEN
    RAISE EXCEPTION 'INVALID_ROUND'
      USING ERRCODE = '22023',
            DETAIL = 'Le numéro de journée doit être entre 1 et 34.';
  END IF;

  IF p_kickoff_at IS NULL THEN
    RAISE EXCEPTION 'INVALID_KICKOFF'
      USING ERRCODE = '22023',
            DETAIL = 'La date de coup d’envoi est obligatoire.';
  END IF;

  home_clean := trim(COALESCE(p_home_team, ''));
  away_clean := trim(COALESCE(p_away_team, ''));
  status_clean := COALESCE(nullif(trim(p_status), ''), 'scheduled');
  external_clean := nullif(trim(COALESCE(p_external_id, '')), '');

  SELECT m.kickoff_time_confirmed, m.kickoff_confirmation_source
  INTO v_prev_confirmed, v_prev_source
  FROM public.matches AS m
  WHERE m.id = p_match_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'MATCH_NOT_FOUND'
      USING ERRCODE = '22023',
            DETAIL = 'Match introuvable.';
  END IF;

  IF p_kickoff_time_confirmed IS NULL THEN
    -- Paramètre omis : conserver l’état, sauf heuristique minuit si non manual.
    IF v_prev_source = 'manual' THEN
      confirmed := v_prev_confirmed;
      confirm_source := 'manual';
    ELSIF status_clean = 'finished' THEN
      confirmed := TRUE;
      confirm_source := COALESCE(v_prev_source, 'feed');
    ELSIF public.is_paris_midnight_kickoff(p_kickoff_at) THEN
      confirmed := FALSE;
      confirm_source := 'heuristic';
    ELSE
      confirmed := TRUE;
      confirm_source := 'manual';
    END IF;
  ELSE
    confirmed := p_kickoff_time_confirmed;
    confirm_source := 'manual';
  END IF;

  IF status_clean NOT IN ('scheduled', 'live', 'finished', 'postponed', 'cancelled') THEN
    RAISE EXCEPTION 'INVALID_STATUS'
      USING ERRCODE = '22023',
            DETAIL = 'Statut de match invalide.';
  END IF;

  PERFORM public.assert_nantes_fixture(home_clean, away_clean);
  PERFORM public.assert_match_scores(status_clean, p_home_score, p_away_score);

  UPDATE public.matches AS m
  SET
    external_id = external_clean,
    round_number = p_round_number,
    home_team = home_clean,
    away_team = away_clean,
    kickoff_at = p_kickoff_at,
    kickoff_time_confirmed = confirmed,
    kickoff_confirmation_source = confirm_source,
    status = status_clean,
    home_score = p_home_score,
    away_score = p_away_score,
    manual_override = TRUE,
    updated_at = now()
  WHERE m.id = p_match_id;

  IF status_clean = 'finished' THEN
    recalc := public.recalculate_points_for_match(p_match_id);
  END IF;

  RETURN QUERY
  SELECT
    m.id,
    m.external_id,
    m.round_number,
    m.home_team,
    m.away_team,
    m.kickoff_at,
    m.kickoff_time_confirmed,
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

REVOKE ALL ON FUNCTION public.admin_update_match(TEXT, UUID, INTEGER, TEXT, TEXT, TIMESTAMPTZ, TEXT, INTEGER, INTEGER, TEXT, BOOLEAN)
  FROM PUBLIC;
REVOKE ALL ON FUNCTION public.admin_update_match(TEXT, UUID, INTEGER, TEXT, TEXT, TIMESTAMPTZ, TEXT, INTEGER, INTEGER, TEXT, BOOLEAN)
  FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION public.admin_update_match(TEXT, UUID, INTEGER, TEXT, TEXT, TIMESTAMPTZ, TEXT, INTEGER, INTEGER, TEXT, BOOLEAN)
  TO anon, authenticated;

-- logout_admin : purge après révocation (évite l’accumulation cron / déconnexions)
CREATE OR REPLACE FUNCTION public.logout_admin(p_admin_session_token TEXT)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  v_hash BYTEA;
  v_updated INTEGER;
BEGIN
  BEGIN
    v_hash := public.hash_session_token(p_admin_session_token);
  EXCEPTION
    WHEN OTHERS THEN
      RETURN FALSE;
  END;

  UPDATE public.admin_sessions AS s
  SET revoked_at = now()
  WHERE s.token_hash = v_hash
    AND s.revoked_at IS NULL;

  GET DIAGNOSTICS v_updated = ROW_COUNT;

  PERFORM public.cleanup_expired_admin_sessions();

  RETURN v_updated > 0;
END;
$$;

REVOKE ALL ON FUNCTION public.logout_admin(TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.logout_admin(TEXT) FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION public.logout_admin(TEXT) TO anon, authenticated;

REVOKE ALL ON FUNCTION public.login_admin(TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.login_admin(TEXT) FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION public.login_admin(TEXT) TO anon, authenticated;

REVOKE ALL ON FUNCTION public.admin_commit_fixture_sync(TEXT, JSONB) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.admin_commit_fixture_sync(TEXT, JSONB)
  FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION public.admin_commit_fixture_sync(TEXT, JSONB)
  TO anon, authenticated;
