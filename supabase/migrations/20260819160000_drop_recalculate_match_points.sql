-- Retrait de la RPC publique legacy recalculate_match_points(access_code, match_id).
--
-- Audit (repo) :
--   - aucun appel dans src/, scripts/, supabase/functions/
--   - le frontend n’expose plus recalculateMatchPoints (dead-api-surface)
--   - le scoring runtime passe par public.recalculate_points_for_match(uuid)
--     (SECURITY DEFINER interne, pas de GRANT anon)
--   - GRANT EXECUTE restait à anon/authenticated depuis init + 165000
--
-- Ne pas recréer cette signature.

DROP FUNCTION IF EXISTS public.recalculate_match_points(TEXT, UUID);
