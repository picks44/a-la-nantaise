import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { describe, it } from 'node:test'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const migrationPath = join(
  root,
  'supabase/migrations/20260803120000_fix_upsert_prediction_ambiguity.sql',
)
const apiPath = join(root, 'src/lib/api.ts')
const sqlTestPath = join(root, 'supabase/tests/upsert_prediction.sql')

describe('upsert_prediction ambiguity fix', () => {
  const sql = readFileSync(migrationPath, 'utf8')
  const api = readFileSync(apiPath, 'utf8')
  const sqlTests = readFileSync(sqlTestPath, 'utf8')

  it('keeps the same RPC name and p_ parameter convention', () => {
    assert.match(sql, /CREATE OR REPLACE FUNCTION public\.upsert_prediction\(/)
    assert.match(sql, /p_access_code TEXT/)
    assert.match(sql, /p_player_id UUID/)
    assert.match(sql, /p_match_id UUID/)
    assert.match(sql, /p_predicted_home_score INTEGER/)
    assert.match(sql, /p_predicted_away_score INTEGER/)
  })

  it('uses ON CONFLICT ON CONSTRAINT instead of bare column list', () => {
    assert.match(sql, /ON CONFLICT ON CONSTRAINT predictions_player_match_unique/)
    const withoutComments = sql.replace(/--.*$/gm, '')
    assert.doesNotMatch(
      withoutComments,
      /ON CONFLICT\s*\(\s*player_id\s*,\s*match_id\s*\)/,
    )
  })

  it('qualifies prediction columns and uses EXCLUDED for updates', () => {
    assert.match(sql, /INSERT INTO public\.predictions AS pr/)
    assert.match(sql, /RETURNING\s+pr\.id,\s*pr\.player_id,\s*pr\.match_id/s)
    assert.match(sql, /predicted_home_score = EXCLUDED\.predicted_home_score/)
    assert.match(sql, /predicted_away_score = EXCLUDED\.predicted_away_score/)
    assert.match(sql, /#variable_conflict use_column/)
  })

  it('preserves security and kickoff lock rules', () => {
    assert.match(sql, /SECURITY DEFINER/)
    assert.match(sql, /SET search_path = public, extensions/)
    assert.match(sql, /PERFORM public\.assert_access_code\(p_access_code\)/)
    assert.match(sql, /now\(\) >= match_row\.kickoff_at/)
    assert.match(sql, /MATCH_LOCKED/)
    assert.match(sql, /p_predicted_home_score > 15/)
    assert.match(
      sql,
      /GRANT EXECUTE ON FUNCTION public\.upsert_prediction\(TEXT, UUID, UUID, INTEGER, INTEGER\)/,
    )
  })

  it('does not drop tables or truncate predictions', () => {
    assert.doesNotMatch(sql, /DROP TABLE/i)
    assert.doesNotMatch(sql, /TRUNCATE/i)
    assert.doesNotMatch(sql, /DELETE FROM public\.predictions/i)
  })

  it('current frontend calls session-based upsert_prediction', () => {
    const pinMigration = readFileSync(
      join(root, 'supabase/migrations/20260803180000_player_pin_sessions.sql'),
      'utf8',
    )
    assert.match(api, /rpc<DbPredictionRow\[]>\('upsert_prediction'/)
    assert.match(api, /p_session_token: input\.sessionToken/)
    assert.match(api, /p_match_id: input\.matchId/)
    assert.match(api, /p_predicted_home_score: input\.homeScore/)
    assert.match(api, /p_predicted_away_score: input\.awayScore/)
    assert.doesNotMatch(api, /upsert_prediction[\s\S]{0,200}p_player_id/)
    assert.match(
      pinMigration,
      /DROP FUNCTION IF EXISTS public\.upsert_prediction\(TEXT, UUID, UUID, INTEGER, INTEGER\)/,
    )
  })

  it('SQL regression tests cover create, update, uniqueness, lock and privacy', () => {
    assert.match(sqlTests, /Création d’un pronostic/)
    assert.match(sqlTests, /Modification du même pronostic/)
    assert.match(sqlTests, /Unicité joueur \+ match/)
    assert.match(sqlTests, /Refus après le coup d’envoi/)
    assert.match(sqlTests, /MATCH_LOCKED/)
    assert.match(sqlTests, /login_player/)
    assert.match(sqlTests, /get_my_predictions/)
    assert.match(sqlTests, /score d’un autre joueur visible avant kickoff/)
    assert.match(sqlTests, /ancienne signature upsert_prediction/)
    assert.match(sqlTests, /ROLLBACK/)
  })
})
