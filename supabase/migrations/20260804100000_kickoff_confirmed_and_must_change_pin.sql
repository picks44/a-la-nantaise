-- Horaires confirmés + enforcement serveur must_change_pin.
-- Fixture Download ne fournit pas de flag explicite « horaire confirmé ».
-- Règle prudente documentée : une heure exactement 00:00:00 en Europe/Paris
-- sur un match non terminé est traitée comme horaire provisoire (placeholder
-- fréquent du flux). L’admin peut forcer la confirmation manuellement.
-- Ne pas verrouiller / rappeler / ouvrir les pronostics tant que non confirmé.

-- ---------------------------------------------------------------------------
-- Colonne kickoff_time_confirmed
-- ---------------------------------------------------------------------------

ALTER TABLE public.matches
  ADD COLUMN IF NOT EXISTS kickoff_time_confirmed BOOLEAN NOT NULL DEFAULT TRUE;

COMMENT ON COLUMN public.matches.kickoff_time_confirmed IS
  'FALSE = date connue mais horaire provisoire (ex. placeholder 00:00 Paris). '
  'TRUE = horaire confirmé (sync non-minuit ou saisie admin).';

-- Backfill prudent : matchs non terminés à minuit Paris → non confirmés.
-- Les matchs terminés / live restent confirmés (DEFAULT / inchangés).
UPDATE public.matches AS m
SET kickoff_time_confirmed = FALSE
WHERE m.status IN ('scheduled', 'postponed')
  AND (m.kickoff_at AT TIME ZONE 'Europe/Paris')::time = TIME '00:00:00';

CREATE OR REPLACE FUNCTION public.is_paris_midnight_kickoff(p_kickoff TIMESTAMPTZ)
RETURNS BOOLEAN
LANGUAGE sql
IMMUTABLE
SET search_path = public
AS $$
  SELECT (p_kickoff AT TIME ZONE 'Europe/Paris')::time = TIME '00:00:00';
$$;

REVOKE ALL ON FUNCTION public.is_paris_midnight_kickoff(TIMESTAMPTZ) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.is_paris_midnight_kickoff(TIMESTAMPTZ)
  FROM anon, authenticated;

-- ---------------------------------------------------------------------------
-- must_change_pin : bloque les RPC métier via assert_player_session
-- (change_player_pin / get_session_player / logout_player restent hors assert)
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.assert_player_session(p_session_token TEXT)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  v_hash BYTEA;
  v_player_id UUID;
  v_session_id UUID;
  v_must_change BOOLEAN;
BEGIN
  v_hash := public.hash_session_token(p_session_token);

  SELECT s.id, s.player_id, pl.must_change_pin
  INTO v_session_id, v_player_id, v_must_change
  FROM public.player_sessions AS s
  INNER JOIN public.players AS pl ON pl.id = s.player_id
  WHERE s.token_hash = v_hash
    AND s.revoked_at IS NULL
    AND s.expires_at > now()
    AND pl.is_active = TRUE
  FOR UPDATE OF s;

  IF v_player_id IS NULL THEN
    RAISE EXCEPTION 'INVALID_SESSION'
      USING ERRCODE = '28000',
            DETAIL = 'Session invalide ou expirée.';
  END IF;

  IF v_must_change IS TRUE THEN
    RAISE EXCEPTION 'PIN_CHANGE_REQUIRED'
      USING ERRCODE = '28000',
            DETAIL = 'Tu dois choisir un nouveau PIN pour continuer.';
  END IF;

  RETURN v_player_id;
END;
$$;

