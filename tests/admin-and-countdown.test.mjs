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
  it('formats long durations with days', () => {
    const now = new Date('2026-08-03T10:00:00Z')
    const kickoff = new Date('2026-08-29T20:00:00Z').toISOString()
    const parts = getCountdown(kickoff, now)
    assert.match(formatCountdown(parts), /^\d+ j · \d+ h$/)
  })

  it('formats mid durations with hours and minutes', () => {
    const now = new Date('2026-08-03T10:00:00Z')
    const kickoff = new Date('2026-08-04T04:24:00Z').toISOString()
    const parts = getCountdown(kickoff, now)
    assert.equal(formatCountdown(parts), '18 h · 24 min')
  })

  it('formats short durations with minutes and seconds', () => {
    const now = new Date('2026-08-03T10:00:00Z')
    const kickoff = new Date('2026-08-03T10:42:18Z').toISOString()
    const parts = getCountdown(kickoff, now)
    assert.equal(formatCountdown(parts), '42 min · 18 s')
  })

  it('shows locked state after kickoff', () => {
    const now = new Date('2026-08-03T12:00:00Z')
    const kickoff = new Date('2026-08-03T10:00:00Z').toISOString()
    const parts = getCountdown(kickoff, now)
    assert.equal(parts.locked, true)
    assert.equal(formatCountdown(parts), 'Verrouillé')
  })
})
