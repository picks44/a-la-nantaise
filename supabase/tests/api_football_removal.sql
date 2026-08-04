-- Vérifie le retrait complet d’API-Football après toutes les migrations.
-- Stack isolée uniquement : a-la-nantaise-test (via npm run test:sql:local).

BEGIN;

-- 1) Aucune table provider_*
DO $$
DECLARE
  v_tables TEXT[];
BEGIN
  SELECT coalesce(array_agg(c.relname ORDER BY c.relname), ARRAY[]::TEXT[])
  INTO v_tables
  FROM pg_class AS c
  JOIN pg_namespace AS n ON n.oid = c.relnamespace
  WHERE n.nspname = 'public'
    AND c.relkind = 'r'
    AND c.relname LIKE 'provider_%';

  IF array_length(v_tables, 1) IS NOT NULL THEN
    RAISE EXCEPTION 'TEST_FAIL: tables provider_* restantes: %', v_tables;
  END IF;
END;
$$;

-- 2) Aucune fonction provider_* ou admin_*provider*
DO $$
DECLARE
  v_funcs TEXT[];
BEGIN
  SELECT coalesce(array_agg(p.proname ORDER BY p.proname), ARRAY[]::TEXT[])
  INTO v_funcs
  FROM pg_proc AS p
  JOIN pg_namespace AS n ON n.oid = p.pronamespace
  WHERE n.nspname = 'public'
    AND (
      p.proname LIKE 'provider_%'
      OR p.proname LIKE 'admin_%provider%'
      OR p.proname = 'get_public_match_center_enabled'
    );

  IF array_length(v_funcs, 1) IS NOT NULL THEN
    RAISE EXCEPTION 'TEST_FAIL: fonctions provider restantes: %', v_funcs;
  END IF;
END;
$$;

-- 3) Aucune colonne provider / live / proposed / official_result sur matches
DO $$
DECLARE
  v_cols TEXT[];
BEGIN
  SELECT coalesce(array_agg(a.attname ORDER BY a.attname), ARRAY[]::TEXT[])
  INTO v_cols
  FROM pg_attribute AS a
  JOIN pg_class AS c ON c.oid = a.attrelid
  JOIN pg_namespace AS n ON n.oid = c.relnamespace
  WHERE n.nspname = 'public'
    AND c.relname = 'matches'
    AND a.attnum > 0
    AND NOT a.attisdropped
    AND (
      a.attname LIKE 'provider_%'
      OR a.attname LIKE 'live_%'
      OR a.attname LIKE 'official_result_%'
    );

  IF array_length(v_cols, 1) IS NOT NULL THEN
    RAISE EXCEPTION 'TEST_FAIL: colonnes provider restantes sur matches: %', v_cols;
  END IF;
END;
$$;

-- 4) matches.source accepte manual / fixturedownload, refuse api_football
DO $$
DECLARE
  v_season_id UUID := public.get_active_season_id();
  v_match_id UUID := 'ffffffff-ffff-ffff-ffff-fffffffff930';
BEGIN
  INSERT INTO public.matches (
    id, season_id, external_id, round_number, home_team, away_team,
    kickoff_at, kickoff_time_confirmed, status, source
  ) VALUES (
    v_match_id, v_season_id, 'removal-source-manual', 93,
    'FC Nantes', 'Source Manual', now() + interval '10 days', TRUE,
    'scheduled', 'manual'
  );

  UPDATE public.matches
  SET source = 'fixturedownload'
  WHERE id = v_match_id;

  BEGIN
    UPDATE public.matches
    SET source = 'api_football'
    WHERE id = v_match_id;
    RAISE EXCEPTION 'TEST_FAIL: source=api_football aurait dû être refusé';
  EXCEPTION
    WHEN check_violation THEN
      NULL;
    WHEN OTHERS THEN
      IF SQLERRM LIKE '%TEST_FAIL%' THEN
        RAISE;
      END IF;
      RAISE EXCEPTION 'TEST_FAIL: refus api_football inattendu: %', SQLERRM;
  END;

  DELETE FROM public.matches WHERE id = v_match_id;
