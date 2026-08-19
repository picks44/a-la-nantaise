-- Phase 3 kickoff_5m : CHECK + eligibility (création anticipée, sans filtre prono).

DO $$
DECLARE
  v_name TEXT;
BEGIN
  SELECT c.conname
  INTO v_name
  FROM pg_constraint AS c
  INNER JOIN pg_class AS rel ON rel.oid = c.conrelid
  INNER JOIN pg_namespace AS nsp ON nsp.oid = rel.relnamespace
  WHERE nsp.nspname = 'public'
    AND rel.relname = 'push_reminders'
    AND c.contype = 'c'
    AND pg_get_constraintdef(c.oid) LIKE '%reminder_type%'
    AND pg_get_constraintdef(c.oid) LIKE '%24h%';

  IF v_name IS NOT NULL THEN
    EXECUTE format(
      'ALTER TABLE public.push_reminders DROP CONSTRAINT %I',
      v_name
    );
  END IF;
END;
$$;

ALTER TABLE public.push_reminders
  ADD CONSTRAINT push_reminders_reminder_type_check
  CHECK (reminder_type IN ('24h', '2h', 'results_available', 'kickoff_5m'));

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
    )

  UNION ALL

  SELECT
    m.id AS match_id,
    pl.id AS player_id,
    'kickoff_5m'::text AS reminder_type,
    m.kickoff_at AS kickoff_snapshot,
    m.kickoff_at - interval '5 minutes' AS due_at
  FROM public.matches AS m
  CROSS JOIN public.players AS pl
  WHERE m.status = 'scheduled'
    AND m.kickoff_time_confirmed IS TRUE
    AND m.kickoff_at > p_now
    AND pl.is_active = TRUE
    AND EXISTS (
      SELECT 1
      FROM public.push_subscriptions AS s
      WHERE s.player_id = pl.id
        AND s.status = 'active'
    );
$$;

REVOKE ALL ON FUNCTION public.push_reminder_eligibility(TIMESTAMPTZ)
  FROM PUBLIC, anon, authenticated;
