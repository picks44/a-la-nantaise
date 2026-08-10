import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { describe, it } from 'node:test'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { validateFixtureFeed } from '../supabase/functions/_shared/fixtureDownload.ts'
import { planFixtureSync } from '../supabase/functions/_shared/planFixtureSync.ts'
import {
  EXPECTED_DEV_API_PORT,
  EXPECTED_DEV_DB_PORT,
  EXPECTED_DEV_PROJECT_ID,
  FORBIDDEN_TEST_API_PORT,
  FORBIDDEN_TEST_DB_PORT,
  FORBIDDEN_TEST_PROJECT_ID,
  assertArgsHaveNoLinked,
  assertDevSupabaseTarget,
  assertLocalApiUrl,
  assertSafeCliEnvironment,
  assertSetupYesFlag,
  frozenFixturePath,
  parseDevSupabaseConfig,
  parseSupabaseStatusEnv,
  resolveLocalAnonCredentials,
} from '../scripts/supabase-dev-guards.mjs'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const setupScript = readFileSync(
  join(root, 'scripts/db-setup-realistic.mjs'),
  'utf8',
)
const syncScript = readFileSync(
  join(root, 'scripts/sync-fixtures-local.mjs'),
  'utf8',
)
const packageJson = JSON.parse(
  readFileSync(join(root, 'package.json'), 'utf8'),
)
const verifySql = readFileSync(
  join(root, 'supabase/maintenance/verify_realistic_setup.sql'),
  'utf8',
)
const seedSql = readFileSync(join(root, 'supabase/seed.sql'), 'utf8')

describe('dev local guards', () => {
  it('parses committed dev config with expected project and ports', () => {
    const config = parseDevSupabaseConfig()
    assert.equal(config.projectId, EXPECTED_DEV_PROJECT_ID)
    assert.equal(config.apiPort, EXPECTED_DEV_API_PORT)
    assert.equal(config.dbPort, EXPECTED_DEV_DB_PORT)
    assert.equal(config.apiHost, '127.0.0.1')
    assert.equal(config.dbHost, '127.0.0.1')
  })

  it('accepts only local API URLs on the dev port', () => {
    assert.equal(
      assertLocalApiUrl('http://127.0.0.1:54321').port,
      EXPECTED_DEV_API_PORT,
    )
    assert.equal(
      assertLocalApiUrl('http://localhost:54321').hostname,
      'localhost',
    )

    assert.throws(
      () => assertLocalApiUrl('https://abcdefgh.supabase.co'),
      /non locale/,
    )
    assert.throws(
      () => assertLocalApiUrl(`http://127.0.0.1:${FORBIDDEN_TEST_API_PORT}`),
      /stack test/,
    )
    assert.throws(() => assertLocalApiUrl('http://127.0.0.1:54322'), /port API/)
  })

  it('refuses test project_id and test ports', () => {
    assert.throws(
      () =>
        assertDevSupabaseTarget({
          projectId: FORBIDDEN_TEST_PROJECT_ID,
          apiHost: '127.0.0.1',
          apiPort: FORBIDDEN_TEST_API_PORT,
          dbHost: '127.0.0.1',
          dbPort: FORBIDDEN_TEST_DB_PORT,
          configPath: 'x',
        }),
      /project_id de test/,
    )
  })

  it('refuses --linked and missing --yes on setup', () => {
    assert.throws(() => assertArgsHaveNoLinked(['db', 'reset', '--linked']), /--linked/)
    assert.throws(() => assertSetupYesFlag([]), /--yes/)
    assert.doesNotThrow(() => assertSetupYesFlag(['--yes']))
  })

  it('refuses CLI-influencing env vars that can retarget the stack', () => {
    assert.throws(
      () =>
        assertSafeCliEnvironment({
          SUPABASE_URL: 'https://example.supabase.co',
        }),
      /SUPABASE_URL/,
    )
    assert.throws(
      () =>
        assertSafeCliEnvironment({
          SUPABASE_SERVICE_ROLE_KEY: 'secret',
        }),
      /SUPABASE_SERVICE_ROLE_KEY/,
    )
    assert.doesNotThrow(() => assertSafeCliEnvironment({ PATH: '/usr/bin' }))
  })

  it('resolves anon credentials only for local API URLs', () => {
    const envText = [
      'API_URL="http://127.0.0.1:54321"',
      'ANON_KEY="local-anon-key"',
      'SERVICE_ROLE_KEY="must-not-be-used"',
    ].join('\n')

    const creds = resolveLocalAnonCredentials(envText)
    assert.equal(creds.supabaseUrl, 'http://127.0.0.1:54321')
    assert.equal(creds.anonKey, 'local-anon-key')
    assert.equal(parseSupabaseStatusEnv(envText).SERVICE_ROLE_KEY, 'must-not-be-used')

    assert.throws(
      () =>
        resolveLocalAnonCredentials(
          'API_URL="https://prod.example"\nANON_KEY="x"',
        ),
      /non locale/,
    )
  })
})

