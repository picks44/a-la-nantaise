import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, it } from 'node:test'

import {
  createRefreshCoalescer,
  runSoftPageLoad,
} from '../src/lib/calendarRefresh.ts'
import {
  isRankingAwaitingFirstResult,
  selectHomeRanking,
  getCompetitionRanks,
} from '../src/lib/ranking.ts'
import {
  SOFT_RESULT_POLL_MS,
  attachSoftPageRefresh,
  hasMatchAwaitingOfficialResult,
  matchAwaitsOfficialResult,
} from '../src/lib/softPageRefresh.ts'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')

function read(relativePath) {
  return readFileSync(join(root, relativePath), 'utf8')
}

const calendarPage = read('src/pages/CalendarPage.tsx')
const homePage = read('src/pages/HomePage.tsx')
const rankingPage = read('src/pages/RankingPage.tsx')

function baseMatch(partial) {
  return {
    id: partial.id ?? 'm1',
    kickoffAt: partial.kickoffAt,
    kickoffTimeConfirmed: partial.kickoffTimeConfirmed ?? true,
    dbStatus: partial.dbStatus ?? 'scheduled',
  }
}

describe('matchAwaitsOfficialResult / hasMatchAwaitingOfficialResult', () => {
  const now = new Date('2026-08-10T12:00:00.000Z')

  it('is true for confirmed post-kickoff scheduled/live matches', () => {
    assert.equal(
      matchAwaitsOfficialResult(
        baseMatch({
          kickoffAt: '2026-08-08T18:45:00.000Z',
          dbStatus: 'scheduled',
        }),
        now,
      ),
      true,
    )
    assert.equal(
      matchAwaitsOfficialResult(
        baseMatch({
          kickoffAt: '2026-08-08T18:45:00.000Z',
          dbStatus: 'live',
        }),
        now,
      ),
      true,
    )
  })

  it('is false for future, finished, postponed, cancelled, or unconfirmed', () => {
    assert.equal(
      matchAwaitsOfficialResult(
        baseMatch({
          kickoffAt: '2026-08-14T18:45:00.000Z',
          dbStatus: 'scheduled',
        }),
        now,
      ),
      false,
    )
    assert.equal(
      matchAwaitsOfficialResult(
        baseMatch({
          kickoffAt: '2026-08-08T18:45:00.000Z',
          dbStatus: 'finished',
        }),
        now,
      ),
      false,
    )
    assert.equal(
      matchAwaitsOfficialResult(
        baseMatch({
          kickoffAt: '2026-08-08T18:45:00.000Z',
          dbStatus: 'postponed',
        }),
        now,
      ),
      false,
    )
    assert.equal(
      matchAwaitsOfficialResult(
        baseMatch({
          kickoffAt: '2026-08-08T18:45:00.000Z',
          kickoffTimeConfirmed: false,
          dbStatus: 'scheduled',
        }),
        now,
      ),
      false,
    )
  })

  it('detects at least one awaiting match in a list', () => {
    assert.equal(
      hasMatchAwaitingOfficialResult(
        [
          baseMatch({
            id: 'future',
            kickoffAt: '2026-08-14T18:45:00.000Z',
            dbStatus: 'scheduled',
          }),
          baseMatch({
            id: 'stale',
            kickoffAt: '2026-08-08T18:45:00.000Z',
            dbStatus: 'scheduled',
          }),
        ],
        now,
      ),
      true,
    )
    assert.equal(
      hasMatchAwaitingOfficialResult(
        [
          baseMatch({
            kickoffAt: '2026-08-14T18:45:00.000Z',
            dbStatus: 'scheduled',
          }),
          baseMatch({
            kickoffAt: '2026-08-08T18:45:00.000Z',
            dbStatus: 'finished',
          }),
        ],
        now,
      ),
      false,
    )
  })
})

