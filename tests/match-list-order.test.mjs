import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { describe, it } from 'node:test'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  findLastFinishedMatch,
  findNextOpenMatch,
  sortMatchesForList,
} from '../src/lib/matchOrder.ts'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const migrationPath = join(
  root,
  'supabase/migrations/20260803150000_match_list_order.sql',
)
const adminPagePath = join(root, 'src/pages/AdminPage.tsx')

function match(partial) {
  return {
    id: partial.id,
    matchday: partial.matchday,
    kickoffAt: partial.kickoffAt,
    homeTeam: 'FC Nantes',
    awayTeam: 'Red Star FC',
    venue: 'home',
    dbStatus: partial.dbStatus ?? 'scheduled',
    status: partial.status ?? 'to_predict',
    finalScore: partial.finalScore,
  }
}

describe('match list order', () => {
  it('sorts calendar/admin lists from J1 to J34 then kickoff then id', () => {
    const unordered = [
      match({
        id: 'b',
        matchday: 34,
        kickoffAt: '2027-05-01T18:00:00.000Z',
      }),
      match({
        id: 'a',
        matchday: 1,
        kickoffAt: '2026-08-08T18:45:00.000Z',
      }),
      match({
        id: 'c',
        matchday: 2,
        kickoffAt: '2026-08-15T18:45:00.000Z',
      }),
      match({
        id: 'd',
        matchday: 2,
        kickoffAt: '2026-08-14T18:45:00.000Z',
      }),
      match({
        id: 'f',
        matchday: 2,
        kickoffAt: '2026-08-14T18:45:00.000Z',
      }),
      match({
        id: 'e',
        matchday: 2,
        kickoffAt: '2026-08-14T18:45:00.000Z',
      }),
    ]

    const sorted = sortMatchesForList(unordered)
    assert.deepEqual(
      sorted.map((item) => item.id),
      ['a', 'd', 'e', 'f', 'c', 'b'],
    )
    assert.equal(sorted[0].matchday, 1)
    assert.equal(sorted.at(-1).matchday, 34)
  })

  it('keeps next open match as earliest future kickoff', () => {
    const now = new Date('2026-08-10T12:00:00.000Z')
    const matches = sortMatchesForList([
      match({
        id: 'finished',
        matchday: 1,
        kickoffAt: '2026-08-08T18:45:00.000Z',
        dbStatus: 'finished',
        status: 'finished',
        finalScore: { home: 1, away: 0 },
      }),
      match({
        id: 'later',
        matchday: 3,
        kickoffAt: '2026-08-22T18:45:00.000Z',
      }),
      match({
        id: 'next',
        matchday: 2,
        kickoffAt: '2026-08-14T18:45:00.000Z',
      }),
    ])

    assert.equal(findNextOpenMatch(matches, now)?.id, 'next')
  })

  it('keeps last finished match as most recent kickoff', () => {
    const matches = sortMatchesForList([
      match({
        id: 'old',
        matchday: 1,
        kickoffAt: '2026-08-08T18:45:00.000Z',
        dbStatus: 'finished',
        status: 'finished',
        finalScore: { home: 2, away: 0 },
      }),
      match({
        id: 'recent',
        matchday: 2,
        kickoffAt: '2026-08-14T18:45:00.000Z',
        dbStatus: 'finished',
        status: 'finished',
        finalScore: { home: 1, away: 1 },
      }),
      match({
        id: 'upcoming',
        matchday: 3,
        kickoffAt: '2026-08-22T18:45:00.000Z',
      }),
    ])

    assert.equal(findLastFinishedMatch(matches)?.id, 'recent')
  })

  it('migration orders by round then kickoff then id', () => {
    const sql = readFileSync(migrationPath, 'utf8')
    assert.match(
      sql,
      /ORDER BY m\.round_number ASC, m\.kickoff_at ASC, m\.id ASC/,
    )
    assert.match(sql, /FUNCTION public\.get_matches/)
    assert.match(sql, /FUNCTION public\.admin_get_matches/)
    assert.match(sql, /assert_access_code/)
    assert.match(sql, /assert_admin_code/)
    assert.match(sql, /GRANT EXECUTE ON FUNCTION public\.get_matches/)
    assert.match(sql, /GRANT EXECUTE ON FUNCTION public\.admin_get_matches/)
  })

  it('admin page no longer sorts kickoff descending', () => {
    const source = readFileSync(adminPagePath, 'utf8')
    assert.match(source, /sortMatchesForList/)
    assert.doesNotMatch(
      source,
      /new Date\(b\.kickoffAt\)\.getTime\(\) - new Date\(a\.kickoffAt\)\.getTime\(\)/,
    )
  })
})