END;
$$;

-- 5) RPC historiques hors provider toujours présentes
DO $$
DECLARE
  v_missing TEXT[] := ARRAY[]::TEXT[];
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.proname = 'admin_set_match_result'
  ) THEN
    v_missing := v_missing || 'admin_set_match_result';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.proname = 'admin_get_matches'
  ) THEN
    v_missing := v_missing || 'admin_get_matches';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.proname = 'admin_commit_fixture_sync'
  ) THEN
    v_missing := v_missing || 'admin_commit_fixture_sync';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.proname = 'admin_get_fixture_sync_meta'
  ) THEN
    v_missing := v_missing || 'admin_get_fixture_sync_meta';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.proname = 'recalculate_season_achievements'
  ) THEN
    v_missing := v_missing || 'recalculate_season_achievements';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.proname = 'get_active_season_id'
  ) THEN
    v_missing := v_missing || 'get_active_season_id';
  END IF;

  IF array_length(v_missing, 1) IS NOT NULL THEN
    RAISE EXCEPTION 'TEST_FAIL: RPC manquantes: %', v_missing;
  END IF;
END;
$$;

-- 6) Fixture Download : source fixturedownload + sync meta toujours OK
DO $$
DECLARE
  v_season_id UUID := public.get_active_season_id();
  v_match_id UUID := 'ffffffff-ffff-ffff-ffff-fffffffff931';
BEGIN
  INSERT INTO public.matches (
    id, season_id, external_id, round_number, home_team, away_team,
    kickoff_at, kickoff_time_confirmed, status, source,
    source_home_team, source_away_team, source_kickoff_at, source_status,
    last_synced_at
  ) VALUES (
    v_match_id, v_season_id, 'fd-removal-1', 94,
    'FC Nantes', 'Fixture Keep', now() + interval '12 days', TRUE,
    'scheduled', 'fixturedownload',
    'FC Nantes', 'Fixture Keep', now() + interval '12 days', 'scheduled',
    now()
  );

  IF NOT EXISTS (
    SELECT 1 FROM public.matches
    WHERE id = v_match_id AND source = 'fixturedownload'
  ) THEN
    RAISE EXCEPTION 'TEST_FAIL: match Fixture Download non conservé';
  END IF;

  DELETE FROM public.matches WHERE id = v_match_id;
END;
$$;

-- 7) Correctif trophées (trophies_count = 0) toujours fonctionnel
DO $$
DECLARE
  v_season_id UUID := public.get_active_season_id();
  v_player_id UUID := 'eeeeeeee-eeee-eeee-eeee-eeeeeeeeee93';
  v_count INTEGER;
  v_active INTEGER;
BEGIN
  INSERT INTO public.players (
    id, display_name, is_active, created_at, pin_hash, must_change_pin
  ) VALUES (
    v_player_id, 'RemovalTrophy', TRUE, now() - interval '30 days',
    extensions.crypt('1234', extensions.gen_salt('bf')), FALSE
  )
  ON CONFLICT (id) DO UPDATE
  SET
    display_name = EXCLUDED.display_name,
    is_active = TRUE,
    pin_hash = EXCLUDED.pin_hash,
    must_change_pin = FALSE,
    pin_failed_attempts = 0,
    pin_locked_until = NULL;

  DELETE FROM public.predictions WHERE player_id = v_player_id;
  DELETE FROM public.player_trophies
  WHERE player_id = v_player_id AND season_id = v_season_id;

  INSERT INTO public.player_season_stats (
    player_id, season_id, trophies_count
  ) VALUES (
    v_player_id, v_season_id, 5
  )
  ON CONFLICT (player_id, season_id) DO UPDATE
  SET trophies_count = 5;

  PERFORM public.recalculate_season_achievements(v_season_id);

  SELECT count(*)::INTEGER
  INTO v_active
  FROM public.player_trophies AS t
  WHERE t.player_id = v_player_id
    AND t.season_id = v_season_id
    AND t.is_active = TRUE;

  SELECT s.trophies_count
  INTO v_count
  FROM public.player_season_stats AS s
  WHERE s.player_id = v_player_id AND s.season_id = v_season_id;

  IF v_active <> 0 THEN
    RAISE EXCEPTION 'TEST_FAIL: trophées actifs inattendus (%)', v_active;
  END IF;

  IF v_count IS DISTINCT FROM 0 THEN
    RAISE EXCEPTION
      'TEST_FAIL: trophies_count devrait être 0, obtenu %',
      v_count;
  END IF;
