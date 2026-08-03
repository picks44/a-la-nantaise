-- Harden Web Push before smoke tests (additive; does not touch 170000 file).
-- - Shared eligibility helper + read-only preview for dry_run
-- - Claim reclaim for expired processing leases
-- - Lease default 5 minutes ; max 3 attempts
-- - REVOKE EXECUTE … FROM PUBLIC on frontend subscription RPCs
-- Does NOT enable push_sending_enabled or create Cron.

-- ---------------------------------------------------------------------------
-- Eligibility helper (STABLE, no writes) — shared by prepare + preview
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

-- ---------------------------------------------------------------------------
-- prepare_push_reminder_batch — same writes, uses eligibility helper
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
  WITH inserted AS (
    INSERT INTO public.push_reminders (
      match_id, player_id, reminder_type, kickoff_snapshot, due_at
    )
    SELECT
      e.match_id, e.player_id, e.reminder_type, e.kickoff_snapshot, e.due_at
    FROM public.push_reminder_eligibility(p_now) AS e
    ON CONFLICT (match_id, player_id, reminder_type) DO NOTHING
    RETURNING id
  )
  SELECT count(*)::integer INTO v_ins FROM inserted;
  v_reminders := COALESCE(v_ins, 0);

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

-- ---------------------------------------------------------------------------
-- preview_push_reminder_batch — read-only dry_run (no writes)
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.preview_push_reminder_batch(
  p_now TIMESTAMPTZ DEFAULT now()
)
RETURNS TABLE (
  candidates_24h INTEGER,
  candidates_2h INTEGER,
  candidate_deliveries INTEGER
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  RETURN QUERY
  SELECT
    (
      SELECT count(*)::integer
      FROM public.push_reminder_eligibility(p_now) AS e
      WHERE e.reminder_type = '24h'
    ) AS candidates_24h,
    (
      SELECT count(*)::integer
      FROM public.push_reminder_eligibility(p_now) AS e
      WHERE e.reminder_type = '2h'
    ) AS candidates_2h,
    (
      SELECT count(*)::integer
      FROM public.push_reminder_eligibility(p_now) AS e
      INNER JOIN public.push_subscriptions AS s
        ON s.player_id = e.player_id
       AND s.status = 'active'
    ) AS candidate_deliveries;
END;
$$;

REVOKE ALL ON FUNCTION public.preview_push_reminder_batch(TIMESTAMPTZ)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.preview_push_reminder_batch(TIMESTAMPTZ)
  TO service_role;

-- ---------------------------------------------------------------------------
-- claim_push_deliveries — reclaim expired processing ; lease 300s ; max 3
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.claim_push_deliveries(
  p_limit INTEGER DEFAULT 50,
  p_lease_seconds INTEGER DEFAULT 300,
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
  v_lease INTEGER := GREATEST(30, LEAST(COALESCE(p_lease_seconds, 300), 600));
BEGIN
  -- attempt_count: incremented on each successful claim (including reclaim after
  -- expired lease). Max 3 claims → attempt_count < 3. Dry-run never claims.
  RETURN QUERY
  WITH candidates AS (
    SELECT d.id
    FROM public.push_deliveries AS d
    INNER JOIN public.push_reminders AS r ON r.id = d.reminder_id
    INNER JOIN public.matches AS m ON m.id = r.match_id
    INNER JOIN public.push_subscriptions AS s ON s.id = d.subscription_id
    INNER JOIN public.players AS pl ON pl.id = r.player_id
    WHERE (
        (
          d.status IN ('pending', 'failed')
          AND (d.next_attempt_at IS NULL OR d.next_attempt_at <= p_now)
        )
        OR (
          d.status = 'processing'
          AND d.lease_until IS NOT NULL
          AND d.lease_until < p_now
        )
      )
      AND d.attempt_count < 3
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

-- Re-assert job RPC privileges (idempotent)
REVOKE ALL ON FUNCTION public.prepare_push_reminder_batch(TIMESTAMPTZ)
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.claim_push_deliveries(INTEGER, INTEGER, TIMESTAMPTZ)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.prepare_push_reminder_batch(TIMESTAMPTZ)
  TO service_role;
GRANT EXECUTE ON FUNCTION public.claim_push_deliveries(INTEGER, INTEGER, TIMESTAMPTZ)
  TO service_role;

-- ---------------------------------------------------------------------------
-- Frontend subscription RPCs: revoke PUBLIC, keep anon + authenticated
-- ---------------------------------------------------------------------------

REVOKE ALL ON FUNCTION public.register_push_subscription(
  TEXT, UUID, TEXT, TEXT, TEXT, TIMESTAMPTZ, TEXT
) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.deactivate_push_subscription(TEXT, TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.get_push_subscription_status(TEXT, TEXT) FROM PUBLIC;

GRANT EXECUTE ON FUNCTION public.register_push_subscription(
  TEXT, UUID, TEXT, TEXT, TEXT, TIMESTAMPTZ, TEXT
) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.deactivate_push_subscription(TEXT, TEXT)
  TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_push_subscription_status(TEXT, TEXT)
  TO anon, authenticated;