describe('SOFT_RESULT_POLL_MS', () => {
  it('uses a 30s network cadence distinct from Home 1s clock', () => {
    assert.equal(SOFT_RESULT_POLL_MS, 30_000)
    assert.match(homePage, /setInterval\(\(\) => setNow\(new Date\(\)\), 1000\)/)
    assert.match(homePage, /shouldPoll: awaitingOfficialResult/)
    assert.doesNotMatch(
      homePage,
      /setInterval\(\(\) => \{\s*setNow[\s\S]{0,80}loadPage\('soft'\)/,
    )
  })
})

describe('attachSoftPageRefresh', () => {
  it('coalesces resume events into a single flush', async () => {
    const originalWindow = globalThis.window
    const originalDocument = globalThis.document
    const listeners = new Map()

    globalThis.window = {
      addEventListener(type, handler) {
        listeners.set(type, handler)
      },
      removeEventListener(type) {
        listeners.delete(type)
      },
      setInterval() {
        return 1
      },
      clearInterval() {},
    }
    globalThis.document = {
      visibilityState: 'visible',
      addEventListener(type, handler) {
        listeners.set(type, handler)
      },
      removeEventListener(type) {
        listeners.delete(type)
      },
    }

    try {
      let flushes = 0
      const attachment = attachSoftPageRefresh({
        coalesceDelayMs: 20,
        onRefresh: () => {
          flushes += 1
        },
        shouldPoll: false,
      })

      listeners.get('focus')()
      listeners.get('pageshow')()
      listeners.get('online')()
      listeners.get('visibilitychange')()
      assert.equal(flushes, 0)

      await new Promise((resolve) => setTimeout(resolve, 40))
      assert.equal(flushes, 1)
      attachment.dispose()
    } finally {
      globalThis.window = originalWindow
      globalThis.document = originalDocument
    }
  })

  it('starts a poll interval only when shouldPoll is true', () => {
    const originalWindow = globalThis.window
    const originalDocument = globalThis.document
    let intervalMs = null
    let cleared = false

    globalThis.window = {
      addEventListener() {},
      removeEventListener() {},
      setInterval(_fn, ms) {
        intervalMs = ms
        return 42
      },
      clearInterval(id) {
        if (id === 42) cleared = true
      },
    }
    globalThis.document = {
      visibilityState: 'visible',
      addEventListener() {},
      removeEventListener() {},
    }

    try {
      const withPoll = attachSoftPageRefresh({
        onRefresh: () => {},
        shouldPoll: true,
        pollIntervalMs: SOFT_RESULT_POLL_MS,
      })
      assert.equal(intervalMs, SOFT_RESULT_POLL_MS)
      withPoll.dispose()
      assert.equal(cleared, true)

      intervalMs = null
      const withoutPoll = attachSoftPageRefresh({
        onRefresh: () => {},
        shouldPoll: false,
      })
      assert.equal(intervalMs, null)
      withoutPoll.dispose()
    } finally {
      globalThis.window = originalWindow
      globalThis.document = originalDocument
    }
  })
})

describe('runSoftPageLoad soft success replaces stale match state', () => {
  it('applies finished + score after a soft refresh without full loading', async () => {
    const events = []
    let applied = null
    const result = await runSoftPageLoad({
      mode: 'soft',
      hasExistingData: true,
      generation: 1,
      isCurrent: () => true,
      load: async () => ({
        matches: [
          {
            id: 'j1',
            dbStatus: 'finished',
            finalScore: { home: 0, away: 1 },
          },
        ],
      }),
      onFullLoading: () => events.push('full'),
      onSoftStart: () => events.push('soft'),
      onSuccess: (bundle) => {
        applied = bundle
        events.push('success')
      },
      onError: () => events.push('error'),
      onSettled: () => events.push('settled'),
    })

    assert.equal(result, 'applied')
    assert.deepEqual(events, ['soft', 'success', 'settled'])
    assert.equal(applied.matches[0].dbStatus, 'finished')
    assert.deepEqual(applied.matches[0].finalScore, { home: 0, away: 1 })
  })

  it('keeps existing data path on soft error', async () => {
    const events = []
    const result = await runSoftPageLoad({
      mode: 'soft',
      hasExistingData: true,
      generation: 1,
      isCurrent: () => true,
      load: async () => {
        throw new Error('offline')
      },
      onFullLoading: () => events.push('full'),
      onSoftStart: () => events.push('soft'),
      onSuccess: () => events.push('success'),
      onError: () => events.push('error'),
      onSettled: () => events.push('settled'),
    })

    assert.equal(result, 'failed')
    assert.deepEqual(events, ['soft', 'error', 'settled'])
  })
})

describe('page soft-refresh wiring (F5)', () => {
  it('Calendar uses attachSoftPageRefresh with conditional poll', () => {
    assert.match(calendarPage, /attachSoftPageRefresh/)
    assert.match(calendarPage, /hasMatchAwaitingOfficialResult/)
    assert.match(calendarPage, /shouldPoll: awaitingOfficialResult/)
    assert.match(calendarPage, /loadCalendarData\('soft'\)/)
    assert.match(calendarPage, /runSoftPageLoad/)
  })

  it('Home soft-refreshes on resume and polls only when result expected', () => {
    assert.match(homePage, /attachSoftPageRefresh/)
    assert.match(homePage, /hasMatchAwaitingOfficialResult/)
    assert.match(homePage, /shouldPoll: awaitingOfficialResult/)
    assert.match(homePage, /loadPage\('soft'\)/)
    assert.match(homePage, /loadHomeBundle/)
    assert.match(homePage, /runSoftPageLoad/)
    assert.match(homePage, /function retry\(\) \{\s*void loadPage\('initial'\)/)
  })

  it('Ranking soft-refreshes on resume and polls when matches await a result', () => {
    assert.match(rankingPage, /attachSoftPageRefresh/)
    assert.match(rankingPage, /hasMatchAwaitingOfficialResult/)
    assert.match(rankingPage, /shouldPoll: awaitingOfficialResult/)
    assert.match(rankingPage, /loadPage\('soft'\)/)
    assert.match(rankingPage, /loadRankingBundle/)
    assert.match(rankingPage, /runSoftPageLoad/)
    assert.match(rankingPage, /function retry\(\) \{\s*void loadPage\('initial'\)/)
  })
})

describe('createRefreshCoalescer still coalesces (F5)', () => {
  it('collapses rapid requests into one flush', async () => {
    let flushes = 0
    const coalescer = createRefreshCoalescer({
      delayMs: 15,
      onFlush: () => {
        flushes += 1
      },
    })
    coalescer.request()
    coalescer.request()
    coalescer.request()
    await new Promise((resolve) => setTimeout(resolve, 35))
    assert.equal(flushes, 1)
    coalescer.dispose()
  })
})

describe('ranking points = 0 is scored (F5 non-regression)', () => {
  it('does not treat scoredPredictions=1 and points=0 as awaiting first result', () => {
    const players = [
      {
        id: '1',
        pseudo: 'CAMILLE',
        points: 0,
        exactScores: 0,
        isActive: true,
        goodResults: 0,
        scoredPredictions: 1,
        successRate: 0,
        gapToLeader: 0,
      },
      {
        id: '2',
        pseudo: 'VINZ',
        points: 0,
        exactScores: 0,
        isActive: true,
        goodResults: 0,
        scoredPredictions: 1,
        successRate: 0,
        gapToLeader: 0,
      },
    ]
    assert.equal(isRankingAwaitingFirstResult(players), false)
    const ranks = getCompetitionRanks(players)
    const home = selectHomeRanking(players, ranks, '1')
    assert.equal(home.awaitingFirstResult, false)
    assert.equal(home.players.length > 0, true)
  })
})
