import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { describe, it } from 'node:test'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  findHomeGroupRevealMatch,
  findHomePendingResultMatch,
  findLastFinishedMatch,
  findNextOpenMatch,
  selectHomePrimaryMatch,
} from '../src/lib/matchOrder.ts'
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
    finalScore: partial.finalScore,
    homeTeam: partial.homeTeam ?? 'Home',
    awayTeam: partial.awayTeam ?? 'Away',
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

describe('Home primary match priority J1/J2/J3', () => {
  const now = new Date('2026-08-10T12:00:00.000Z')

  const j1Finished = baseMatch({
    id: 'j1-finished',
    matchday: 1,
    kickoffAt: '2026-08-01T18:45:00.000Z',
    dbStatus: 'finished',
    finalScore: { home: 2, away: 1 },
  })
  const j2Awaiting = baseMatch({
    id: 'j2-awaiting',
    matchday: 2,
    kickoffAt: '2026-08-08T18:45:00.000Z',
    dbStatus: 'scheduled',
  })
  const j3Open = baseMatch({
    id: 'j3-open',
    matchday: 3,
    kickoffAt: '2026-08-14T18:45:00.000Z',
    dbStatus: 'scheduled',
  })

  it('keeps J2 as group reveal, J3 as next open, J1 as last finished', () => {
    const matches = [j1Finished, j2Awaiting, j3Open]
    assert.equal(findHomeGroupRevealMatch(matches, now)?.id, 'j2-awaiting')
    assert.equal(findNextOpenMatch(matches, now)?.id, 'j3-open')
    assert.equal(findLastFinishedMatch(matches)?.id, 'j1-finished')
  })

  it('promotes J3 to primary while J2 is a stale awaiting pending block', () => {
    const matches = [j1Finished, j2Awaiting, j3Open]
    assert.equal(selectHomePrimaryMatch(matches, now)?.id, 'j3-open')
    assert.equal(
      findHomePendingResultMatch(matches, 'j3-open', now)?.id,
      'j2-awaiting',
    )
  })

  it('after J2 finishes, primary open becomes J3 and last finished becomes J2', () => {
    const j2Finished = baseMatch({
      id: 'j2-awaiting',
      matchday: 2,
      kickoffAt: '2026-08-08T18:45:00.000Z',
      dbStatus: 'finished',
      finalScore: { home: 1, away: 0 },
    })
    const matches = [j1Finished, j2Finished, j3Open]
    assert.equal(findHomeGroupRevealMatch(matches, now), null)
    assert.equal(findNextOpenMatch(matches, now)?.id, 'j3-open')
    assert.equal(selectHomePrimaryMatch(matches, now)?.id, 'j3-open')
    assert.equal(findLastFinishedMatch(matches)?.id, 'j2-awaiting')
  })

  it('keeps a live match as primary over the next open match', () => {
    const liveNow = new Date('2026-08-08T19:15:00.000Z')
    const j2Live = baseMatch({
      id: 'j2-live',
      matchday: 2,
      kickoffAt: '2026-08-08T18:45:00.000Z',
      dbStatus: 'scheduled',
    })
    const matches = [j1Finished, j2Live, j3Open]
    assert.equal(selectHomePrimaryMatch(matches, liveNow)?.id, 'j2-live')
    assert.equal(findNextOpenMatch(matches, liveNow)?.id, 'j3-open')
  })

  it('uses stale awaiting as primary when no next open match exists', () => {
    const matches = [j1Finished, j2Awaiting]
    assert.equal(selectHomePrimaryMatch(matches, now)?.id, 'j2-awaiting')
    assert.equal(findHomePendingResultMatch(matches, 'j2-awaiting', now), null)
  })

  it('does not treat last finished as pending or primary when a next match is open', () => {
    const j2Finished = baseMatch({
      id: 'j2-finished',
      matchday: 2,
      kickoffAt: '2026-08-08T18:45:00.000Z',
      dbStatus: 'finished',
      finalScore: { home: 2, away: 1 },
    })
    const matches = [j1Finished, j2Finished, j3Open]
    assert.equal(selectHomePrimaryMatch(matches, now)?.id, 'j3-open')
    assert.equal(findLastFinishedMatch(matches)?.id, 'j2-finished')
    assert.equal(findHomePendingResultMatch(matches, 'j3-open', now), null)
  })
})

