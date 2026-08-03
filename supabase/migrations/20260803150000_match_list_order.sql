-- À la Nantaise — ordre déterministe des listes de matchs
-- round_number ASC, kickoff_at ASC, id ASC
-- Ne touche pas aux contrôles d’accès ni aux grants.

CREATE OR REPLACE FUNCTION public.get_matches(p_access_code TEXT)
RETURNS TABLE (
  id UUID,
  external_id TEXT,
  round_number INTEGER,
  home_team TEXT,
  away_team TEXT,
  kickoff_at TIMESTAMPTZ,
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
  PERFORM public.assert_access_code(p_access_code);

  RETURN QUERY
  SELECT
    m.id,
    m.external_id,
    m.round_number,
    m.home_team,
    m.away_team,
    m.kickoff_at,
    m.status,
    m.home_score,
    m.away_score,
    m.created_at,
    m.updated_at
  FROM public.matches AS m
  ORDER BY m.round_number ASC, m.kickoff_at ASC, m.id ASC;
END;
$$;

CREATE OR REPLACE FUNCTION public.admin_get_matches(p_admin_code TEXT)
RETURNS TABLE (
  id UUID,
  external_id TEXT,
  round_number INTEGER,
  home_team TEXT,
  away_team TEXT,
  kickoff_at TIMESTAMPTZ,
  status TEXT,
  home_score INTEGER,
  away_score INTEGER,
  created_at TIMESTAMPTZ,
  updated_at TIMESTAMPTZ,
  source TEXT,
  last_synced_at TIMESTAMPTZ,
  manual_override BOOLEAN,
  source_home_team TEXT,
  source_away_team TEXT,
  source_kickoff_at TIMESTAMPTZ,
  source_home_score INTEGER,
  source_away_score INTEGER,
  source_status TEXT
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
BEGIN
  PERFORM public.assert_admin_code(p_admin_code);

  RETURN QUERY
  SELECT
    m.id,
    m.external_id,
    m.round_number,
    m.home_team,
    m.away_team,
    m.kickoff_at,
    m.status,
    m.home_score,
    m.away_score,
    m.created_at,
    m.updated_at,
    m.source,
    m.last_synced_at,
    m.manual_override,
    m.source_home_team,
    m.source_away_team,
    m.source_kickoff_at,
    m.source_home_score,
    m.source_away_score,
    m.source_status
  FROM public.matches AS m
  ORDER BY m.round_number ASC, m.kickoff_at ASC, m.id ASC;
END;
$$;

REVOKE ALL ON FUNCTION public.get_matches(TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.admin_get_matches(TEXT) FROM PUBLIC;

GRANT EXECUTE ON FUNCTION public.get_matches(TEXT) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.admin_get_matches(TEXT) TO anon, authenticated;
