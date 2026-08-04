-- Tests SQL : API-Football provider (stack isolée a-la-nantaise-test uniquement)
-- Exécuter dans une transaction : BEGIN; \i ... ; ROLLBACK;

BEGIN;

-- 1) Singleton + flags shadow
DO $$
DECLARE
  v_shadow BOOLEAN;
  v_public BOOLEAN;
BEGIN
  IF (SELECT count(*) FROM public.provider_settings WHERE id = 1) <> 1 THEN
    RAISE EXCEPTION 'TEST_FAIL: provider_settings singleton manquant';
  END IF;

  SELECT shadow_enabled, public_provider_enabled
  INTO v_shadow, v_public
  FROM public.provider_settings
  WHERE id = 1;

  IF v_shadow IS NOT TRUE THEN
    RAISE EXCEPTION 'TEST_FAIL: shadow_enabled devrait être true';
  END IF;
  IF v_public IS NOT FALSE THEN
    RAISE EXCEPTION 'TEST_FAIL: public_provider_enabled devrait être false';
  END IF;
END;
$$;

-- 2) Impossible d’activer public_provider_enabled
DO $$
BEGIN
  BEGIN
    UPDATE public.provider_settings
    SET public_provider_enabled = TRUE
    WHERE id = 1;
    RAISE EXCEPTION 'TEST_FAIL: public_provider_enabled=true aurait dû être refusé';
  EXCEPTION
    WHEN check_violation THEN
      NULL; -- attendu
    WHEN OTHERS THEN
      IF SQLSTATE = 'P0001' AND SQLERRM LIKE '%TEST_FAIL%' THEN
        RAISE;
      END IF;
      -- autres erreurs de contrainte acceptables
      IF SQLSTATE NOT IN ('23514') THEN
        RAISE;
      END IF;
  END;
END;
$$;

-- 3) Réservation atomique + finalisation
DO $$
DECLARE
  v_call_id UUID;
  v_reserved INTEGER;
  v_consumed INTEGER;
  v_remaining INTEGER;
BEGIN
  SELECT out_call_id, remaining_usable
  INTO v_call_id, v_remaining
  FROM public.provider_reserve_api_call('/fixtures', 'system');

  IF v_call_id IS NULL THEN
    RAISE EXCEPTION 'TEST_FAIL: call_id manquant après réservation';
  END IF;

  SELECT reserved_count, consumed_count
  INTO v_reserved, v_consumed
  FROM public.provider_api_quota_days
  WHERE quota_date = public.provider_utc_today();

  IF v_reserved <> 1 THEN
    RAISE EXCEPTION 'TEST_FAIL: reserved_count=% (attendu 1)', v_reserved;
  END IF;

  IF NOT public.provider_finalize_api_call(
    v_call_id,
    'consumed',
    200,
    90,
    100,
    15,
    NULL,
    NULL,
    10,
    100
  ) THEN
    RAISE EXCEPTION 'TEST_FAIL: finalize consumed a échoué';
  END IF;

  SELECT reserved_count, consumed_count
  INTO v_reserved, v_consumed
  FROM public.provider_api_quota_days
  WHERE quota_date = public.provider_utc_today();

  IF v_reserved <> 0 OR v_consumed <> 1 THEN
    RAISE EXCEPTION
      'TEST_FAIL: après consume reserved=% consumed=%',
      v_reserved,
      v_consumed;
  END IF;
END;
$$;

-- 4) Restitution (released) d’une réservation non utilisée
DO $$
DECLARE
  v_call_id UUID;
  v_released INTEGER;
BEGIN
  SELECT out_call_id INTO v_call_id
  FROM public.provider_reserve_api_call('/status', 'system');

  PERFORM public.provider_finalize_api_call(
    v_call_id,
    'released',
    NULL,
    NULL,
    NULL,
    NULL,
    'PROVIDER_TIMEOUT',
    'timeout simulé',
    NULL,
    NULL
  );

  SELECT released_count INTO v_released
  FROM public.provider_api_quota_days
  WHERE quota_date = public.provider_utc_today();

  IF v_released < 1 THEN
    RAISE EXCEPTION 'TEST_FAIL: released_count devrait augmenter';
  END IF;
END;
$$;

-- 5) Épuisement du budget utilisable (limite 100, réserve 10 → 90 max)
DO $$
DECLARE
  i INTEGER;
  v_call_id UUID;
  v_consumed INTEGER;
