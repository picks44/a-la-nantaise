import assert from 'node:assert/strict'
import { describe, it, mock } from 'node:test'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  REVEAL_TIMEOUT_MESSAGE,
  createRevealLoader,
  getRevealState,
  revealReducer,
  selectIdleRevealIds,
  withTimeout,
} from '../src/lib/matchGroupRevealState.ts'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')

function read(rel) {
  return readFileSync(join(root, rel), 'utf8')
}

function emptyReveal(matchId = 'match-a') {
  return {
    seasonId: 'season-1',
    matchId,
    revealed: true,
    lockedUntil: '',
    myPrediction: null,
    participants: [],
  }
}

function makeLoaderHarness(opts = {}) {
  let states = {}
  let nextId = 0
  const fetchReveal =
    opts.fetchReveal ??
    mock.fn(async (matchId) => emptyReveal(matchId))

  const loader = createRevealLoader({
    getStates: () => states,
    commit: (action) => {
      states = revealReducer(states, action)
    },
    nextRequestId: () => ++nextId,
    fetchReveal,
    toErrorMessage: (error) =>
      error instanceof Error ? error.message : String(error),
    timeoutMs: opts.timeoutMs ?? 50,
    timeoutMessage: REVEAL_TIMEOUT_MESSAGE,
  })

  return {
    get states() {
      return states
    },
    setStates(next) {
      states = next
    },
    fetchReveal,
    loader,
    get nextId() {
      return nextId
    },
  }
}

describe('revealReducer', () => {
  it('transitions idle → loading → success', () => {
    let state = revealReducer({}, { type: 'begin', matchId: 'a', requestId: 1 })
    assert.deepEqual(getRevealState(state, 'a'), {
      status: 'loading',
      requestId: 1,
    })
    const data = emptyReveal('a')
    state = revealReducer(state, {
      type: 'success',
      matchId: 'a',
      requestId: 1,
      data,
    })
    assert.equal(getRevealState(state, 'a').status, 'success')
    assert.equal(getRevealState(state, 'a').data, data)
  })

  it('keeps empty success as success (not loading)', () => {
    let state = revealReducer({}, { type: 'begin', matchId: 'a', requestId: 1 })
    const data = emptyReveal('a')
    state = revealReducer(state, {
      type: 'success',
      matchId: 'a',
      requestId: 1,
      data,
    })
    assert.equal(getRevealState(state, 'a').status, 'success')
    assert.deepEqual(getRevealState(state, 'a').data.participants, [])
  })

  it('transitions to error and leaves loading', () => {
    let state = revealReducer({}, { type: 'begin', matchId: 'a', requestId: 1 })
    state = revealReducer(state, {
      type: 'error',
      matchId: 'a',
      requestId: 1,
      error: 'boom',
    })
    assert.deepEqual(getRevealState(state, 'a'), {
      status: 'error',
      error: 'boom',
    })
  })

  it('begin is no-op when already loading or success', () => {
    let state = revealReducer({}, { type: 'begin', matchId: 'a', requestId: 1 })
    const same = revealReducer(state, {
      type: 'begin',
      matchId: 'a',
      requestId: 2,
    })
    assert.equal(same, state)
    assert.equal(getRevealState(same, 'a').requestId, 1)

    state = revealReducer(state, {
      type: 'success',
      matchId: 'a',
      requestId: 1,
      data: emptyReveal('a'),
    })
    const afterSuccess = revealReducer(state, {
      type: 'begin',
      matchId: 'a',
      requestId: 3,
    })
    assert.equal(afterSuccess, state)
  })

  it('ignores stale success and error requestIds', () => {
    let state = revealReducer({}, { type: 'begin', matchId: 'a', requestId: 5 })
    const staleSuccess = revealReducer(state, {
      type: 'success',
      matchId: 'a',
      requestId: 4,
      data: emptyReveal('a'),
    })
    assert.equal(staleSuccess, state)

    const staleError = revealReducer(state, {
      type: 'error',
      matchId: 'a',
      requestId: 4,
      error: 'old',
    })
    assert.equal(staleError, state)
  })

  it('invalidate then begin allows retry after error', () => {
    let state = revealReducer({}, { type: 'begin', matchId: 'a', requestId: 1 })
    state = revealReducer(state, {
      type: 'error',
      matchId: 'a',
      requestId: 1,
      error: 'fail',
    })
    state = revealReducer(state, { type: 'invalidate', matchId: 'a' })
    assert.equal(getRevealState(state, 'a').status, 'idle')
    state = revealReducer(state, { type: 'begin', matchId: 'a', requestId: 2 })
    state = revealReducer(state, {
      type: 'success',
      matchId: 'a',
      requestId: 2,
      data: emptyReveal('a'),
    })
    assert.equal(getRevealState(state, 'a').status, 'success')
  })

  it('keeps two match ids independent and stable', () => {
    let state = {}
    state = revealReducer(state, { type: 'begin', matchId: 'a', requestId: 1 })
    state = revealReducer(state, { type: 'begin', matchId: 'b', requestId: 2 })
    state = revealReducer(state, {
      type: 'success',
      matchId: 'a',
      requestId: 1,
      data: emptyReveal('a'),
    })
    assert.equal(getRevealState(state, 'a').status, 'success')
    assert.equal(getRevealState(state, 'b').status, 'loading')
    assert.deepEqual(selectIdleRevealIds(state, ['a', 'b', 'c']), ['c'])
  })

  it('reset clears all entries; stale success after reset is ignored', () => {
    let state = revealReducer({}, { type: 'begin', matchId: 'a', requestId: 1 })
    state = revealReducer(state, { type: 'reset' })
    assert.deepEqual(state, {})
    const ignored = revealReducer(state, {
      type: 'success',
      matchId: 'a',
      requestId: 1,
      data: emptyReveal('a'),
    })
    assert.deepEqual(ignored, {})
  })
})

