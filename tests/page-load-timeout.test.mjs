import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, it } from 'node:test'

import { ApiError, toUserMessage } from '../src/lib/errors.ts'
import {
  PAGE_LOAD_TIMEOUT_CODE,
  PAGE_LOAD_TIMEOUT_MS,
  shouldOpenDetailsForDeepLink,
  withPageLoadTimeout,
} from '../src/lib/pageLoadTimeout.ts'
import { loadRankingBundle } from '../src/lib/pageLoad.ts'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const calendarPage = readFileSync(
  join(root, 'src/pages/CalendarPage.tsx'),
  'utf8',
)
const pageLoad = readFileSync(join(root, 'src/lib/pageLoad.ts'), 'utf8')

describe('withPageLoadTimeout', () => {
  it('resolves when the promise settles in time', async () => {
    const value = await withPageLoadTimeout(Promise.resolve(7))
    assert.equal(value, 7)
  })

  it('rejects with LOAD_TIMEOUT ApiError when the promise hangs', async () => {
    await assert.rejects(
      () =>
        withPageLoadTimeout(
          new Promise(() => {
            /* never settles */
          }),
          40,
        ),
      (error) => {
        assert.ok(error instanceof ApiError)
        assert.equal(error.code, PAGE_LOAD_TIMEOUT_CODE)
        assert.equal(
          toUserMessage(error),
          'Délai dépassé. Vérifie ta connexion et réessaie.',
        )
        return true
      },
    )
  })

  it('exposes a finite timeout budget for page reads', () => {
    assert.equal(PAGE_LOAD_TIMEOUT_MS, 20_000)
  })
})

describe('loadRankingBundle timeout wiring', () => {
  it('wraps ranking loads with withPageLoadTimeout', () => {
    assert.match(pageLoad, /withPageLoadTimeout/)
    assert.match(pageLoad, /loadRankingBundle/)
    assert.match(pageLoad, /loadHomeBundle/)
    assert.match(pageLoad, /loadCalendarBundle/)
  })

  it('still fails before ranking when season rejects', async () => {
    await assert.rejects(
      () =>
        loadRankingBundle({
          sessionToken: 'tok',
          fetchActiveSeason: async () => {
            throw new Error('season down')
          },
          fetchLiveSeasonRanking: async () => [],
          fetchMatches: async () => [],
        }),
      /season down/,
    )
  })
})

describe('shouldOpenDetailsForDeepLink', () => {
  it('opens finished and locked matches', () => {
    assert.equal(
      shouldOpenDetailsForDeepLink({
        matchFound: true,
        uiStatus: 'finished',
        isNextOpen: false,
      }),
      true,
    )
    assert.equal(
      shouldOpenDetailsForDeepLink({
        matchFound: true,
        uiStatus: 'locked',
        isNextOpen: false,
      }),
      true,
    )
  })

  it('does not force-open the next open match or compact futures', () => {
    assert.equal(
      shouldOpenDetailsForDeepLink({
        matchFound: true,
        uiStatus: 'to_predict',
        isNextOpen: true,
      }),
      false,
    )
    assert.equal(
      shouldOpenDetailsForDeepLink({
        matchFound: true,
        uiStatus: 'to_predict',
        isNextOpen: false,
      }),
      false,
    )
  })

  it('is a no-op for unknown matches', () => {
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

describe('Calendar deep-link wiring (A2b)', () => {
  it('opens details for finished/locked deep-links and still scrolls', () => {
    assert.match(calendarPage, /shouldOpenDetailsForDeepLink/)
    assert.match(calendarPage, /scrollIntoView/)
    assert.match(calendarPage, /setDetailsOpenById/)
  })
})
