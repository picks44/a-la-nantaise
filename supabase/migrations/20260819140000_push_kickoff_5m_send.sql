-- Phase 3 kickoff_5m : prepare / preview / claim + recalage kickoff (skip stale deliveries).

DROP FUNCTION IF EXISTS public.preview_push_reminder_batch(TIMESTAMPTZ);

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
  -- Étape 0 : invalider les deliveries stale avant recalage du reminder.
  UPDATE public.push_deliveries AS d
  SET
    status = 'skipped',
    lease_until = NULL,
    next_attempt_at = NULL,
    updated_at = p_now
  FROM public.push_reminders AS r
  INNER JOIN public.push_reminder_eligibility(p_now) AS e
    ON e.match_id = r.match_id
   AND e.player_id = r.player_id
   AND e.reminder_type = 'kickoff_5m'
  WHERE d.reminder_id = r.id
    AND r.reminder_type = 'kickoff_5m'
    AND d.status IN ('pending', 'failed')
    AND (
      r.kickoff_snapshot IS DISTINCT FROM e.kickoff_snapshot
      OR r.due_at IS DISTINCT FROM e.due_at
    )
    AND NOT EXISTS (
      SELECT 1
      FROM public.push_deliveries AS d2
      WHERE d2.reminder_id = r.id
        AND d2.status = 'sent'
    );

  WITH inserted AS (
    INSERT INTO public.push_reminders (
      match_id, player_id, reminder_type, kickoff_snapshot, due_at
    )
    SELECT
      e.match_id, e.player_id, e.reminder_type, e.kickoff_snapshot, e.due_at
    FROM public.push_reminder_eligibility(p_now) AS e
    ON CONFLICT (match_id, player_id, reminder_type) DO UPDATE SET
      kickoff_snapshot = EXCLUDED.kickoff_snapshot,
      due_at = EXCLUDED.due_at
    WHERE push_reminders.reminder_type = 'kickoff_5m'
      AND NOT EXISTS (
        SELECT 1
        FROM public.push_deliveries AS d
        WHERE d.reminder_id = push_reminders.id
          AND d.status = 'sent'
      )
      AND (
        push_reminders.kickoff_snapshot IS DISTINCT FROM EXCLUDED.kickoff_snapshot
        OR push_reminders.due_at IS DISTINCT FROM EXCLUDED.due_at
      )
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
    LEFT JOIN public.matches AS m ON m.id = r.match_id
    WHERE r.due_at <= p_now
      AND (
        (
          r.reminder_type IN ('24h', '2h')
          AND r.kickoff_snapshot > p_now
        )
        OR (
          r.reminder_type = 'results_available'
          AND m.status = 'finished'
          AND m.home_score IS NOT NULL
          AND m.away_score IS NOT NULL
        )
        OR (
          r.reminder_type = 'kickoff_5m'
          AND r.kickoff_snapshot > p_now
          AND m.id IS NOT NULL
          AND m.status = 'scheduled'
          AND m.kickoff_time_confirmed IS TRUE
          AND r.kickoff_snapshot = m.kickoff_at
        )
      )
    ON CONFLICT (reminder_id, subscription_id) DO UPDATE SET
      status = 'pending',
      lease_until = NULL,
      next_attempt_at = NULL,
      attempt_count = 0,
      updated_at = p_now
    WHERE EXISTS (
      SELECT 1
      FROM public.push_reminders AS r2
      WHERE r2.id = push_deliveries.reminder_id
        AND r2.reminder_type = 'kickoff_5m'
    )
    AND push_deliveries.status = 'skipped'
    RETURNING id
  )
  SELECT count(*)::integer INTO v_deliveries FROM new_deliveries;

  reminders_created := v_reminders;
  deliveries_created := COALESCE(v_deliveries, 0);
  RETURN NEXT;
END;
$$;

