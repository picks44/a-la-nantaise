-- Web Push — abonnements, rappels logiques, livraisons par appareil.
-- Accès frontend : RPC SECURITY DEFINER + code commun uniquement.
-- Envoi : Edge Function (service_role) via RPC job (EXECUTE révoqué pour anon).

-- ---------------------------------------------------------------------------
-- Flag d’activation globale (Cron / envois)
-- ---------------------------------------------------------------------------

INSERT INTO public.app_settings (key, value)
VALUES ('push_sending_enabled', 'false')
ON CONFLICT (key) DO NOTHING;

-- ---------------------------------------------------------------------------
-- Tables
-- ---------------------------------------------------------------------------

CREATE TABLE public.push_subscriptions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  player_id UUID NOT NULL REFERENCES public.players (id) ON DELETE CASCADE,
  endpoint TEXT NOT NULL,
  endpoint_hash BYTEA NOT NULL,
  p256dh TEXT NOT NULL,
  auth TEXT NOT NULL,
  content_encoding TEXT NOT NULL DEFAULT 'aes128gcm'
    CHECK (content_encoding = 'aes128gcm'),
  expiration_time TIMESTAMPTZ,
  status TEXT NOT NULL DEFAULT 'active'
    CHECK (status IN ('active', 'disabled', 'expired')),
  user_agent TEXT,
  last_seen_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_success_at TIMESTAMPTZ,
  failure_count INTEGER NOT NULL DEFAULT 0
    CHECK (failure_count >= 0),
  invalidated_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT push_subscriptions_endpoint_hash_unique UNIQUE (endpoint_hash),
  CONSTRAINT push_subscriptions_endpoint_https CHECK (
    endpoint ~* '^https://'
  ),
  CONSTRAINT push_subscriptions_endpoint_len CHECK (
    char_length(endpoint) BETWEEN 20 AND 2048
  ),
  CONSTRAINT push_subscriptions_p256dh_len CHECK (
    char_length(p256dh) BETWEEN 16 AND 256
  ),
  CONSTRAINT push_subscriptions_auth_len CHECK (
    char_length(auth) BETWEEN 8 AND 128
  ),
  CONSTRAINT push_subscriptions_ua_len CHECK (
    user_agent IS NULL OR char_length(user_agent) <= 512
  )
);

CREATE INDEX push_subscriptions_player_active_idx
  ON public.push_subscriptions (player_id)
  WHERE status = 'active';

CREATE TABLE public.push_reminders (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  match_id UUID NOT NULL REFERENCES public.matches (id) ON DELETE CASCADE,
  player_id UUID NOT NULL REFERENCES public.players (id) ON DELETE CASCADE,
  reminder_type TEXT NOT NULL CHECK (reminder_type IN ('24h', '2h')),
  kickoff_snapshot TIMESTAMPTZ NOT NULL,
  due_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT push_reminders_match_player_type_unique
    UNIQUE (match_id, player_id, reminder_type)
);

CREATE INDEX push_reminders_due_at_idx ON public.push_reminders (due_at);

CREATE TABLE public.push_deliveries (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  reminder_id UUID NOT NULL
    REFERENCES public.push_reminders (id) ON DELETE CASCADE,
  subscription_id UUID NOT NULL
    REFERENCES public.push_subscriptions (id) ON DELETE CASCADE,
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (
      status IN (
        'pending',
        'processing',
        'sent',
        'failed',
        'expired',
        'skipped'
      )
    ),
  claimed_at TIMESTAMPTZ,
  lease_until TIMESTAMPTZ,
  attempt_count INTEGER NOT NULL DEFAULT 0
    CHECK (attempt_count >= 0),
  response_status INTEGER,
  next_attempt_at TIMESTAMPTZ,
  sent_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT push_deliveries_reminder_subscription_unique
    UNIQUE (reminder_id, subscription_id)
);

CREATE INDEX push_deliveries_claim_idx
  ON public.push_deliveries (status, next_attempt_at, lease_until);

CREATE TRIGGER push_subscriptions_set_updated_at
  BEFORE UPDATE ON public.push_subscriptions
  FOR EACH ROW
  EXECUTE FUNCTION public.set_updated_at();

