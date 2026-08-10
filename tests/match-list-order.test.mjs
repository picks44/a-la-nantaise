import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { describe, it } from 'node:test'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  findLastFinishedMatch,
  findNextOpenMatch,
  shouldShowJumpToNextMatch,
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
    kickoffTimeConfirmed: partial.kickoffTimeConfirmed ?? true,
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

describe('jump to next match link', () => {
  it('hides the link when the next match is first in the ordered list', () => {
    assert.equal(shouldShowJumpToNextMatch(['next', 'later'], 'next'), false)
  })

  it('shows the link when finished matches precede the next open match', () => {
    assert.equal(
      shouldShowJumpToNextMatch(['done-1', 'done-2', 'next', 'later'], 'next'),
      true,
    )
  })

  it('hides the link when there is no next open match', () => {
    assert.equal(shouldShowJumpToNextMatch(['done-1', 'done-2'], null), false)
    assert.equal(shouldShowJumpToNextMatch([], null), false)
  })

  it('wires the calendar jump link to #prochain-match only when needed', () => {
    const calendar = readFileSync(
      join(root, 'src/pages/CalendarPage.tsx'),
      'utf8',
    )
    const item = readFileSync(
      join(root, 'src/components/MatchListItem.tsx'),
      'utf8',
    )
    assert.match(calendar, /shouldShowJumpToNextMatch/)
    assert.match(calendar, /upcomingDisplayOrderIds/)
    assert.match(calendar, /showJumpToNext/)
    assert.match(calendar, /href="#prochain-match"/)
    assert.match(calendar, /showJumpToNext \?/)
    assert.match(calendar, /tab === 'finished'/)
    assert.match(calendar, /pendingScrollToNextRef/)
    assert.doesNotMatch(calendar, /\{nextOpenId \?/)
    assert.match(item, /id=\{`match-\$\{match\.id\}`\}/)
    assert.match(item, /id="prochain-match"/)
    assert.match(item, /scroll-mt-24/)
  })

  it('keeps reveal details open state keyed by matchId with last finished default', () => {
    const calendar = readFileSync(
      join(root, 'src/pages/CalendarPage.tsx'),
      'utf8',
    )
    const item = readFileSync(
      join(root, 'src/components/MatchListItem.tsx'),
      'utf8',
    )
    assert.match(calendar, /findLastFinishedMatch/)
    assert.match(calendar, /detailsOpenById/)
    assert.match(calendar, /detailsOpen=\{isDetailsOpen\(match\.id\)\}/)
    assert.match(calendar, /onDetailsOpenChange/)
    assert.match(calendar, /onRetryReveal/)
    assert.match(item, /aria-expanded=\{detailsOpen\}/)
    assert.match(item, /aria-controls=\{detailsId\}/)
    assert.match(item, /role="alert"/)
    assert.match(item, /Réessayer/)
  })
})