describe('frozen fixture import planning (offline)', () => {
  const raw = JSON.parse(readFileSync(frozenFixturePath, 'utf8'))
  const fixtures = validateFixtureFeed(raw)

  it('loads 34 Fixture Download fixtures with provider external_id', () => {
    assert.equal(fixtures.length, 34)
    assert.equal(fixtures[0]?.externalId, 'fixturedownload:ligue-2-2026:6')
    assert.ok(fixtures.every((f) => f.externalId.startsWith('fixturedownload:')))
  })

  it('creates 34 rows then stays idempotent on a second plan', () => {
    const first = planFixtureSync([], fixtures, '2026-08-10T10:00:00.000Z')
    assert.equal(first.summary.created, 34)
    assert.equal(first.summary.conflicts, 0)

    const existing = first.creates.map((item, index) => ({
      id: `created-${index}`,
      externalId: item.external_id,
      source: 'fixturedownload',
      roundNumber: item.round_number,
      homeTeam: item.home_team,
      awayTeam: item.away_team,
      kickoffAt: item.kickoff_at,
      status: item.status,
      homeScore: item.home_score,
      awayScore: item.away_score,
      manualOverride: false,
    }))

    const second = planFixtureSync(
      existing,
      fixtures,
      '2026-08-10T11:00:00.000Z',
    )
    assert.equal(second.summary.created, 0)
    assert.equal(second.summary.updated, 0)
    assert.equal(second.summary.unchanged, 34)
    assert.equal(second.conflicts.length, 0)
  })
})

describe('realistic setup scripts contract', () => {
  it('wires npm scripts without linked or service_role', () => {
    assert.equal(
      packageJson.scripts['db:setup:realistic'],
      'node --experimental-strip-types scripts/db-setup-realistic.mjs',
    )
    assert.equal(
      packageJson.scripts['db:sync:fixtures:local'],
      'node --experimental-strip-types scripts/sync-fixtures-local.mjs',
    )
    assert.match(setupScript, /assertArgsHaveNoLinked/)
    assert.match(syncScript, /assertArgsHaveNoLinked/)
    assert.doesNotMatch(setupScript, /['"]--linked['"]/)
    assert.doesNotMatch(syncScript, /['"]--linked['"]/)
    assert.doesNotMatch(setupScript, /createClient\([^)]*SERVICE_ROLE/i)
    assert.doesNotMatch(syncScript, /createClient\([^)]*SERVICE_ROLE/i)
    assert.match(syncScript, /createClient\(supabaseUrl, anonKey/)
  })

  it('uses frozen JSON by default and keeps live behind --live', () => {
    assert.match(syncScript, /frozenFixturePath/)
    assert.match(syncScript, /ligue-2-2026-fc-nantes\.json/)
    assert.match(syncScript, /--live/)
    assert.match(syncScript, /FIXTURE_FEED_URL/)
    assert.match(setupScript, /assertSetupYesFlag/)
    assert.match(setupScript, /db', 'reset', '--yes'/)
  })

  it('does not create predictions and keeps seed free of matches', () => {
    assert.match(syncScript, /predictionsCreated: 0/)
    assert.match(verifySql, /expected 0 predictions in S2 setup/)
    assert.match(verifySql, /expected 34 fixturedownload matches/)
    assert.match(verifySql, /expected 0 manual matches/)
    assert.doesNotMatch(seedSql, /INSERT\s+INTO\s+public\.matches\b/i)
    assert.doesNotMatch(seedSql, /INSERT\s+INTO\s+public\.predictions\b/i)
  })

  it('does not chain .catch on supabase.rpc builders', () => {
    const logoutIdx = syncScript.indexOf("rpc('logout_admin'")
    assert.ok(logoutIdx > 0, 'expected logout_admin rpc call')
    const window = syncScript.slice(Math.max(0, logoutIdx - 40), logoutIdx + 180)
    assert.match(window, /await supabase\.rpc\(\s*'logout_admin'/)
    assert.doesNotMatch(window, /\.catch\(/)
    assert.match(window, /best-effort session cleanup/)
  })

  it('keeps npm test free of live Fixture Download network calls', () => {
    assert.equal(packageJson.scripts.test.includes('db:setup:realistic'), false)
    assert.equal(packageJson.scripts.test.includes('db:sync:fixtures:local'), false)
    assert.doesNotMatch(packageJson.scripts.test, /fixturedownload\.com/)
  })
})
