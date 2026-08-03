-- À la Nantaise — synchronisation Fixture Download (FC Nantes)
-- Aucune suppression de données existantes.

-- ---------------------------------------------------------------------------
-- Colonnes matches + unicité (source, external_id)
-- ---------------------------------------------------------------------------

ALTER TABLE public.matches
  DROP CONSTRAINT IF EXISTS matches_external_id_key;

ALTER TABLE public.matches
  ADD COLUMN IF NOT EXISTS source TEXT NOT NULL DEFAULT 'manual',
  ADD COLUMN IF NOT EXISTS last_synced_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS manual_override BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS source_home_team TEXT,
  ADD COLUMN IF NOT EXISTS source_away_team TEXT,
  ADD COLUMN IF NOT EXISTS source_kickoff_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS source_home_score INTEGER,
  ADD COLUMN IF NOT EXISTS source_away_score INTEGER,
  ADD COLUMN IF NOT EXISTS source_status TEXT;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'matches_source_check'
      AND conrelid = 'public.matches'::regclass
  ) THEN
    ALTER TABLE public.matches
      ADD CONSTRAINT matches_source_check
      CHECK (source IN ('manual', 'fixturedownload'));
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'matches_source_status_check'
      AND conrelid = 'public.matches'::regclass
  ) THEN
    ALTER TABLE public.matches
      ADD CONSTRAINT matches_source_status_check
      CHECK (
        source_status IS NULL
        OR source_status IN ('scheduled', 'finished')
      );
  END IF;
END;
$$;

CREATE UNIQUE INDEX IF NOT EXISTS matches_source_external_id_unique
  ON public.matches (source, external_id)
  WHERE external_id IS NOT NULL;

INSERT INTO public.app_settings (key, value)
VALUES ('fixture_sync_last_at', '')
ON CONFLICT (key) DO NOTHING;

-- ---------------------------------------------------------------------------
-- admin_get_matches — métadonnées de synchronisation
-- ---------------------------------------------------------------------------

DROP FUNCTION IF EXISTS public.admin_get_matches(TEXT);

CREATE OR REPLACE FUNCTION public.admin_get_matches(p_admin_code TEXT)
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
  source_status TEXT
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
BEGIN
  PERFORM public.assert_admin_code(p_admin_code);

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
    m.source_status
  FROM public.matches AS m
  ORDER BY m.kickoff_at ASC;
END;
$$;

-- ---------------------------------------------------------------------------
-- Création / mise à jour manuelle → source manual + override
-- ---------------------------------------------------------------------------

DROP FUNCTION IF EXISTS public.admin_create_match(TEXT, INTEGER, TEXT, TEXT, TIMESTAMPTZ, TEXT, INTEGER, INTEGER, TEXT);
DROP FUNCTION IF EXISTS public.admin_update_match(TEXT, UUID, INTEGER, TEXT, TEXT, TIMESTAMPTZ, TEXT, INTEGER, INTEGER, TEXT);
DROP FUNCTION IF EXISTS public.admin_set_match_result(TEXT, UUID, INTEGER, INTEGER);

