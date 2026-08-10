-- Prédicat : une sync résultat Fixture Download est-elle utile maintenant ?
-- Utilisé par le cron conditionnel (pg_cron). Pas de SECURITY DEFINER :
-- le job cron s’exécute avec un rôle capable de lire public.matches.
--
-- Règle (TIMESTAMPTZ / now() uniquement — pas d’heure locale Paris) :
--   kickoff confirmé
--   + status non terminal
--   + now() >= kickoff_at + 105 minutes
--   + now() <= kickoff_at + 8 hours

CREATE OR REPLACE FUNCTION public.fixture_result_sync_is_needed()
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.matches AS m
    WHERE m.kickoff_time_confirmed = TRUE
      AND m.status NOT IN ('finished', 'postponed', 'cancelled')
      AND now() >= m.kickoff_at + interval '105 minutes'
      AND now() <= m.kickoff_at + interval '8 hours'
  );
$$;

COMMENT ON FUNCTION public.fixture_result_sync_is_needed() IS
  'True when at least one confirmed match is in the post-kickoff result window '
  '(+105min .. +8h) and not finished/postponed/cancelled.';

REVOKE ALL ON FUNCTION public.fixture_result_sync_is_needed() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.fixture_result_sync_is_needed() FROM anon, authenticated;