describe('Home incident non-regression J2 stale + J3 open', () => {
  it('makes J3 primary and keeps J2 as awaiting reveal, not live', () => {
    const now = new Date('2026-08-18T19:00:00.000Z')
    const j2 = baseMatch({
      id: 'j2-laval',
      matchday: 2,
      kickoffAt: '2026-08-14T18:45:00.000Z',
      homeTeam: 'Stade Lavallois MFC',
      awayTeam: 'FC Nantes',
      dbStatus: 'scheduled',
    })
    const j3 = baseMatch({
      id: 'j3-rodez',
      matchday: 3,
      kickoffAt: '2026-08-22T12:00:00.000Z',
      homeTeam: 'FC Nantes',
      awayTeam: 'Rodez Aveyron Football',
      dbStatus: 'scheduled',
    })
    const matches = [j2, j3]
    assert.equal(selectHomePrimaryMatch(matches, now)?.id, 'j3-rodez')
    assert.equal(findHomePendingResultMatch(matches, 'j3-rodez', now)?.id, 'j2-laval')
    const home = read('src/pages/HomePage.tsx')
    assert.match(home, /function PendingResultBlock/)
    assert.match(home, /matchPhaseHeadline/)
    assert.match(home, /Résultat en attente/)
    const awaitingStart = home.indexOf('function AwaitingPrimaryCard')
    const awaitingEnd = home.indexOf('function OpenPrimaryCard')
    const awaiting = home.slice(awaitingStart, awaitingEnd)
    assert.doesNotMatch(awaiting, /Match en cours/)
  })
})

describe('Home group reveal CTA wiring', () => {
  const home = read('src/pages/HomePage.tsx')
  const calendar = read('src/pages/CalendarPage.tsx')
  const matchOrder = read('src/lib/matchOrder.ts')

  it('wires primaryMatch priority: live, then nextOpen, then awaiting', () => {
    assert.match(matchOrder, /export function findHomeGroupRevealMatch/)
    assert.match(matchOrder, /export function selectHomePrimaryMatch/)
    assert.match(matchOrder, /findLiveMatch/)
    assert.match(matchOrder, /findNextOpenMatch/)
    assert.match(matchOrder, /findAwaitingResultMatch/)
    assert.match(home, /selectHomePrimaryMatch/)
    assert.match(home, /findHomePendingResultMatch/)
    assert.match(home, /const primaryMatch = useMemo/)
    assert.match(home, /PendingResultBlock/)
    assert.match(home, /isAwaitingPrimary/)
    assert.match(home, /AwaitingPrimaryCard/)
  })

  it('puts group CTA inside awaiting primary card and pending result block', () => {
    const awaitingStart = home.indexOf('function AwaitingPrimaryCard')
    const awaitingEnd = home.indexOf('function OpenPrimaryCard')
    const awaiting = home.slice(awaitingStart, awaitingEnd)
    assert.match(awaiting, /Voir les pronos du groupe/)
    assert.match(awaiting, /to=\{`\/calendrier\?match=\$\{match\.id\}`\}/)
    assert.doesNotMatch(awaiting, /Valider mon prono/)
    assert.doesNotMatch(awaiting, /Modifier mon prono/)
    assert.doesNotMatch(awaiting, /ScoreInput/)
    const pending = home.slice(home.indexOf('function PendingResultBlock'))
    assert.match(pending, /Voir les pronos du groupe/)
  })

  it('removes floating GroupRevealCta and LastMatchBlock group CTA', () => {
    assert.doesNotMatch(home, /function GroupRevealCta/)
    assert.doesNotMatch(home, /<GroupRevealCta/)
    const lastBlock = home.slice(home.indexOf('function LastMatchBlock'))
    assert.doesNotMatch(lastBlock, /Voir les pronos du groupe/)
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
