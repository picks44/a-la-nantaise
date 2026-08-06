-- register_push_subscription: endpoint lookup / upsert before device-limit check.
-- Same endpoint (any status) never consumes a new device slot.
-- Limit applies only to endpoints that are truly new.

CREATE OR REPLACE FUNCTION public.register_push_subscription(
  p_session_token TEXT,
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
  v_player_id UUID;
  v_hash BYTEA;
  v_existing_id UUID;
  v_active_for_player INTEGER;
  v_active_total INTEGER;
  v_ua TEXT;
BEGIN
  v_player_id := public.assert_player_session(p_session_token);
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

  SELECT s.id
  INTO v_existing_id
  FROM public.push_subscriptions AS s
  WHERE s.endpoint_hash = v_hash;

  -- Known endpoint (same or other player): upsert / reactivate without counting
  -- as a new device. Existing métier rule reassigns player_id on conflict.
  IF v_existing_id IS NULL THEN
    SELECT count(*)::integer INTO v_active_for_player
    FROM public.push_subscriptions AS s
    WHERE s.player_id = v_player_id
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
    v_player_id,
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

REVOKE ALL ON FUNCTION public.register_push_subscription(TEXT, TEXT, TEXT, TEXT, TIMESTAMPTZ, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.register_push_subscription(TEXT, TEXT, TEXT, TEXT, TIMESTAMPTZ, TEXT)
  TO anon, authenticated;
