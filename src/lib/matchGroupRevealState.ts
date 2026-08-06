import type { MatchGroupReveal } from '../types'

export type RevealState =
  | { status: 'idle' }
  | { status: 'loading'; requestId: number }
  | { status: 'success'; data: MatchGroupReveal }
  | { status: 'error'; error: string }

export type RevealStateByMatchId = Record<string, RevealState>

export type RevealAction =
  | { type: 'begin'; matchId: string; requestId: number }
  | {
      type: 'success'
      matchId: string
      requestId: number
      data: MatchGroupReveal
    }
  | { type: 'error'; matchId: string; requestId: number; error: string }
  | { type: 'invalidate'; matchId: string }
  | { type: 'reset' }

export const REVEAL_TIMEOUT_MS = 15_000

export const REVEAL_TIMEOUT_MESSAGE =
  'Impossible de charger les pronostics du groupe.'

export function getRevealState(
  states: RevealStateByMatchId,
  matchId: string,
): RevealState {
  return states[matchId] ?? { status: 'idle' }
}

/** Ids encore à charger (idle uniquement — pas error/loading/success). */
export function selectIdleRevealIds(
  states: RevealStateByMatchId,
  matchIds: readonly string[],
): string[] {
  return matchIds.filter(
    (matchId) => getRevealState(states, matchId).status === 'idle',
  )
}

/**
 * Pure reducer. `requestId` must be supplied by the caller (e.g. useRef counter);
 * never generate IDs inside this function.
 */
export function revealReducer(
  state: RevealStateByMatchId,
  action: RevealAction,
): RevealStateByMatchId {
  switch (action.type) {
    case 'begin': {
      const current = getRevealState(state, action.matchId)
      if (current.status === 'loading' || current.status === 'success') {
        return state
      }
      return {
        ...state,
        [action.matchId]: { status: 'loading', requestId: action.requestId },
      }
    }
    case 'success': {
      const current = getRevealState(state, action.matchId)
      if (
        current.status !== 'loading' ||
        current.requestId !== action.requestId
      ) {
        return state
      }
      return {
        ...state,
        [action.matchId]: { status: 'success', data: action.data },
      }
    }
    case 'error': {
      const current = getRevealState(state, action.matchId)
      if (
        current.status !== 'loading' ||
        current.requestId !== action.requestId
      ) {
        return state
      }
      return {
        ...state,
        [action.matchId]: { status: 'error', error: action.error },
      }
    }
    case 'invalidate': {
      if (!Object.prototype.hasOwnProperty.call(state, action.matchId)) {
        return state
      }
      const next = { ...state }
      delete next[action.matchId]
      return next
    }
    case 'reset':
      return {}
    default:
      return state
  }
}

/**
 * Race `promise` against a timeout. Always clears the timer on settle
 * so abandoned timers do not linger.
 */
export function withTimeout<T>(
  promise: Promise<T>,
  timeoutMs: number,
  message: string,
): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new Error(message))
    }, timeoutMs)

    promise.then(
      (value) => {
        clearTimeout(timer)
        resolve(value)
      },
      (error: unknown) => {
        clearTimeout(timer)
        reject(error)
      },
    )
  })
}

export interface RevealLoaderOptions {
  getStates: () => RevealStateByMatchId
  /** Apply action to the authoritative mirror (and React if wired). */
  commit: (action: RevealAction) => void
  nextRequestId: () => number
  fetchReveal: (matchId: string) => Promise<MatchGroupReveal>
  toErrorMessage: (error: unknown) => string
  timeoutMs?: number
  timeoutMessage?: string
}

/**
 * Imperative loader with a matchId→requestId map lock so two sync
 * loadReveal(id) calls issue a single RPC.
 */
export function createRevealLoader(options: RevealLoaderOptions) {
  const inFlight = new Map<string, number>()
  const timeoutMs = options.timeoutMs ?? REVEAL_TIMEOUT_MS
  const timeoutMessage = options.timeoutMessage ?? REVEAL_TIMEOUT_MESSAGE

  async function loadReveal(
    matchId: string,
    loadOptions?: { force?: boolean },
  ): Promise<void> {
    const force = Boolean(loadOptions?.force)
    if (inFlight.has(matchId)) {
      return
    }

    const current = getRevealState(options.getStates(), matchId)
    if (!force && (current.status === 'loading' || current.status === 'success')) {
      return
    }
    if (force && current.status === 'loading') {
      return
    }

    const requestId = options.nextRequestId()
    inFlight.set(matchId, requestId)
    options.commit({ type: 'begin', matchId, requestId })

    const afterBegin = getRevealState(options.getStates(), matchId)
    if (
      afterBegin.status !== 'loading' ||
      afterBegin.requestId !== requestId
    ) {
      if (inFlight.get(matchId) === requestId) {
        inFlight.delete(matchId)
      }
      return
    }

    try {
      const data = await withTimeout(
        options.fetchReveal(matchId),
        timeoutMs,
        timeoutMessage,
      )
      options.commit({ type: 'success', matchId, requestId, data })
    } catch (error) {
      options.commit({
        type: 'error',
        matchId,
        requestId,
        error: options.toErrorMessage(error),
      })
    } finally {
      if (inFlight.get(matchId) === requestId) {
        inFlight.delete(matchId)
      }
    }
  }

  function retryReveal(matchId: string): void {
    if (inFlight.has(matchId)) {
      return
    }
    options.commit({ type: 'invalidate', matchId })
    void loadReveal(matchId, { force: true })
  }

  function resetInFlight(): void {
    inFlight.clear()
  }

  function getInFlightRequestId(matchId: string): number | undefined {
    return inFlight.get(matchId)
  }

  return {
    loadReveal,
    retryReveal,
    resetInFlight,
    getInFlightRequestId,
  }
}
