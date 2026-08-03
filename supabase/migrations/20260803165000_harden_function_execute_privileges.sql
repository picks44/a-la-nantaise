-- Harden EXECUTE privileges on application RPCs and internal helpers.
-- No function body changes. Idempotent REVOKE/GRANT for final signatures
-- after 20260803100000..20260803160000 (before web_push 170000).


-- Final privilege matrix (30 functions)

-- Helpers / internes : aucun EXECUTE pour PUBLIC / anon / authenticated
REVOKE ALL ON FUNCTION public.set_updated_at() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.set_updated_at() FROM anon, authenticated;
REVOKE ALL ON FUNCTION public.assert_access_code(TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.assert_access_code(TEXT) FROM anon, authenticated;
REVOKE ALL ON FUNCTION public.compute_prediction_points(INTEGER, INTEGER, INTEGER, INTEGER) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.compute_prediction_points(INTEGER, INTEGER, INTEGER, INTEGER) FROM anon, authenticated;
REVOKE ALL ON FUNCTION public.assert_admin_code(TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.assert_admin_code(TEXT) FROM anon, authenticated;
REVOKE ALL ON FUNCTION public.normalize_player_name(TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.normalize_player_name(TEXT) FROM anon, authenticated;
REVOKE ALL ON FUNCTION public.assert_nantes_fixture(TEXT, TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.assert_nantes_fixture(TEXT, TEXT) FROM anon, authenticated;
REVOKE ALL ON FUNCTION public.assert_match_scores(TEXT, INTEGER, INTEGER) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.assert_match_scores(TEXT, INTEGER, INTEGER) FROM anon, authenticated;
REVOKE ALL ON FUNCTION public.recalculate_points_for_match(UUID) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.recalculate_points_for_match(UUID) FROM anon, authenticated;

-- RPC applicatives : PUBLIC interdit ; anon + authenticated uniquement
REVOKE ALL ON FUNCTION public.verify_access_code(TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.verify_access_code(TEXT) TO anon, authenticated;
REVOKE ALL ON FUNCTION public.get_active_players(TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_active_players(TEXT) TO anon, authenticated;
REVOKE ALL ON FUNCTION public.get_matches(TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_matches(TEXT) TO anon, authenticated;
REVOKE ALL ON FUNCTION public.get_my_predictions(TEXT, UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_my_predictions(TEXT, UUID) TO anon, authenticated;
REVOKE ALL ON FUNCTION public.upsert_prediction(TEXT, UUID, UUID, INTEGER, INTEGER) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.upsert_prediction(TEXT, UUID, UUID, INTEGER, INTEGER) TO anon, authenticated;
REVOKE ALL ON FUNCTION public.get_visible_predictions(TEXT, UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_visible_predictions(TEXT, UUID) TO anon, authenticated;
REVOKE ALL ON FUNCTION public.get_ranking(TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_ranking(TEXT) TO anon, authenticated;
REVOKE ALL ON FUNCTION public.recalculate_match_points(TEXT, UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.recalculate_match_points(TEXT, UUID) TO anon, authenticated;
REVOKE ALL ON FUNCTION public.verify_admin_code(TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.verify_admin_code(TEXT) TO anon, authenticated;
REVOKE ALL ON FUNCTION public.admin_get_players(TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.admin_get_players(TEXT) TO anon, authenticated;
REVOKE ALL ON FUNCTION public.admin_create_player(TEXT, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.admin_create_player(TEXT, TEXT) TO anon, authenticated;
REVOKE ALL ON FUNCTION public.admin_update_player_name(TEXT, UUID, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.admin_update_player_name(TEXT, UUID, TEXT) TO anon, authenticated;
REVOKE ALL ON FUNCTION public.admin_set_player_active(TEXT, UUID, BOOLEAN) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.admin_set_player_active(TEXT, UUID, BOOLEAN) TO anon, authenticated;
REVOKE ALL ON FUNCTION public.admin_get_matches(TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.admin_get_matches(TEXT) TO anon, authenticated;
REVOKE ALL ON FUNCTION public.admin_create_match(TEXT, INTEGER, TEXT, TEXT, TIMESTAMPTZ, TEXT, INTEGER, INTEGER, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.admin_create_match(TEXT, INTEGER, TEXT, TEXT, TIMESTAMPTZ, TEXT, INTEGER, INTEGER, TEXT) TO anon, authenticated;
REVOKE ALL ON FUNCTION public.admin_update_match(TEXT, UUID, INTEGER, TEXT, TEXT, TIMESTAMPTZ, TEXT, INTEGER, INTEGER, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.admin_update_match(TEXT, UUID, INTEGER, TEXT, TEXT, TIMESTAMPTZ, TEXT, INTEGER, INTEGER, TEXT) TO anon, authenticated;
REVOKE ALL ON FUNCTION public.admin_set_match_result(TEXT, UUID, INTEGER, INTEGER) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.admin_set_match_result(TEXT, UUID, INTEGER, INTEGER) TO anon, authenticated;
REVOKE ALL ON FUNCTION public.admin_get_stats(TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.admin_get_stats(TEXT) TO anon, authenticated;
REVOKE ALL ON FUNCTION public.admin_clear_match_override(TEXT, UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.admin_clear_match_override(TEXT, UUID) TO anon, authenticated;
REVOKE ALL ON FUNCTION public.admin_get_fixture_sync_meta(TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.admin_get_fixture_sync_meta(TEXT) TO anon, authenticated;
REVOKE ALL ON FUNCTION public.admin_commit_fixture_sync(TEXT, JSONB) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.admin_commit_fixture_sync(TEXT, JSONB) TO anon, authenticated;
REVOKE ALL ON FUNCTION public.admin_update_access_code(TEXT, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.admin_update_access_code(TEXT, TEXT) TO anon, authenticated;
