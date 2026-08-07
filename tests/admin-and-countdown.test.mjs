import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { describe, it } from 'node:test'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { formatCountdown, getCountdown } from '../src/lib/format.ts'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const migrationPath = join(
  root,
  'supabase/migrations/20260803130000_admin_rpcs.sql',
)
const sqlTestPath = join(root, 'supabase/tests/admin_rpcs.sql')

describe('admin migration', () => {
  const sql = readFileSync(migrationPath, 'utf8')
  const sqlTests = readFileSync(sqlTestPath, 'utf8')

  it('stores admin_code_hash and verify_admin_code', () => {
    assert.match(sql, /admin_code_hash/)
    assert.match(sql, /CREATE OR REPLACE FUNCTION public\.verify_admin_code/)
    assert.match(sql, /INVALID_ADMIN_CODE/)
    assert.match(sql, /SECURITY DEFINER/)
    assert.match(sql, /SET search_path = public, extensions/)
  })

  it('exposes player and match admin RPCs with p_admin_code', () => {
    for (const fn of [
      'admin_get_players',
      'admin_create_player',
      'admin_update_player_name',
      'admin_set_player_active',
      'admin_get_matches',
      'admin_create_match',
      'admin_update_match',
      'admin_set_match_result',
      'admin_get_stats',
    ]) {
      assert.match(sql, new RegExp(`FUNCTION public\\.${fn}\\(`))
      assert.match(sql, new RegExp(`${fn}[\\s\\S]*?p_admin_code`))
    }
  })

  it('does not delete existing data', () => {
    assert.doesNotMatch(sql, /DROP TABLE/i)
    assert.doesNotMatch(sql, /TRUNCATE/i)
    assert.doesNotMatch(sql, /DELETE FROM public\.(players|matches|predictions)/i)
  })

  it('SQL tests cover admin scenarios including scoring', () => {
    assert.match(sqlTests, /mauvais code admin/)
    assert.match(sqlTests, /Unicité pseudo/)
    assert.match(sqlTests, /INVALID_NANTES_FIXTURE/)
    assert.match(sqlTests, /INCOMPLETE_RESULT/)
    assert.match(sqlTests, /score exact/)
    assert.match(sqlTests, /bon résultat/)
    assert.match(sqlTests, /mauvais résultat/)
    assert.match(sqlTests, /recalcul après correction/)
    assert.match(sqlTests, /ROLLBACK/)
  })

  it('SQL tests call admin RPCs through a session token, not a raw admin code', () => {
    assert.match(sqlTests, /login_admin\('admin-test-code'\)/)
    assert.match(sqlTests, /test\.admin_token/)
    assert.match(sqlTests, /INVALID_ADMIN_SESSION/)
    assert.doesNotMatch(sqlTests, /admin_create_player\(\s*'admin-test-code'/)
    assert.doesNotMatch(sqlTests, /admin_create_match\(\s*'admin-test-code'/)
    assert.match(sqlTests, /accepte encore p_admin_code/)
  })
})

describe('formatCountdown', () => {
  it('formats durations over 24h with days and hours only', () => {
    const now = new Date('2026-08-03T10:00:00Z')
    const kickoff = new Date('2026-08-06T15:00:00Z').toISOString()
    const parts = getCountdown(kickoff, now)
    assert.equal(formatCountdown(parts), '3 j 5 h')
  })

  it('formats 26h as days and hours (24h threshold)', () => {
    const now = new Date('2026-08-03T10:00:00Z')
    const kickoff = new Date('2026-08-04T12:00:00Z').toISOString()
    const parts = getCountdown(kickoff, now)
    assert.equal(formatCountdown(parts), '1 j 2 h')
  })

  it('formats mid durations under 24h with hours and minutes', () => {
    const now = new Date('2026-08-03T10:00:00Z')
    const kickoff = new Date('2026-08-03T22:42:00Z').toISOString()
    const parts = getCountdown(kickoff, now)
    assert.equal(formatCountdown(parts), '12 h 42')
  })

  it('formats under 1h with minutes only', () => {
    const now = new Date('2026-08-03T10:00:00Z')
    const kickoff = new Date('2026-08-03T10:45:30Z').toISOString()
    const parts = getCountdown(kickoff, now)
    assert.equal(formatCountdown(parts), '45 min')
  })

  it('formats under 1min with seconds only', () => {
    const now = new Date('2026-08-03T10:00:00Z')
    const kickoff = new Date('2026-08-03T10:00:30Z').toISOString()
    const parts = getCountdown(kickoff, now)
    assert.equal(formatCountdown(parts), '30 sec')
  })

  it('shows locked state after kickoff', () => {
    const now = new Date('2026-08-03T12:00:00Z')
    const kickoff = new Date('2026-08-03T10:00:00Z').toISOString()
    const parts = getCountdown(kickoff, now)
    assert.equal(parts.locked, true)
    assert.equal(formatCountdown(parts), 'Verrouillé')
  })

  it('does not use middle-dot separators', () => {
    const now = new Date('2026-08-03T10:00:00Z')
    const overDay = getCountdown(
      new Date('2026-08-05T10:00:00Z').toISOString(),
      now,
    )
    const underDay = getCountdown(
      new Date('2026-08-03T22:00:00Z').toISOString(),
      now,
    )
    assert.equal(formatCountdown(overDay).includes('·'), false)
    assert.equal(formatCountdown(underDay).includes('·'), false)
  })
})
