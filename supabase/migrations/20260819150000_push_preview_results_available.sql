-- Preview / dry-run : exposer results_available comme prepare.

DROP FUNCTION IF EXISTS public.preview_push_reminder_batch(TIMESTAMPTZ);

CREATE OR REPLACE FUNCTION public.preview_push_reminder_batch(
  p_now TIMESTAMPTZ DEFAULT now()
)
RETURNS TABLE (
  candidates_24h INTEGER,
  candidates_2h INTEGER,
  candidates_kickoff_5m INTEGER,
  candidates_results_available INTEGER,
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
  pending_results AS (
    SELECT r.id, r.match_id, r.player_id, r.kickoff_snapshot, r.due_at
    FROM public.push_reminders AS r
    INNER JOIN public.matches AS m ON m.id = r.match_id
    WHERE r.reminder_type = 'results_available'
      AND r.due_at <= p_now
      AND m.status = 'finished'
      AND m.home_score IS NOT NULL
      AND m.away_score IS NOT NULL
      AND EXISTS (
        SELECT 1
        FROM public.push_subscriptions AS s
        WHERE s.player_id = r.player_id
          AND s.status = 'active'
          AND NOT EXISTS (
            SELECT 1
            FROM public.push_deliveries AS d
            WHERE d.reminder_id = r.id
              AND d.subscription_id = s.id
          )
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
      FROM pending_results
    ) AS candidates_results_available,
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

REVOKE ALL ON FUNCTION public.preview_push_reminder_batch(TIMESTAMPTZ)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.preview_push_reminder_batch(TIMESTAMPTZ)
  TO service_role;