CREATE OR REPLACE FUNCTION public.admin_create_match(
  p_admin_code TEXT,
  p_round_number INTEGER,
  p_home_team TEXT,
  p_away_team TEXT,
  p_kickoff_at TIMESTAMPTZ,
  p_status TEXT DEFAULT 'scheduled',
  p_home_score INTEGER DEFAULT NULL,
  p_away_score INTEGER DEFAULT NULL,
  p_external_id TEXT DEFAULT NULL
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
  home_clean TEXT;
  away_clean TEXT;
  status_clean TEXT;
  external_clean TEXT;
  new_id UUID;
  recalc INTEGER := 0;
BEGIN
  PERFORM public.assert_admin_code(p_admin_code);

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
    status_clean,
    p_home_score,
    p_away_score,
    'manual',
    FALSE
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

CREATE OR REPLACE FUNCTION public.admin_update_match(
  p_admin_code TEXT,
  p_match_id UUID,
  p_round_number INTEGER,
  p_home_team TEXT,
  p_away_team TEXT,
  p_kickoff_at TIMESTAMPTZ,
  p_status TEXT,
  p_home_score INTEGER DEFAULT NULL,
  p_away_score INTEGER DEFAULT NULL,
  p_external_id TEXT DEFAULT NULL
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
  home_clean TEXT;
  away_clean TEXT;
  status_clean TEXT;
  external_clean TEXT;
  recalc INTEGER := 0;
BEGIN
  PERFORM public.assert_admin_code(p_admin_code);

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
  status_clean := trim(COALESCE(p_status, ''));
  external_clean := nullif(trim(COALESCE(p_external_id, '')), '');

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
    status = status_clean,
    home_score = CASE
      WHEN status_clean IN ('postponed', 'cancelled') THEN NULL
      ELSE p_home_score
    END,
    away_score = CASE
      WHEN status_clean IN ('postponed', 'cancelled') THEN NULL
      ELSE p_away_score
    END,
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

CREATE OR REPLACE FUNCTION public.admin_set_match_result(
  p_admin_code TEXT,
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
  PERFORM public.assert_admin_code(p_admin_code);

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

-- ---------------------------------------------------------------------------
-- Remettre un match sous synchronisation automatique
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.admin_clear_match_override(
  p_admin_code TEXT,
  p_match_id UUID
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
  match_row public.matches%ROWTYPE;
  next_status TEXT;
  next_home INTEGER;
  next_away INTEGER;
  recalc INTEGER := 0;
BEGIN
  PERFORM public.assert_admin_code(p_admin_code);

  SELECT m.*
  INTO match_row
  FROM public.matches AS m
  WHERE m.id = p_match_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'MATCH_NOT_FOUND'
      USING ERRCODE = 'P0002',
            DETAIL = 'Match introuvable.';
  END IF;

  next_status := match_row.status;
  next_home := match_row.home_score;
  next_away := match_row.away_score;

  IF match_row.source = 'fixturedownload'
     AND match_row.source_home_team IS NOT NULL
     AND match_row.source_away_team IS NOT NULL
     AND match_row.source_kickoff_at IS NOT NULL THEN
    next_status := COALESCE(match_row.source_status, match_row.status);
    next_home := match_row.source_home_score;
    next_away := match_row.source_away_score;

    IF match_row.status IN ('postponed', 'cancelled')
       AND COALESCE(match_row.source_status, 'scheduled') = 'scheduled' THEN
      -- Conserve report / annulation manuels tant que la source n’a pas de score.
      next_status := match_row.status;
      next_home := NULL;
      next_away := NULL;
    ELSIF match_row.status = 'finished'
          AND COALESCE(match_row.source_status, 'scheduled') = 'scheduled' THEN
      -- Ne jamais rétrograder un match terminé vers programmé.
      next_status := 'finished';
      next_home := match_row.home_score;
      next_away := match_row.away_score;
    END IF;

    UPDATE public.matches AS m
    SET
      home_team = match_row.source_home_team,
      away_team = match_row.source_away_team,
      kickoff_at = match_row.source_kickoff_at,
      status = next_status,
      home_score = next_home,
      away_score = next_away,
      manual_override = FALSE,
      updated_at = now()
    WHERE m.id = p_match_id;
  ELSE
    UPDATE public.matches AS m
    SET
      manual_override = FALSE,
      updated_at = now()
    WHERE m.id = p_match_id;
  END IF;

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

-- ---------------------------------------------------------------------------
-- Horodatage global de synchronisation
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.admin_get_fixture_sync_meta(p_admin_code TEXT)
RETURNS TABLE (
  last_synced_at TIMESTAMPTZ,
  source_label TEXT
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  raw_value TEXT;
BEGIN
  PERFORM public.assert_admin_code(p_admin_code);

  SELECT s.value INTO raw_value
  FROM public.app_settings AS s
  WHERE s.key = 'fixture_sync_last_at';

  RETURN QUERY
  SELECT
    CASE
      WHEN raw_value IS NULL OR raw_value = '' THEN NULL
      ELSE raw_value::TIMESTAMPTZ
    END,
    'Fixture Download'::TEXT;
END;
$$;

-- ---------------------------------------------------------------------------
-- Application atomique du plan de synchronisation (écritures serveur)
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.admin_commit_fixture_sync(
  p_admin_code TEXT,
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
  points_recalculated INTEGER := 0;
  recalc INTEGER;
  created_count INTEGER := 0;
  updated_count INTEGER := 0;
  unchanged_count INTEGER := 0;
  new_results_count INTEGER := 0;
  protected_count INTEGER := 0;
BEGIN
  PERFORM public.assert_admin_code(p_admin_code);

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
    INSERT INTO public.matches (
      external_id,
      round_number,
      home_team,
      away_team,
      kickoff_at,
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

      UPDATE public.matches AS m
      SET
        external_id = update_item->>'external_id',
        source = 'fixturedownload',
        round_number = (update_item->>'round_number')::INTEGER,
        home_team = update_item->>'home_team',
        away_team = update_item->>'away_team',
        kickoff_at = (update_item->>'kickoff_at')::TIMESTAMPTZ,
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
-- Droits
-- ---------------------------------------------------------------------------

REVOKE ALL ON FUNCTION public.admin_clear_match_override(TEXT, UUID) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.admin_get_fixture_sync_meta(TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.admin_commit_fixture_sync(TEXT, JSONB) FROM PUBLIC;

GRANT EXECUTE ON FUNCTION public.admin_get_matches(TEXT) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.admin_create_match(TEXT, INTEGER, TEXT, TEXT, TIMESTAMPTZ, TEXT, INTEGER, INTEGER, TEXT) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.admin_update_match(TEXT, UUID, INTEGER, TEXT, TEXT, TIMESTAMPTZ, TEXT, INTEGER, INTEGER, TEXT) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.admin_set_match_result(TEXT, UUID, INTEGER, INTEGER) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.admin_clear_match_override(TEXT, UUID) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.admin_get_fixture_sync_meta(TEXT) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.admin_commit_fixture_sync(TEXT, JSONB) TO anon, authenticated;