CREATE OR REPLACE FUNCTION public.preview_push_reminder_batch(
  p_now TIMESTAMPTZ DEFAULT now()
)
RETURNS TABLE (
  candidates_24h INTEGER,
  candidates_2h INTEGER,
  candidates_kickoff_5m INTEGER,
  candidate_deliveries INTEGER
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  RETURN QUERY
  WITH new_reminders AS (
    SELECT e.match_id, e.player_id, e.reminder_type, e.kickoff_snapshot, e.due_at
    FROM public.push_reminder_eligibility(p_now) AS e
    WHERE NOT EXISTS (
      SELECT 1
      FROM public.push_reminders AS r
      WHERE r.match_id = e.match_id
        AND r.player_id = e.player_id
        AND r.reminder_type = e.reminder_type
    )
  ),
  delivery_sources AS (
    SELECT r.id AS reminder_id, r.player_id
    FROM public.push_reminders AS r
    INNER JOIN public.matches AS m ON m.id = r.match_id
    WHERE r.due_at <= p_now
      AND (
        (
          r.reminder_type IN ('24h', '2h')
          AND r.kickoff_snapshot > p_now
        )
        OR (
          r.reminder_type = 'results_available'
          AND m.status = 'finished'
          AND m.home_score IS NOT NULL
          AND m.away_score IS NOT NULL
        )
        OR (
          r.reminder_type = 'kickoff_5m'
          AND r.kickoff_snapshot > p_now
          AND m.status = 'scheduled'
          AND m.kickoff_time_confirmed IS TRUE
          AND r.kickoff_snapshot = m.kickoff_at
        )
      )
    UNION ALL
    SELECT NULL::uuid AS reminder_id, n.player_id
    FROM new_reminders AS n
    WHERE n.due_at <= p_now
      AND n.kickoff_snapshot > p_now
  )
  SELECT
    (
      SELECT count(*)::integer
      FROM new_reminders AS n
      WHERE n.reminder_type = '24h'
    ) AS candidates_24h,
    (
      SELECT count(*)::integer
      FROM new_reminders AS n
      WHERE n.reminder_type = '2h'
    ) AS candidates_2h,
    (
      SELECT count(*)::integer
      FROM new_reminders AS n
      WHERE n.reminder_type = 'kickoff_5m'
    ) AS candidates_kickoff_5m,
    (
      SELECT count(*)::integer
      FROM delivery_sources AS src
      INNER JOIN public.push_subscriptions AS s
        ON s.player_id = src.player_id
       AND s.status = 'active'
      WHERE src.reminder_id IS NULL
         OR NOT EXISTS (
           SELECT 1
           FROM public.push_deliveries AS d
           WHERE d.reminder_id = src.reminder_id
             AND d.subscription_id = s.id
         )
    ) AS candidate_deliveries;
END;
$$;

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
      AND (
        (
          r.reminder_type IN ('24h', '2h')
          AND m.status = 'scheduled'
          AND m.kickoff_at > p_now
          AND NOT EXISTS (
            SELECT 1
            FROM public.predictions AS pr
            WHERE pr.player_id = r.player_id
              AND pr.match_id = r.match_id
          )
        )
        OR (
          r.reminder_type = 'results_available'
          AND m.status = 'finished'
          AND m.home_score IS NOT NULL
          AND m.away_score IS NOT NULL
        )
        OR (
          r.reminder_type = 'kickoff_5m'
          AND m.status = 'scheduled'
          AND m.kickoff_time_confirmed IS TRUE
          AND m.kickoff_at > p_now
          AND r.kickoff_snapshot = m.kickoff_at
        )
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

REVOKE ALL ON FUNCTION public.prepare_push_reminder_batch(TIMESTAMPTZ)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.prepare_push_reminder_batch(TIMESTAMPTZ)
  TO service_role;

REVOKE ALL ON FUNCTION public.preview_push_reminder_batch(TIMESTAMPTZ)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.preview_push_reminder_batch(TIMESTAMPTZ)
  TO service_role;

REVOKE ALL ON FUNCTION public.claim_push_deliveries(INTEGER, INTEGER, TIMESTAMPTZ)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.claim_push_deliveries(INTEGER, INTEGER, TIMESTAMPTZ)
  TO service_role;