END;
$$;

-- 8) Provenance manuelle : ne bloque pas conceptuellement le retrait ;
--    score, statut et manual_override restent intacts après 193000.
DO $$
DECLARE
  v_season_id UUID := public.get_active_season_id();
  v_match_id UUID := 'ffffffff-ffff-ffff-ffff-fffffffff933';
  v_block BIGINT;
  v_status TEXT;
  v_home INTEGER;
  v_away INTEGER;
  v_override BOOLEAN;
BEGIN
  INSERT INTO public.matches (
    id, season_id, external_id, round_number, home_team, away_team,
    kickoff_at, kickoff_time_confirmed, status, home_score, away_score,
    source, manual_override
  ) VALUES (
    v_match_id, v_season_id, 'removal-manual-result', 96,
    'FC Nantes', 'Manual Result', now() - interval '2 days', TRUE,
    'finished', 2, 1, 'manual', TRUE
  )
  ON CONFLICT (id) DO UPDATE
  SET
    season_id = EXCLUDED.season_id,
    status = 'finished',
    home_score = 2,
    away_score = 1,
    source = 'manual',
    manual_override = TRUE;

  -- Réplique du critère official_result du garde-fou 193000 (colonnes déjà droppées).
  CREATE TEMP TABLE tmp_removal_guard_official (
    official_result_source TEXT,
    official_result_validated_at TIMESTAMPTZ
  ) ON COMMIT DROP;

  INSERT INTO tmp_removal_guard_official (official_result_source, official_result_validated_at)
  VALUES ('manual', now());

  SELECT count(*) INTO v_block
  FROM tmp_removal_guard_official AS t
  WHERE t.official_result_source IS NOT NULL
    AND t.official_result_source IS DISTINCT FROM 'manual';

  IF v_block <> 0 THEN
    RAISE EXCEPTION
      'TEST_FAIL: provenance manual aurait dû être ignorée par le garde-fou';
  END IF;

  INSERT INTO tmp_removal_guard_official (official_result_source, official_result_validated_at)
  VALUES ('admin_validated_provider', now());

  SELECT count(*) INTO v_block
  FROM tmp_removal_guard_official AS t
  WHERE t.official_result_source IS NOT NULL
    AND t.official_result_source IS DISTINCT FROM 'manual';

  IF v_block <> 1 THEN
    RAISE EXCEPTION
      'TEST_FAIL: admin_validated_provider devrait bloquer (obtenu %)',
      v_block;
  END IF;

  SELECT m.status, m.home_score, m.away_score, m.manual_override
  INTO v_status, v_home, v_away, v_override
  FROM public.matches AS m
  WHERE m.id = v_match_id;

  IF v_status IS DISTINCT FROM 'finished'
     OR v_home IS DISTINCT FROM 2
     OR v_away IS DISTINCT FROM 1
     OR v_override IS DISTINCT FROM TRUE
  THEN
    RAISE EXCEPTION
      'TEST_FAIL: résultat manuel non conservé (status=%, score=%-%, override=%)',
      v_status, v_home, v_away, v_override;
  END IF;

  DELETE FROM public.matches WHERE id = v_match_id;
END;
$$;

ROLLBACK;