BEGIN
  SELECT consumed_count INTO v_consumed
  FROM public.provider_api_quota_days
  WHERE quota_date = public.provider_utc_today();

  -- Atteindre exactement 90 consommés
  FOR i IN (v_consumed + 1)..90 LOOP
    SELECT out_call_id INTO v_call_id
    FROM public.provider_reserve_api_call('/fixtures', 'system');
    PERFORM public.provider_finalize_api_call(
      v_call_id,
      'consumed',
      200,
      NULL,
      NULL,
      1,
      NULL,
      NULL,
      NULL,
      NULL
    );
  END LOOP;

  BEGIN
    PERFORM * FROM public.provider_reserve_api_call('/fixtures', 'system');
    RAISE EXCEPTION 'TEST_FAIL: PROVIDER_QUOTA_EXHAUSTED attendu';
  EXCEPTION
    WHEN OTHERS THEN
      IF SQLERRM NOT LIKE '%PROVIDER_QUOTA_EXHAUSTED%' THEN
        RAISE;
      END IF;
  END;
END;
$$;

-- 6) Upsert shadow sans application aux matchs
DO $$
DECLARE
  v_id UUID;
  v_applied BOOLEAN;
BEGIN
  v_id := public.provider_upsert_fixture_shadow(
    jsonb_build_object(
      'external_fixture_id', '999001',
      'external_league_id', 62,
      'external_season_year', 2025,
      'home_team', 'Nantes',
      'away_team', 'Test FC',
      'kickoff_at', now(),
      'provider_status_raw', 'NS',
      'provider_status_normalized', 'kickoff_confirmed',
      'events', jsonb_build_array(
        jsonb_build_object(
          'external_event_key', 'goal|1',
          'event_type', 'goal',
          'elapsed', 10,
          'extra', 0,
          'sort_period', 1
        )
      ),
      'lineups', '[]'::jsonb
    )
  );

  IF v_id IS NULL THEN
    RAISE EXCEPTION 'TEST_FAIL: upsert shadow sans id';
  END IF;

  SELECT applied_to_match INTO v_applied
  FROM public.provider_fixtures
  WHERE id = v_id;

  IF v_applied IS NOT FALSE THEN
    RAISE EXCEPTION 'TEST_FAIL: applied_to_match devrait rester false';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM public.provider_fixture_events
    WHERE provider_fixture_id = v_id
      AND external_event_key = 'goal|1'
  ) THEN
    RAISE EXCEPTION 'TEST_FAIL: événement shadow non inséré';
  END IF;

  -- Idempotence événement
  PERFORM public.provider_upsert_fixture_shadow(
    jsonb_build_object(
      'external_fixture_id', '999001',
      'external_league_id', 62,
      'external_season_year', 2025,
      'home_team', 'Nantes',
      'away_team', 'Test FC',
      'kickoff_at', now(),
      'provider_status_raw', 'NS',
      'provider_status_normalized', 'kickoff_confirmed',
      'events', jsonb_build_array(
        jsonb_build_object(
          'external_event_key', 'goal|1',
          'event_type', 'goal',
          'elapsed', 10,
          'extra', 0,
          'sort_period', 1
        )
      ),
      'lineups', '[]'::jsonb
    )
  );

  IF (
    SELECT count(*)
    FROM public.provider_fixture_events
    WHERE provider_fixture_id = v_id
      AND external_event_key = 'goal|1'
  ) <> 1 THEN
    RAISE EXCEPTION 'TEST_FAIL: doublon d’événement après re-sync';
  END IF;
END;
$$;

-- 7) admin_update_provider_settings ne peut pas activer le cutover
DO $$
DECLARE
  v_token TEXT;
  v_public BOOLEAN;
BEGIN
  UPDATE public.app_settings
  SET
    value = extensions.crypt('admin-test-code', extensions.gen_salt('bf')),
    updated_at = now()
  WHERE key = 'admin_code_hash';

  INSERT INTO public.app_settings (key, value)
  SELECT 'admin_code_hash', extensions.crypt('admin-test-code', extensions.gen_salt('bf'))
  WHERE NOT EXISTS (
    SELECT 1 FROM public.app_settings AS s WHERE s.key = 'admin_code_hash'
  );

  UPDATE public.admin_auth_state
  SET failed_attempts = 0, locked_until = NULL
  WHERE id = TRUE;

  SELECT session_token INTO v_token
  FROM public.login_admin('admin-test-code');

  PERFORM * FROM public.admin_update_provider_settings(
    v_token,
    TRUE,
    83,
    'Nantes',
    2025,
    TRUE
  );

  SELECT public_provider_enabled INTO v_public
  FROM public.provider_settings
  WHERE id = 1;

  IF v_public IS NOT FALSE THEN
    RAISE EXCEPTION 'TEST_FAIL: admin_update_provider_settings a activé le cutover';
  END IF;

  IF (
    SELECT public_activation_message
    FROM public.admin_get_provider_status(v_token)
    LIMIT 1
  ) IS DISTINCT FROM 'Activation publique indisponible en mode shadow' THEN
    RAISE EXCEPTION 'TEST_FAIL: message d’activation publique incorrect';
  END IF;
END;
$$;

ROLLBACK;