REVOKE ALL ON FUNCTION public.assert_player_session(TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.assert_player_session(TEXT)
  FROM anon, authenticated;

-- ---------------------------------------------------------------------------
-- get_matches : expose kickoff_time_confirmed
-- ---------------------------------------------------------------------------

DROP FUNCTION IF EXISTS public.get_matches(TEXT);

CREATE OR REPLACE FUNCTION public.get_matches(p_session_token TEXT)
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
  updated_at TIMESTAMPTZ
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
BEGIN
  PERFORM public.assert_player_session(p_session_token);

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
    m.updated_at
  FROM public.matches AS m
  ORDER BY m.kickoff_at ASC, m.round_number ASC, m.home_team ASC, m.away_team ASC, m.id ASC;
END;
$$;

REVOKE ALL ON FUNCTION public.get_matches(TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.get_matches(TEXT) FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_matches(TEXT) TO anon, authenticated;

-- ---------------------------------------------------------------------------
-- upsert_prediction : refuse horaire non confirmé (avant verrouillage horaire)
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.upsert_prediction(
  p_session_token TEXT,
  p_match_id UUID,
  p_predicted_home_score INTEGER,
  p_predicted_away_score INTEGER
)
RETURNS TABLE (
  id UUID,
  player_id UUID,
  match_id UUID,
  predicted_home_score INTEGER,
  predicted_away_score INTEGER,
  points INTEGER,
  created_at TIMESTAMPTZ,
  updated_at TIMESTAMPTZ
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
#variable_conflict use_column
DECLARE
  v_player_id UUID;
  match_row public.matches%ROWTYPE;
BEGIN
  v_player_id := public.assert_player_session(p_session_token);

  IF p_match_id IS NULL THEN
    RAISE EXCEPTION 'MATCH_NOT_FOUND'
      USING ERRCODE = '22023',
            DETAIL = 'Match introuvable.';
  END IF;

  IF p_predicted_home_score IS NULL
     OR p_predicted_away_score IS NULL
     OR p_predicted_home_score < 0
     OR p_predicted_away_score < 0
     OR p_predicted_home_score > 15
     OR p_predicted_away_score > 15
  THEN
    RAISE EXCEPTION 'INVALID_SCORE'
      USING ERRCODE = '22023',
            DETAIL = 'Les scores doivent être des entiers entre 0 et 15.';
  END IF;

  SELECT m.*
  INTO match_row
  FROM public.matches AS m
  WHERE m.id = p_match_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'MATCH_NOT_FOUND'
      USING ERRCODE = '22023',
            DETAIL = 'Match introuvable.';
  END IF;

  IF match_row.status IN ('postponed', 'cancelled', 'finished') THEN
    RAISE EXCEPTION 'MATCH_NOT_OPENABLE'
      USING ERRCODE = 'P0001',
            DETAIL = 'Ce match n’accepte plus de pronostic.';
  END IF;

  IF match_row.kickoff_time_confirmed IS NOT TRUE THEN
    RAISE EXCEPTION 'MATCH_KICKOFF_UNCONFIRMED'
      USING ERRCODE = 'P0001',
            DETAIL = 'Horaire à confirmer : les pronostics ne sont pas encore ouverts.';
  END IF;

  IF now() >= match_row.kickoff_at THEN
    RAISE EXCEPTION 'MATCH_LOCKED'
      USING ERRCODE = 'P0001',
            DETAIL = 'Ce match a commencé : les pronostics sont maintenant verrouillés.';
  END IF;

  RETURN QUERY
  INSERT INTO public.predictions AS pr (
    player_id,
    match_id,
    predicted_home_score,
    predicted_away_score
  )
  VALUES (
    v_player_id,
    p_match_id,
    p_predicted_home_score,
    p_predicted_away_score
  )
  ON CONFLICT ON CONSTRAINT predictions_player_match_unique
  DO UPDATE SET
    predicted_home_score = EXCLUDED.predicted_home_score,
    predicted_away_score = EXCLUDED.predicted_away_score,
    updated_at = now()
  WHERE (
    SELECT m2.kickoff_at > now()
       AND m2.kickoff_time_confirmed IS TRUE
       AND m2.status NOT IN ('postponed', 'cancelled', 'finished')
    FROM public.matches AS m2
    WHERE m2.id = p_match_id
  )
  RETURNING
    pr.id,
    pr.player_id,
    pr.match_id,
    pr.predicted_home_score,
    pr.predicted_away_score,
    pr.points,
    pr.created_at,
    pr.updated_at;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'MATCH_LOCKED'
      USING ERRCODE = 'P0001',
            DETAIL = 'Ce match a commencé : les pronostics sont maintenant verrouillés.';
  END IF;
END;
$$;

REVOKE ALL ON FUNCTION public.upsert_prediction(TEXT, UUID, INTEGER, INTEGER) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.upsert_prediction(TEXT, UUID, INTEGER, INTEGER)
  FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION public.upsert_prediction(TEXT, UUID, INTEGER, INTEGER)
  TO anon, authenticated;

-- ---------------------------------------------------------------------------
-- Participation : exclure horaires non confirmés du dénominateur
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.get_round_participation(
  p_session_token TEXT,
  p_round_number INTEGER
)
RETURNS TABLE (
  player_id UUID,
  display_name TEXT,
  round_number INTEGER,
  status TEXT,
  predicted_count BIGINT,
  expected_count BIGINT
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
BEGIN
  PERFORM public.assert_player_session(p_session_token);

  IF p_round_number IS NULL OR p_round_number < 1 THEN
    RAISE EXCEPTION 'INVALID_ROUND'
      USING ERRCODE = '22023',
            DETAIL = 'Numéro de journée invalide.';
  END IF;

  RETURN QUERY
  WITH expected_matches AS (
    SELECT
      m.id,
      m.kickoff_at
    FROM public.matches AS m
    WHERE m.round_number = p_round_number
      AND m.status NOT IN ('cancelled', 'postponed')
      AND m.kickoff_time_confirmed IS TRUE
  ),
  active_players AS (
    SELECT
      p.id,
      p.display_name,
      p.created_at
    FROM public.players AS p
    WHERE p.is_active = TRUE
  ),
  player_expected AS (
    SELECT
      ap.id AS player_id,
      ap.display_name,
      em.id AS match_id
    FROM active_players AS ap
    INNER JOIN expected_matches AS em
      ON ap.created_at < em.kickoff_at
  ),
  counts AS (
    SELECT
      ap.id AS player_id,
      ap.display_name,
      (
        SELECT COUNT(*)::BIGINT
        FROM player_expected AS pe
        WHERE pe.player_id = ap.id
      ) AS expected_count,
      (
        SELECT COUNT(*)::BIGINT
        FROM player_expected AS pe
        INNER JOIN public.predictions AS pr
          ON pr.player_id = pe.player_id
         AND pr.match_id = pe.match_id
        WHERE pe.player_id = ap.id
      ) AS predicted_count
    FROM active_players AS ap
  )
  SELECT
    c.player_id,
    c.display_name,
    p_round_number AS round_number,
    CASE
      WHEN c.expected_count = 0 THEN 'not_applicable'
      WHEN c.predicted_count = 0 THEN 'missing'
      WHEN c.predicted_count >= c.expected_count THEN 'complete'
      ELSE 'partial'
    END AS status,
    c.predicted_count,
    c.expected_count
  FROM counts AS c
  ORDER BY c.display_name ASC;
END;
$$;

REVOKE ALL ON FUNCTION public.get_round_participation(TEXT, INTEGER) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.get_round_participation(TEXT, INTEGER)
  FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_round_participation(TEXT, INTEGER)
  TO anon, authenticated;

-- ---------------------------------------------------------------------------
-- Push : exclure horaires non confirmés des rappels
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.push_reminder_eligibility(
  p_now TIMESTAMPTZ DEFAULT now()
)
RETURNS TABLE (
  match_id UUID,
  player_id UUID,
  reminder_type TEXT,
  kickoff_snapshot TIMESTAMPTZ,
  due_at TIMESTAMPTZ
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    m.id AS match_id,
    pl.id AS player_id,
    '24h'::text AS reminder_type,
    m.kickoff_at AS kickoff_snapshot,
    m.kickoff_at - interval '24 hours' AS due_at
  FROM public.matches AS m
  CROSS JOIN public.players AS pl
  WHERE m.status = 'scheduled'
    AND m.kickoff_time_confirmed IS TRUE
    AND m.kickoff_at > p_now
    AND pl.is_active = TRUE
    AND p_now >= m.kickoff_at - interval '24 hours'
    AND p_now < m.kickoff_at - interval '23 hours'
    AND NOT EXISTS (
      SELECT 1
      FROM public.predictions AS pr
      WHERE pr.player_id = pl.id
        AND pr.match_id = m.id
    )
    AND EXISTS (
      SELECT 1
      FROM public.push_subscriptions AS s
      WHERE s.player_id = pl.id
        AND s.status = 'active'
    )

  UNION ALL

  SELECT
    m.id AS match_id,
    pl.id AS player_id,
    '2h'::text AS reminder_type,
    m.kickoff_at AS kickoff_snapshot,
    m.kickoff_at - interval '2 hours' AS due_at
  FROM public.matches AS m
  CROSS JOIN public.players AS pl
  WHERE m.status = 'scheduled'
    AND m.kickoff_time_confirmed IS TRUE
    AND m.kickoff_at > p_now
    AND pl.is_active = TRUE
    AND p_now >= m.kickoff_at - interval '2 hours'
    AND p_now < m.kickoff_at - interval '1 hour'
    AND NOT EXISTS (
      SELECT 1
      FROM public.predictions AS pr
      WHERE pr.player_id = pl.id
        AND pr.match_id = m.id
    )
    AND EXISTS (
      SELECT 1
      FROM public.push_subscriptions AS s
      WHERE s.player_id = pl.id
        AND s.status = 'active'
    );
$$;

REVOKE ALL ON FUNCTION public.push_reminder_eligibility(TIMESTAMPTZ)
  FROM PUBLIC, anon, authenticated;