CREATE TRIGGER push_deliveries_set_updated_at
  BEFORE UPDATE ON public.push_deliveries
  FOR EACH ROW
  EXECUTE FUNCTION public.set_updated_at();

-- ---------------------------------------------------------------------------
-- RLS : aucune policy — accès uniquement via RPC / service_role
-- ---------------------------------------------------------------------------

ALTER TABLE public.push_subscriptions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.push_reminders ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.push_deliveries ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public.push_subscriptions FROM PUBLIC, anon, authenticated;
REVOKE ALL ON TABLE public.push_reminders FROM PUBLIC, anon, authenticated;
REVOKE ALL ON TABLE public.push_deliveries FROM PUBLIC, anon, authenticated;

-- ---------------------------------------------------------------------------
-- Helpers internes
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.push_endpoint_hash(p_endpoint TEXT)
RETURNS BYTEA
LANGUAGE sql
IMMUTABLE
SET search_path = public, extensions
AS $$
  SELECT extensions.digest(convert_to(p_endpoint, 'UTF8'), 'sha256');
$$;

REVOKE ALL ON FUNCTION public.push_endpoint_hash(TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.push_endpoint_hash(TEXT) FROM anon, authenticated;

CREATE OR REPLACE FUNCTION public.assert_push_endpoint(p_endpoint TEXT)
RETURNS VOID
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF p_endpoint IS NULL OR length(trim(p_endpoint)) < 20 THEN
    RAISE EXCEPTION 'INVALID_PUSH_ENDPOINT'
      USING ERRCODE = '22023',
            DETAIL = 'Endpoint push manquant ou trop court.';
  END IF;

  IF p_endpoint !~* '^https://' THEN
    RAISE EXCEPTION 'INVALID_PUSH_ENDPOINT'
      USING ERRCODE = '22023',
            DETAIL = 'L’endpoint push doit être en HTTPS.';
  END IF;

  IF char_length(p_endpoint) > 2048 THEN
    RAISE EXCEPTION 'INVALID_PUSH_ENDPOINT'
      USING ERRCODE = '22023',
            DETAIL = 'Endpoint push trop long.';
  END IF;

  -- Bloque localhost / IP littérales / réseaux privés (SSRF basique).
  IF p_endpoint ~* '^https://(localhost|127\.|0\.0\.0\.0|10\.|192\.168\.|172\.(1[6-9]|2[0-9]|3[0-1])\.|\[::1\])'
  THEN
    RAISE EXCEPTION 'INVALID_PUSH_ENDPOINT'
      USING ERRCODE = '22023',
            DETAIL = 'Endpoint push refusé.';
  END IF;
END;
$$;

REVOKE ALL ON FUNCTION public.assert_push_endpoint(TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.assert_push_endpoint(TEXT) FROM anon, authenticated;

CREATE OR REPLACE FUNCTION public.assert_active_player(p_player_id UUID)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF p_player_id IS NULL THEN
    RAISE EXCEPTION 'INVALID_PLAYER'
      USING ERRCODE = '22023',
            DETAIL = 'Identifiant joueur manquant.';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM public.players AS pl
    WHERE pl.id = p_player_id
      AND pl.is_active = TRUE
  ) THEN
    RAISE EXCEPTION 'INVALID_PLAYER'
      USING ERRCODE = '22023',
            DETAIL = 'Joueur introuvable ou inactif.';
  END IF;
END;
$$;

REVOKE ALL ON FUNCTION public.assert_active_player(UUID) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.assert_active_player(UUID) FROM anon, authenticated;

-- ---------------------------------------------------------------------------
-- RPC frontend (anon)
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.register_push_subscription(
  p_access_code TEXT,
  p_player_id UUID,
  p_endpoint TEXT,
  p_p256dh TEXT,
  p_auth TEXT,
  p_expiration_time TIMESTAMPTZ DEFAULT NULL,
  p_user_agent TEXT DEFAULT NULL
)
RETURNS TABLE (
  id UUID,
  player_id UUID,
  status TEXT,
  updated_at TIMESTAMPTZ
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  v_hash BYTEA;
  v_active_for_player INTEGER;
  v_active_total INTEGER;
  v_ua TEXT;
BEGIN
  PERFORM public.assert_access_code(p_access_code);
  PERFORM public.assert_active_player(p_player_id);
  PERFORM public.assert_push_endpoint(p_endpoint);

  IF p_p256dh IS NULL OR char_length(p_p256dh) < 16 OR char_length(p_p256dh) > 256 THEN
    RAISE EXCEPTION 'INVALID_PUSH_KEYS'
      USING ERRCODE = '22023',
            DETAIL = 'Clé p256dh invalide.';
  END IF;

  IF p_auth IS NULL OR char_length(p_auth) < 8 OR char_length(p_auth) > 128 THEN
    RAISE EXCEPTION 'INVALID_PUSH_KEYS'
      USING ERRCODE = '22023',
            DETAIL = 'Clé auth invalide.';
  END IF;

  v_ua := NULLIF(left(trim(COALESCE(p_user_agent, '')), 512), '');
  v_hash := public.push_endpoint_hash(p_endpoint);

  -- Réassociation du même endpoint : hors plafonds (upsert).
  IF NOT EXISTS (
    SELECT 1
    FROM public.push_subscriptions AS s
    WHERE s.endpoint_hash = v_hash
  ) THEN
    SELECT count(*)::integer INTO v_active_for_player
    FROM public.push_subscriptions AS s
    WHERE s.player_id = p_player_id
      AND s.status = 'active';

    IF v_active_for_player >= 5 THEN
      RAISE EXCEPTION 'PUSH_DEVICE_LIMIT'
        USING ERRCODE = 'P0001',
              DETAIL = 'Maximum 5 appareils actifs pour ce joueur.';
    END IF;

    SELECT count(*)::integer INTO v_active_total
    FROM public.push_subscriptions AS s
    WHERE s.status = 'active';

    IF v_active_total >= 25 THEN
      RAISE EXCEPTION 'PUSH_DEVICE_LIMIT'
        USING ERRCODE = 'P0001',
              DETAIL = 'Maximum 25 abonnements actifs pour le groupe.';
    END IF;
  END IF;

  RETURN QUERY
  INSERT INTO public.push_subscriptions (
    player_id,
    endpoint,
    endpoint_hash,
    p256dh,
    auth,
    content_encoding,
    expiration_time,
    status,
    user_agent,
    last_seen_at,
    failure_count,
    invalidated_at
  )
  VALUES (
    p_player_id,
    p_endpoint,
    v_hash,
    p_p256dh,
    p_auth,
    'aes128gcm',
    p_expiration_time,
    'active',
    v_ua,
    now(),
    0,
    NULL
  )
  ON CONFLICT (endpoint_hash) DO UPDATE
  SET
    player_id = EXCLUDED.player_id,
    endpoint = EXCLUDED.endpoint,
    p256dh = EXCLUDED.p256dh,
    auth = EXCLUDED.auth,
    content_encoding = 'aes128gcm',
    expiration_time = EXCLUDED.expiration_time,
    status = 'active',
    user_agent = COALESCE(EXCLUDED.user_agent, public.push_subscriptions.user_agent),
    last_seen_at = now(),
    failure_count = 0,
    invalidated_at = NULL,
    updated_at = now()
  RETURNING
    public.push_subscriptions.id,
    public.push_subscriptions.player_id,
    public.push_subscriptions.status,
    public.push_subscriptions.updated_at;
END;
$$;

CREATE OR REPLACE FUNCTION public.deactivate_push_subscription(
  p_access_code TEXT,
  p_endpoint TEXT
)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  v_hash BYTEA;
  v_updated INTEGER;
BEGIN
  PERFORM public.assert_access_code(p_access_code);
  PERFORM public.assert_push_endpoint(p_endpoint);

  v_hash := public.push_endpoint_hash(p_endpoint);

  UPDATE public.push_subscriptions AS s
  SET
    status = 'disabled',
    invalidated_at = now(),
    updated_at = now()
  WHERE s.endpoint_hash = v_hash
    AND s.status = 'active';

  GET DIAGNOSTICS v_updated = ROW_COUNT;
  RETURN v_updated > 0;
END;
$$;

CREATE OR REPLACE FUNCTION public.get_push_subscription_status(
  p_access_code TEXT,
  p_endpoint TEXT
)
RETURNS TABLE (
  active BOOLEAN,
  status TEXT,
  player_id UUID
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  v_hash BYTEA;
BEGIN
  PERFORM public.assert_access_code(p_access_code);
  PERFORM public.assert_push_endpoint(p_endpoint);

  v_hash := public.push_endpoint_hash(p_endpoint);

  RETURN QUERY
  SELECT
    (s.status = 'active') AS active,
    s.status,
    s.player_id
  FROM public.push_subscriptions AS s
  WHERE s.endpoint_hash = v_hash;
END;
$$;

GRANT EXECUTE ON FUNCTION public.register_push_subscription(
  TEXT, UUID, TEXT, TEXT, TEXT, TIMESTAMPTZ, TEXT
) TO anon, authenticated;

GRANT EXECUTE ON FUNCTION public.deactivate_push_subscription(TEXT, TEXT)
  TO anon, authenticated;

GRANT EXECUTE ON FUNCTION public.get_push_subscription_status(TEXT, TEXT)
  TO anon, authenticated;

-- ---------------------------------------------------------------------------
-- RPC job (service_role uniquement — pas d’accès anon)
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.prepare_push_reminder_batch(
  p_now TIMESTAMPTZ DEFAULT now()
)
RETURNS TABLE (
  reminders_created INTEGER,
  deliveries_created INTEGER
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_reminders INTEGER := 0;
  v_deliveries INTEGER := 0;
  v_ins INTEGER;
BEGIN
  -- Rappels 24 h : fenêtre [kickoff-24h, kickoff-23h] avec grâce 60 min
  -- ⇒ due dès kickoff-24h, jusqu’à kickoff-23h (grâce = 60 min après due).
  WITH candidates AS (
    SELECT
      m.id AS match_id,
      pl.id AS player_id,
      '24h'::text AS reminder_type,
      m.kickoff_at AS kickoff_snapshot,
      m.kickoff_at - interval '24 hours' AS due_at
    FROM public.matches AS m
    CROSS JOIN public.players AS pl
    WHERE m.status = 'scheduled'
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
  ),
  inserted AS (
    INSERT INTO public.push_reminders (
      match_id, player_id, reminder_type, kickoff_snapshot, due_at
    )
    SELECT
      c.match_id, c.player_id, c.reminder_type, c.kickoff_snapshot, c.due_at
    FROM candidates AS c
    ON CONFLICT (match_id, player_id, reminder_type) DO NOTHING
    RETURNING id, player_id
  )
  SELECT count(*)::integer INTO v_ins FROM inserted;
  v_reminders := v_reminders + COALESCE(v_ins, 0);

  WITH candidates AS (
    SELECT
      m.id AS match_id,
      pl.id AS player_id,
      '2h'::text AS reminder_type,
      m.kickoff_at AS kickoff_snapshot,
      m.kickoff_at - interval '2 hours' AS due_at
    FROM public.matches AS m
    CROSS JOIN public.players AS pl
    WHERE m.status = 'scheduled'
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
      )
  ),
  inserted AS (
    INSERT INTO public.push_reminders (
      match_id, player_id, reminder_type, kickoff_snapshot, due_at
    )
    SELECT
      c.match_id, c.player_id, c.reminder_type, c.kickoff_snapshot, c.due_at
    FROM candidates AS c
    ON CONFLICT (match_id, player_id, reminder_type) DO NOTHING
    RETURNING id
  )
  SELECT count(*)::integer INTO v_ins FROM inserted;
  v_reminders := v_reminders + COALESCE(v_ins, 0);

  WITH new_deliveries AS (
    INSERT INTO public.push_deliveries (reminder_id, subscription_id, status)
    SELECT r.id, s.id, 'pending'
    FROM public.push_reminders AS r
    INNER JOIN public.push_subscriptions AS s
      ON s.player_id = r.player_id
     AND s.status = 'active'
    WHERE r.due_at <= p_now
      AND r.kickoff_snapshot > p_now
    ON CONFLICT (reminder_id, subscription_id) DO NOTHING
    RETURNING id
  )
  SELECT count(*)::integer INTO v_deliveries FROM new_deliveries;

  reminders_created := v_reminders;
  deliveries_created := COALESCE(v_deliveries, 0);
  RETURN NEXT;
END;
$$;

CREATE OR REPLACE FUNCTION public.claim_push_deliveries(
  p_limit INTEGER DEFAULT 50,
  p_lease_seconds INTEGER DEFAULT 120,
  p_now TIMESTAMPTZ DEFAULT now()
)
RETURNS TABLE (
  delivery_id UUID,
  reminder_id UUID,
  subscription_id UUID,
  match_id UUID,
  player_id UUID,
  reminder_type TEXT,
  home_team TEXT,
  away_team TEXT,
  kickoff_at TIMESTAMPTZ,
  endpoint TEXT,
  p256dh TEXT,
  auth TEXT,
  content_encoding TEXT
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_limit INTEGER := GREATEST(1, LEAST(COALESCE(p_limit, 50), 100));
  v_lease INTEGER := GREATEST(30, LEAST(COALESCE(p_lease_seconds, 120), 600));
BEGIN
  RETURN QUERY
  WITH candidates AS (
    SELECT d.id
    FROM public.push_deliveries AS d
    INNER JOIN public.push_reminders AS r ON r.id = d.reminder_id
    INNER JOIN public.matches AS m ON m.id = r.match_id
    INNER JOIN public.push_subscriptions AS s ON s.id = d.subscription_id
    INNER JOIN public.players AS pl ON pl.id = r.player_id
    WHERE d.status IN ('pending', 'failed')
      AND (d.next_attempt_at IS NULL OR d.next_attempt_at <= p_now)
      AND (d.lease_until IS NULL OR d.lease_until < p_now)
      AND d.attempt_count < 5
      AND s.status = 'active'
      AND pl.is_active = TRUE
      AND m.status = 'scheduled'
      AND m.kickoff_at > p_now
      AND NOT EXISTS (
        SELECT 1
        FROM public.predictions AS pr
        WHERE pr.player_id = r.player_id
          AND pr.match_id = r.match_id
      )
    ORDER BY d.created_at ASC
    LIMIT v_limit
    FOR UPDATE OF d SKIP LOCKED
  ),
  claimed AS (
    UPDATE public.push_deliveries AS d
    SET
      status = 'processing',
      claimed_at = p_now,
      lease_until = p_now + make_interval(secs => v_lease),
      attempt_count = d.attempt_count + 1,
      updated_at = p_now
    FROM candidates AS c
    WHERE d.id = c.id
    RETURNING d.id
  )
  SELECT
    d.id AS delivery_id,
    r.id AS reminder_id,
    s.id AS subscription_id,
    m.id AS match_id,
    r.player_id,
    r.reminder_type,
    m.home_team,
    m.away_team,
    m.kickoff_at,
    s.endpoint,
    s.p256dh,
    s.auth,
    s.content_encoding
  FROM claimed AS c
  INNER JOIN public.push_deliveries AS d ON d.id = c.id
  INNER JOIN public.push_reminders AS r ON r.id = d.reminder_id
  INNER JOIN public.matches AS m ON m.id = r.match_id
  INNER JOIN public.push_subscriptions AS s ON s.id = d.subscription_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.complete_push_delivery(
  p_delivery_id UUID,
  p_outcome TEXT,
  p_response_status INTEGER DEFAULT NULL,
  p_now TIMESTAMPTZ DEFAULT now()
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_sub_id UUID;
BEGIN
  IF p_outcome NOT IN ('sent', 'failed', 'expired', 'skipped') THEN
    RAISE EXCEPTION 'INVALID_INPUT'
      USING ERRCODE = '22023',
            DETAIL = 'Outcome de livraison invalide.';
  END IF;

  SELECT d.subscription_id INTO v_sub_id
  FROM public.push_deliveries AS d
  WHERE d.id = p_delivery_id
  FOR UPDATE;

  IF v_sub_id IS NULL THEN
    RETURN;
  END IF;

  IF p_outcome = 'sent' THEN
    UPDATE public.push_deliveries AS d
    SET
      status = 'sent',
      response_status = p_response_status,
      sent_at = p_now,
      lease_until = NULL,
      next_attempt_at = NULL,
      updated_at = p_now
    WHERE d.id = p_delivery_id;

    UPDATE public.push_subscriptions AS s
    SET
      last_success_at = p_now,
      failure_count = 0,
      updated_at = p_now
    WHERE s.id = v_sub_id;

  ELSIF p_outcome = 'skipped' THEN
    UPDATE public.push_deliveries AS d
    SET
      status = 'skipped',
      response_status = p_response_status,
      lease_until = NULL,
      next_attempt_at = NULL,
      updated_at = p_now
    WHERE d.id = p_delivery_id;

  ELSIF p_outcome = 'expired' THEN
    UPDATE public.push_deliveries AS d
    SET
      status = 'expired',
      response_status = p_response_status,
      lease_until = NULL,
      next_attempt_at = NULL,
      updated_at = p_now
    WHERE d.id = p_delivery_id;

    UPDATE public.push_subscriptions AS s
    SET
      status = 'expired',
      invalidated_at = p_now,
      failure_count = s.failure_count + 1,
      updated_at = p_now
    WHERE s.id = v_sub_id;

  ELSE
    -- failed : retry borné, sauf timeout ambigu (pas de next_attempt si status NULL)
    UPDATE public.push_deliveries AS d
    SET
      status = 'failed',
      response_status = p_response_status,
      lease_until = NULL,
      next_attempt_at = CASE
        WHEN p_response_status IS NULL THEN NULL
        WHEN p_response_status IN (429) OR p_response_status >= 500
          THEN p_now + interval '15 minutes'
        ELSE NULL
      END,
      updated_at = p_now
    WHERE d.id = p_delivery_id;

    UPDATE public.push_subscriptions AS s
    SET
      failure_count = s.failure_count + 1,
      updated_at = p_now
    WHERE s.id = v_sub_id;
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION public.is_push_sending_enabled()
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_value TEXT;
BEGIN
  SELECT s.value INTO v_value
  FROM public.app_settings AS s
  WHERE s.key = 'push_sending_enabled';

  RETURN lower(trim(COALESCE(v_value, 'false'))) IN ('true', '1', 'yes');
END;
$$;

REVOKE ALL ON FUNCTION public.prepare_push_reminder_batch(TIMESTAMPTZ)
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.claim_push_deliveries(INTEGER, INTEGER, TIMESTAMPTZ)
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.complete_push_delivery(UUID, TEXT, INTEGER, TIMESTAMPTZ)
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.is_push_sending_enabled()
  FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.player_has_prediction(
  p_player_id UUID,
  p_match_id UUID
)
RETURNS BOOLEAN
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
STABLE
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.predictions AS pr
    WHERE pr.player_id = p_player_id
      AND pr.match_id = p_match_id
  );
$$;

REVOKE ALL ON FUNCTION public.player_has_prediction(UUID, UUID)
  FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.prepare_push_reminder_batch(TIMESTAMPTZ)
  TO service_role;
GRANT EXECUTE ON FUNCTION public.claim_push_deliveries(INTEGER, INTEGER, TIMESTAMPTZ)
  TO service_role;
GRANT EXECUTE ON FUNCTION public.complete_push_delivery(UUID, TEXT, INTEGER, TIMESTAMPTZ)
  TO service_role;
GRANT EXECUTE ON FUNCTION public.is_push_sending_enabled()
  TO service_role;
GRANT EXECUTE ON FUNCTION public.player_has_prediction(UUID, UUID)
  TO service_role;

-- Accès table pour diagnostics service_role (RLS bypass déjà actif).
GRANT SELECT, UPDATE ON TABLE public.push_subscriptions TO service_role;
GRANT SELECT, INSERT ON TABLE public.push_reminders TO service_role;
GRANT SELECT, UPDATE ON TABLE public.push_deliveries TO service_role;
GRANT SELECT ON TABLE public.predictions TO service_role;
GRANT SELECT ON TABLE public.matches TO service_role;
GRANT SELECT ON TABLE public.players TO service_role;
GRANT SELECT ON TABLE public.app_settings TO service_role;