describe('withTimeout', () => {
  it('resolves and clears its timer', async () => {
    const value = await withTimeout(Promise.resolve(42), 100, 'timeout')
    assert.equal(value, 42)
  })

  it('rejects with the timeout message', async () => {
    await assert.rejects(
      () =>
        withTimeout(
          new Promise(() => {}),
          20,
          REVEAL_TIMEOUT_MESSAGE,
        ),
      (error) =>
        error instanceof Error && error.message === REVEAL_TIMEOUT_MESSAGE,
    )
  })
})

describe('createRevealLoader', () => {
  it('issues a single RPC for two synchronous loadReveal calls', async () => {
    let resolveFetch
    const fetchReveal = mock.fn(
      () =>
        new Promise((resolve) => {
          resolveFetch = resolve
        }),
    )
    const harness = makeLoaderHarness({ fetchReveal })

    const p1 = harness.loader.loadReveal('a')
    const p2 = harness.loader.loadReveal('a')
    assert.equal(fetchReveal.mock.callCount(), 1)
    assert.equal(getRevealState(harness.states, 'a').status, 'loading')

    resolveFetch(emptyReveal('a'))
    await Promise.all([p1, p2])
    assert.equal(getRevealState(harness.states, 'a').status, 'success')
    assert.equal(fetchReveal.mock.callCount(), 1)
  })

  it('reuses success cache without refetch', async () => {
    const harness = makeLoaderHarness()
    await harness.loader.loadReveal('a')
    await harness.loader.loadReveal('a')
    assert.equal(harness.fetchReveal.mock.callCount(), 1)
  })

  it('timeout then late success is ignored', async () => {
    let resolveLate
    const fetchReveal = mock.fn(
      () =>
        new Promise((resolve) => {
          resolveLate = resolve
        }),
    )
    const harness = makeLoaderHarness({ fetchReveal, timeoutMs: 20 })

    await harness.loader.loadReveal('a')
    assert.equal(getRevealState(harness.states, 'a').status, 'error')
    assert.equal(
      getRevealState(harness.states, 'a').error,
      REVEAL_TIMEOUT_MESSAGE,
    )

    resolveLate(emptyReveal('a'))
    await Promise.resolve()
    await Promise.resolve()
    assert.equal(getRevealState(harness.states, 'a').status, 'error')
  })

  it('timeout then retry succeeds with a new requestId', async () => {
    let call = 0
    let resolveSecond
    const fetchReveal = mock.fn(() => {
      call += 1
      if (call === 1) {
        return new Promise(() => {})
      }
      return new Promise((resolve) => {
        resolveSecond = resolve
      })
    })
    const harness = makeLoaderHarness({ fetchReveal, timeoutMs: 20 })

    await harness.loader.loadReveal('a')
    assert.equal(getRevealState(harness.states, 'a').status, 'error')

    harness.loader.retryReveal('a')
    await Promise.resolve()
    assert.equal(getRevealState(harness.states, 'a').status, 'loading')
    assert.equal(harness.loader.getInFlightRequestId('a'), 2)

    resolveSecond(emptyReveal('a'))
    await new Promise((r) => setTimeout(r, 0))
    assert.equal(getRevealState(harness.states, 'a').status, 'success')
  })

  it('refuses retry while a request is still in flight', async () => {
    let resolveFetch
    const fetchReveal = mock.fn(
      () =>
        new Promise((resolve) => {
          resolveFetch = resolve
        }),
    )
    const harness = makeLoaderHarness({ fetchReveal })

    const pending = harness.loader.loadReveal('a')
    assert.equal(getRevealState(harness.states, 'a').status, 'loading')
    harness.loader.retryReveal('a')
    assert.equal(fetchReveal.mock.callCount(), 1)
    assert.equal(getRevealState(harness.states, 'a').status, 'loading')

    resolveFetch(emptyReveal('a'))
    await pending
    assert.equal(getRevealState(harness.states, 'a').status, 'success')
  })

  it('reset clears lock; old finally does not drop the new lock', async () => {
    let resolveFirst
    let resolveSecond
    let call = 0
    const fetchReveal = mock.fn(() => {
      call += 1
      if (call === 1) {
        return new Promise((resolve) => {
          resolveFirst = resolve
        })
      }
      return new Promise((resolve) => {
        resolveSecond = resolve
      })
    })
    const harness = makeLoaderHarness({ fetchReveal })

    const first = harness.loader.loadReveal('a')
    const firstRequestId = harness.loader.getInFlightRequestId('a')
    assert.equal(firstRequestId, 1)

    harness.setStates(revealReducer(harness.states, { type: 'reset' }))
    harness.loader.resetInFlight()

    const second = harness.loader.loadReveal('a')
    assert.equal(harness.loader.getInFlightRequestId('a'), 2)
    assert.equal(getRevealState(harness.states, 'a').status, 'loading')
    assert.equal(getRevealState(harness.states, 'a').requestId, 2)

    resolveFirst(emptyReveal('a'))
    await first
    assert.equal(harness.loader.getInFlightRequestId('a'), 2)
    assert.equal(getRevealState(harness.states, 'a').status, 'loading')

    resolveSecond(emptyReveal('a'))
    await second
    assert.equal(getRevealState(harness.states, 'a').status, 'success')
    assert.equal(harness.loader.getInFlightRequestId('a'), undefined)
  })

  it('retry from error launches a new RPC immediately', async () => {
    let call = 0
    const fetchReveal = mock.fn(async (matchId) => {
      call += 1
      if (call === 1) {
        throw new Error('network')
      }
      return emptyReveal(matchId)
    })
    const harness = makeLoaderHarness({ fetchReveal })

    await harness.loader.loadReveal('a')
    assert.equal(getRevealState(harness.states, 'a').status, 'error')

    harness.loader.retryReveal('a')
    await new Promise((r) => setTimeout(r, 0))
    assert.equal(call, 2)
    assert.equal(getRevealState(harness.states, 'a').status, 'success')
  })
})

describe('CalendarPage / MatchListItem reveal wiring', () => {
  const calendar = read('src/pages/CalendarPage.tsx')
  const item = read('src/components/MatchListItem.tsx')

  it('uses createRevealLoader and does not cancel loading on effect cleanup', () => {
    assert.match(calendar, /createRevealLoader/)
    assert.match(calendar, /retryReveal/)
    assert.match(calendar, /resetInFlight/)
    assert.doesNotMatch(calendar, /revealLoadingIds/)
    assert.doesNotMatch(calendar, /if \(!cancelled\) \{\s*setRevealLoadingIds/)
    assert.doesNotMatch(
      calendar,
      /}, \[revealableMatchIds, reveals, season\?\.id, sessionToken\]\)/,
    )
  })

  it('retries via invalidate + force load, not cache delete alone', () => {
    assert.match(calendar, /revealLoader\.retryReveal/)
    assert.doesNotMatch(
      calendar,
      /onRetryReveal=\{\(\) => \{\s*setRevealErrors/,
    )
  })

  it('shows loading only when no reveal data is available', () => {
    assert.match(item, /loading && !reveal/)
  })
})
