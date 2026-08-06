import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, it } from 'node:test'

import {
  createInFlightGuard,
  loadCalendarBundle,
  loadHomeBundle,
  loadRankingBundle,
  resolveRecapViewState,
} from '../src/lib/pageLoad.ts'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const rankingPage = readFileSync(
  join(root, 'src/pages/RankingPage.tsx'),
  'utf8',
)
const homePage = readFileSync(join(root, 'src/pages/HomePage.tsx'), 'utf8')
const calendarPage = readFileSync(
  join(root, 'src/pages/CalendarPage.tsx'),
  'utf8',
)

describe('createInFlightGuard', () => {
  it('runs a single task and ignores overlapping calls', async () => {
    const guard = createInFlightGuard()
    let started = 0
    let finished = 0

    const slow = () =>
      new Promise((resolve) => {
        started += 1
        setTimeout(() => {
          finished += 1
          resolve('ok')
        }, 30)
      })

    const first = guard.run(slow)
    const second = guard.run(slow)
    const [a, b] = await Promise.all([first, second])

    assert.equal(a, 'ok')
    assert.equal(b, undefined)
    assert.equal(started, 1)
    assert.equal(finished, 1)

    const third = await guard.run(slow)
    assert.equal(third, 'ok')
    assert.equal(started, 2)
    assert.equal(finished, 2)
  })

  it('reset allows a new task after an abandoned in-flight run', async () => {
    const guard = createInFlightGuard()
    let resolveFirst
    const firstPromise = guard.run(
      () =>
        new Promise((resolve) => {
          resolveFirst = resolve
        }),
    )
    assert.equal(guard.busy, true)
    guard.reset()
    assert.equal(guard.busy, false)
    const second = await guard.run(async () => 'second')
    assert.equal(second, 'second')
    resolveFirst('first')
    assert.equal(await firstPromise, 'first')
  })
})

describe('loadRankingBundle', () => {
  it('fails before ranking/matches when season fetch rejects', async () => {
    let rankingCalls = 0
    let matchCalls = 0

    await assert.rejects(
      () =>
        loadRankingBundle({
          sessionToken: 'tok',
          fetchActiveSeason: async () => {
            throw new Error('season down')
          },
          fetchLiveSeasonRanking: async () => {
            rankingCalls += 1
            return []
          },
          fetchMatches: async () => {
            matchCalls += 1
            return []
          },
        }),
      /season down/,
    )

    assert.equal(rankingCalls, 0)
    assert.equal(matchCalls, 0)
  })

  it('loads season then ranking and matches on the same path', async () => {
    const calls = []
    const result = await loadRankingBundle({
      sessionToken: 'tok',
      fetchActiveSeason: async (token) => {
        calls.push(`season:${token}`)
        return { id: 'season-1' }
      },
      fetchLiveSeasonRanking: async ({ sessionToken, seasonId }) => {
        calls.push(`ranking:${sessionToken}:${seasonId}`)
        return [{ id: 'p1' }]
      },
      fetchMatches: async (token) => {
        calls.push(`matches:${token}`)
        return [{ id: 'm1' }]
      },
    })

    assert.deepEqual(result, {
      season: { id: 'season-1' },
      ranking: [{ id: 'p1' }],
      matches: [{ id: 'm1' }],
    })
    assert.deepEqual(calls, [
      'season:tok',
      'ranking:tok:season-1',
      'matches:tok',
    ])
  })
})

describe('loadHomeBundle / loadCalendarBundle', () => {
  it('loads home core data after season', async () => {
    const result = await loadHomeBundle({
      sessionToken: 'tok',
      fetchActiveSeason: async () => ({ id: 's1' }),
      fetchMatches: async () => ['m'],
      fetchMyPredictions: async () => ['p'],
      fetchLiveSeasonRanking: async () => ['r'],
    })
    assert.deepEqual(result, {
      season: { id: 's1' },
      matches: ['m'],
      predictions: ['p'],
      ranking: ['r'],
    })
  })

  it('loads calendar core data in parallel', async () => {
    const result = await loadCalendarBundle({
      sessionToken: 'tok',
      fetchActiveSeason: async () => ({ id: 's1' }),
      fetchMatches: async () => ['m'],
      fetchMyPredictions: async () => ['p'],
    })
    assert.deepEqual(result, {
      season: { id: 's1' },
      matches: ['m'],
      predictions: ['p'],
    })
  })
})

describe('resolveRecapViewState', () => {
  it('distinguishes loading, error, success, empty and idle', () => {
    assert.equal(
      resolveRecapViewState({
        loading: false,
        error: null,
        recap: null,
        hasReferenceRound: false,
      }).status,
      'idle',
    )
    assert.equal(
      resolveRecapViewState({
        loading: true,
        error: null,
        recap: null,
        hasReferenceRound: true,
      }).status,
      'loading',
    )
    assert.deepEqual(
      resolveRecapViewState({
        loading: false,
        error: 'boom',
        recap: null,
        hasReferenceRound: true,
      }),
      { status: 'error', message: 'boom' },
    )
    assert.deepEqual(
      resolveRecapViewState({
        loading: false,
        error: null,
        recap: { roundNumber: 3 },
        hasReferenceRound: true,
      }),
      { status: 'success', recap: { roundNumber: 3 } },
    )
    assert.equal(
      resolveRecapViewState({
        loading: false,
        error: null,
        recap: null,
        hasReferenceRound: true,
      }).status,
      'empty',
    )
  })
})

describe('page wiring (A1a)', () => {
  it('Ranking retry uses loadRankingBundle and does not gate on season?.id', () => {
    assert.match(rankingPage, /loadRankingBundle/)
    assert.match(rankingPage, /createInFlightGuard/)
    assert.match(rankingPage, /function retry\(\) \{\s*void loadPage\(\)/)
    assert.doesNotMatch(
      rankingPage,
      /function retry\(\) \{\s*if \(!sessionToken \|\| !season\?\.id\) return/,
    )
    assert.match(rankingPage, /recapError/)
    assert.match(rankingPage, /resolveRecapViewState/)
    assert.match(rankingPage, /Réessayer le récap/)
  })

  it('Home and Calendar expose a real retry on the same load path', () => {
    assert.match(homePage, /loadHomeBundle/)
    assert.match(homePage, /createInFlightGuard/)
    assert.match(homePage, /function retry\(\) \{\s*void loadPage\(\)/)
    assert.match(homePage, /Réessayer/)

    assert.match(calendarPage, /loadCalendarBundle/)
    assert.match(calendarPage, /createInFlightGuard/)
    assert.match(calendarPage, /function retryInitial\(\)/)
    assert.match(calendarPage, /onClick=\{retryInitial\}/)
  })
})
