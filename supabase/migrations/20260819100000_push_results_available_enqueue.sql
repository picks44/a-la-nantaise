-- Enqueue logique post-match : reminder_type results_available.
-- Aucun envoi Push. Aucune delivery. Aucun changement du moteur claim/prepare.

-- kickoff_snapshot est NOT NULL. matches.kickoff_at l'est aussi
-- (20260803100000_init.sql) : pas de fallback.

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
  CHECK (reminder_type IN ('24h', '2h', 'results_available'));

CREATE OR REPLACE FUNCTION public.recalculate_points_for_match(p_match_id UUID)
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  match_row public.matches%ROWTYPE;
  updated_count INTEGER := 0;
BEGIN
  IF p_match_id IS NULL THEN
    RAISE EXCEPTION 'MATCH_NOT_FOUND'
      USING ERRCODE = 'P0002',
            DETAIL = 'Identifiant de match manquant.';
  END IF;

  SELECT m.*
  INTO match_row
  FROM public.matches AS m
  WHERE m.id = p_match_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'MATCH_NOT_FOUND'
      USING ERRCODE = 'P0002',
            DETAIL = 'Match introuvable.';
  END IF;

  IF match_row.status = 'finished'
     AND match_row.home_score IS NOT NULL
     AND match_row.away_score IS NOT NULL
  THEN
    UPDATE public.predictions AS pr
    SET
      points = public.compute_prediction_points(
        pr.predicted_home_score,
        pr.predicted_away_score,
        match_row.home_score,
        match_row.away_score
      ),
      updated_at = now()
    WHERE pr.match_id = p_match_id;
  ELSE
    UPDATE public.predictions AS pr
    SET
      points = NULL,
      updated_at = now()
    WHERE pr.match_id = p_match_id;
  END IF;

  GET DIAGNOSTICS updated_count = ROW_COUNT;

  PERFORM public.recalculate_season_achievements(match_row.season_id);

  IF match_row.status = 'finished'
     AND match_row.home_score IS NOT NULL
     AND match_row.away_score IS NOT NULL
  THEN
    INSERT INTO public.push_reminders (
      match_id,
      player_id,
      reminder_type,
      kickoff_snapshot,
      due_at
    )
    SELECT
      match_row.id,
      pl.id,
      'results_available',
      match_row.kickoff_at,
      now()
    FROM public.players AS pl
    WHERE pl.is_active = TRUE
      AND EXISTS (
        SELECT 1
        FROM public.push_subscriptions AS s
        WHERE s.player_id = pl.id
          AND s.status = 'active'
      )
    ON CONFLICT (match_id, player_id, reminder_type) DO NOTHING;
  END IF;

  RETURN updated_count;
END;
$$;
