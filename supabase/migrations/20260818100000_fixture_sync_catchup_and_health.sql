-- Catch-up sync hors fenêtre +8 h + observabilité des tentatives Fixture Download.
--
-- Durées :
--   105 minutes = seuil technique de sync résultat (résultat rarement publié avant).
--   La fenêtre métier « match en cours » (150 min) est définie côté frontend
--   (src/lib/matchLifecycle.ts) et n’est volontairement pas dupliquée ici.

-- ---------------------------------------------------------------------------
-- 1. Predicat catch-up : plus de plafond +8 h
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.fixture_result_sync_is_needed()
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.matches AS m
    WHERE m.kickoff_time_confirmed = TRUE
      AND m.status NOT IN ('finished', 'postponed', 'cancelled')
      AND now() >= m.kickoff_at + interval '105 minutes'
  );
$$;

COMMENT ON FUNCTION public.fixture_result_sync_is_needed() IS
  'True when at least one confirmed match is past kickoff+105min and not finished/postponed/cancelled. No upper bound: used as catch-up retry for the */15 cron.';

REVOKE ALL ON FUNCTION public.fixture_result_sync_is_needed() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.fixture_result_sync_is_needed() FROM anon, authenticated;

-- ---------------------------------------------------------------------------
-- 2. Clés d’observabilité (aucune secret)
-- ---------------------------------------------------------------------------

INSERT INTO public.app_settings (key, value)
VALUES
  ('fixture_sync_last_attempt_at', ''),
  ('fixture_sync_last_attempt_ok', ''),
  ('fixture_sync_last_error_code', ''),
  ('fixture_sync_last_error_message', ''),
  ('fixture_sync_last_summary', '')
ON CONFLICT (key) DO NOTHING;

-- ---------------------------------------------------------------------------
-- 3. Enregistrement d’une tentative (succès ou échec) par l’Edge Function
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.record_fixture_sync_attempt(
  p_admin_session_token TEXT,
  p_ok BOOLEAN,
  p_error_code TEXT DEFAULT NULL,
  p_error_message TEXT DEFAULT NULL,
  p_summary JSONB DEFAULT NULL
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  v_now TEXT := now()::TEXT;
  v_ok TEXT;
  v_error_code TEXT;
  v_error_message TEXT;
  v_summary TEXT;
BEGIN
  PERFORM public.assert_admin_session(p_admin_session_token);

  v_ok := CASE WHEN p_ok THEN 'true' ELSE 'false' END;
  v_error_code := CASE
    WHEN p_ok THEN ''
    ELSE left(COALESCE(p_error_code, ''), 80)
  END;
  v_error_message := CASE
    WHEN p_ok THEN ''
    ELSE left(COALESCE(p_error_message, ''), 400)
  END;
  v_summary := CASE
    WHEN p_summary IS NULL THEN ''
    ELSE p_summary::TEXT
  END;

  INSERT INTO public.app_settings (key, value)
  VALUES
    ('fixture_sync_last_attempt_at', v_now),
    ('fixture_sync_last_attempt_ok', v_ok),
    ('fixture_sync_last_error_code', v_error_code),
    ('fixture_sync_last_error_message', v_error_message),
    ('fixture_sync_last_summary', v_summary)
  ON CONFLICT (key) DO UPDATE
  SET
    value = EXCLUDED.value,
    updated_at = now();
END;
$$;

REVOKE ALL ON FUNCTION public.record_fixture_sync_attempt(TEXT, BOOLEAN, TEXT, TEXT, JSONB)
  FROM PUBLIC;
REVOKE ALL ON FUNCTION public.record_fixture_sync_attempt(TEXT, BOOLEAN, TEXT, TEXT, JSONB)
  FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION public.record_fixture_sync_attempt(TEXT, BOOLEAN, TEXT, TEXT, JSONB)
  TO anon, authenticated;

-- ---------------------------------------------------------------------------
-- 4. Meta admin enrichie
-- ---------------------------------------------------------------------------

DROP FUNCTION IF EXISTS public.admin_get_fixture_sync_meta(TEXT);

CREATE OR REPLACE FUNCTION public.admin_get_fixture_sync_meta(
  p_admin_session_token TEXT
)
RETURNS TABLE (
  last_synced_at TIMESTAMPTZ,
  source_label TEXT,
  last_attempt_at TIMESTAMPTZ,
  last_attempt_ok BOOLEAN,
  last_error_code TEXT,
  last_error_message TEXT,
  last_summary JSONB
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  v_last_synced TEXT;
  v_attempt_at TEXT;
  v_attempt_ok TEXT;
  v_error_code TEXT;
  v_error_message TEXT;
  v_summary TEXT;
BEGIN
  PERFORM public.assert_admin_session(p_admin_session_token);

  SELECT s.value INTO v_last_synced
  FROM public.app_settings AS s
  WHERE s.key = 'fixture_sync_last_at';

  SELECT s.value INTO v_attempt_at
  FROM public.app_settings AS s
  WHERE s.key = 'fixture_sync_last_attempt_at';

  SELECT s.value INTO v_attempt_ok
  FROM public.app_settings AS s
  WHERE s.key = 'fixture_sync_last_attempt_ok';

  SELECT s.value INTO v_error_code
  FROM public.app_settings AS s
  WHERE s.key = 'fixture_sync_last_error_code';

  SELECT s.value INTO v_error_message
  FROM public.app_settings AS s
  WHERE s.key = 'fixture_sync_last_error_message';

  SELECT s.value INTO v_summary
  FROM public.app_settings AS s
  WHERE s.key = 'fixture_sync_last_summary';

  RETURN QUERY
  SELECT
    CASE
      WHEN v_last_synced IS NULL OR v_last_synced = '' THEN NULL
      ELSE v_last_synced::TIMESTAMPTZ
    END,
    'Fixture Download'::TEXT,
    CASE
      WHEN v_attempt_at IS NULL OR v_attempt_at = '' THEN NULL
      ELSE v_attempt_at::TIMESTAMPTZ
    END,
    CASE
      WHEN v_attempt_ok = 'true' THEN TRUE
      WHEN v_attempt_ok = 'false' THEN FALSE
      ELSE NULL
    END,
    NULLIF(v_error_code, ''),
    NULLIF(v_error_message, ''),
    CASE
      WHEN v_summary IS NULL OR v_summary = '' THEN NULL
      ELSE v_summary::JSONB
    END;
END;
$$;

REVOKE ALL ON FUNCTION public.admin_get_fixture_sync_meta(TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.admin_get_fixture_sync_meta(TEXT) FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION public.admin_get_fixture_sync_meta(TEXT) TO anon, authenticated;
