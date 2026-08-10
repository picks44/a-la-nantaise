import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { describe, it } from 'node:test'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { findHomeGroupRevealMatch } from '../src/lib/matchOrder.ts'
import { shouldOpenDetailsForDeepLink } from '../src/lib/pageLoadTimeout.ts'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')

function read(relativePath) {
  return readFileSync(join(root, relativePath), 'utf8')
}

function baseMatch(partial) {
  return {
    id: partial.id ?? 'm1',
    matchday: partial.matchday ?? 1,
    kickoffAt: partial.kickoffAt,
    kickoffTimeConfirmed: partial.kickoffTimeConfirmed ?? true,
    dbStatus: partial.dbStatus ?? 'scheduled',
  }
}

describe('findHomeGroupRevealMatch', () => {
  const now = new Date('2026-08-10T12:00:00.000Z')

  it('returns null before kickoff (future confirmed match)', () => {
    assert.equal(
      findHomeGroupRevealMatch(
        [
          baseMatch({
            id: 'future',
            kickoffAt: '2026-08-14T18:45:00.000Z',
          }),
        ],
        now,
      ),
      null,
    )
  })

  it('returns the locked / awaiting match after kickoff', () => {
    const match = findHomeGroupRevealMatch(
      [
        baseMatch({
          id: 'locked-j1',
          kickoffAt: '2026-08-08T18:45:00.000Z',
          dbStatus: 'scheduled',
        }),
      ],
      now,
    )
    assert.equal(match?.id, 'locked-j1')
  })

  it('picks the most recent kickoff when several matches await a result', () => {
    const match = findHomeGroupRevealMatch(
      [
        baseMatch({
          id: 'older',
          kickoffAt: '2026-08-01T18:45:00.000Z',
          dbStatus: 'live',
        }),
        baseMatch({
          id: 'newer',
          kickoffAt: '2026-08-09T18:45:00.000Z',
          dbStatus: 'scheduled',
        }),
      ],
      now,
    )
    assert.equal(match?.id, 'newer')
  })

  it('ignores finished, postponed, cancelled, and unconfirmed', () => {
    assert.equal(
      findHomeGroupRevealMatch(
        [
          baseMatch({
            id: 'done',
            kickoffAt: '2026-08-01T18:45:00.000Z',
            dbStatus: 'finished',
          }),
          baseMatch({
            id: 'postponed',
            kickoffAt: '2026-08-02T18:45:00.000Z',
            dbStatus: 'postponed',
          }),
          baseMatch({
            id: 'unconfirmed',
            kickoffAt: '2026-08-01T18:45:00.000Z',
            kickoffTimeConfirmed: false,
          }),
        ],
        now,
      ),
      null,
    )
  })
})

describe('Home group reveal CTA wiring', () => {
  const home = read('src/pages/HomePage.tsx')
  const calendar = read('src/pages/CalendarPage.tsx')
  const matchOrder = read('src/lib/matchOrder.ts')

  it('wires locked CTA via findHomeGroupRevealMatch and exact calendrier deeplink', () => {
    assert.match(matchOrder, /export function findHomeGroupRevealMatch/)
    assert.match(matchOrder, /matchAwaitsOfficialResult/)
    assert.match(home, /findHomeGroupRevealMatch/)
    assert.match(home, /GroupRevealCta/)
    assert.match(home, /Voir les pronos du groupe/)
    assert.match(home, /to=\{`\/calendrier\?match=\$\{matchId\}`\}/)
    assert.match(home, /groupRevealMatch \? \(/)
    assert.doesNotMatch(home, /RevealSection/)
  })

  it('wires finished CTA inside LastMatchBlock with the same deeplink', () => {
    const lastBlock = home.slice(home.indexOf('function LastMatchBlock'))
    assert.match(lastBlock, /Voir les pronos du groupe/)
    assert.match(lastBlock, /to=\{`\/calendrier\?match=\$\{match\.id\}`\}/)
  })

  it('keeps Calendar deeplink and no-match navigation unchanged', () => {
    assert.match(calendar, /searchParams\.get\('match'\)/)
    assert.match(calendar, /shouldOpenDetailsForDeepLink/)
    assert.match(calendar, /desiredTab: CalendarTab/)
    assert.match(calendar, /scrollIntoView/)
    assert.equal(
      shouldOpenDetailsForDeepLink({
        matchFound: true,
        uiStatus: 'locked',
        isNextOpen: false,
      }),
      true,
    )
    assert.equal(
      shouldOpenDetailsForDeepLink({
        matchFound: false,
        uiStatus: null,
        isNextOpen: false,
      }),
      false,
    )
  })
})
