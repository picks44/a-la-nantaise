import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { describe, it } from 'node:test'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  DEV_PREDICTION_EXTERNAL_IDS,
  EXPECTED_DEV_PREDICTION_COUNT,
  assertArgsHaveNoLinked,
  assertSafeCliEnvironment,
} from '../scripts/supabase-dev-guards.mjs'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const seedSql = readFileSync(join(root, 'supabase/seed-dev-predictions.sql'), 'utf8')
const verifySql = readFileSync(
  join(root, 'supabase/maintenance/verify_dev_predictions.sql'),
  'utf8',
)
const script = readFileSync(join(root, 'scripts/seed-dev-predictions.mjs'), 'utf8')
const packageJson = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'))

describe('seed-dev-predictions (S3)', () => {
  it('targets matches only via fixturedownload external_id', () => {
    for (const externalId of DEV_PREDICTION_EXTERNAL_IDS) {
      assert.match(seedSql, new RegExp(externalId.replace(/:/g, '\\:')))
    }
    assert.match(seedSql, /source = 'fixturedownload'/)
    assert.doesNotMatch(seedSql, /22222222-2222-2222-2222-22222222220/)
    assert.doesNotMatch(seedSql, /INSERT\s+INTO\s+public\.matches\b/i)
    assert.doesNotMatch(seedSql, /UPDATE\s+public\.matches\b/i)
  })

  it('upserts predictions idempotently without hardcoding points', () => {
    assert.match(seedSql, /ON CONFLICT \(player_id, match_id\) DO UPDATE/)
    assert.match(seedSql, /recalculate_season_achievements/)
    assert.doesNotMatch(seedSql, /points\s*=\s*[0-3]\b/)
    assert.match(seedSql, /NULL/)
    assert.doesNotMatch(seedSql, /INSERT\s+INTO\s+public\.player_trophies\b/i)
  })

  it('aborts clearly when Fixture Download calendar is missing', () => {
    assert.match(seedSql, /DEV_PREDICTIONS_ABORT/)
    assert.match(seedSql, /expected 34 fixturedownload matches/)
    assert.match(script, /db:setup:realistic/)
    assert.match(script, /Exécute d’abord/)
  })

  it('reuses local guards and wires the npm script', () => {
    assert.equal(
      packageJson.scripts['db:seed:predictions:local'],
      'node --experimental-strip-types scripts/seed-dev-predictions.mjs',
    )
    assert.match(script, /prepareDevLocalTarget/)
    assert.match(script, /assertArgsHaveNoLinked/)
    assert.doesNotThrow(() => assertArgsHaveNoLinked([]))
    assert.throws(() => assertArgsHaveNoLinked(['--linked']), /--linked/)
    assert.throws(
      () => assertSafeCliEnvironment({ SUPABASE_URL: 'https://x.supabase.co' }),
      /SUPABASE_URL/,
    )
    assert.doesNotMatch(script, /createClient\([^)]*SERVICE_ROLE/i)
    assert.doesNotMatch(script, /FIXTURE_FEED_URL|fixturedownload\.com/)
  })

  it('verifies expected prediction count and finished-only scoring contract', () => {
    assert.equal(EXPECTED_DEV_PREDICTION_COUNT, 10)
    assert.match(verifySql, /expected % predictions/)
    assert.match(verifySql, /v_expected INTEGER := 10/)
    assert.match(verifySql, /DEV_PREDICTIONS_OK/)
    assert.match(verifySql, /points on non-finished matches/)
    assert.match(verifySql, /non-fixturedownload matches/)
  })

  it('keeps npm test free of live feed and S3 side effects', () => {
    assert.equal(
      packageJson.scripts.test.includes('db:seed:predictions:local'),
      false,
    )
    assert.doesNotMatch(packageJson.scripts.test, /fixturedownload\.com/)
  })
})
