/**
 * Soft page refresh shared by Home / Calendar / Ranking:
 * resume listeners + optional result-awaiting poll, coalesced.
 */

import { createRefreshCoalescer } from './calendarRefresh.ts'
import type { Match } from '../types'

/** Cadence réseau pour un résultat attendu — distincte du tick horloge Home (1s). */
export const SOFT_RESULT_POLL_MS = 30_000

const DEFAULT_COALESCE_MS = 50

/**
 * Match dont le résultat officiel devrait bientôt arriver / être rafraîchi :
 * kickoff confirmé passé, pas encore finished, pas reporté/annulé.
 */
export function matchAwaitsOfficialResult(
  match: Pick<Match, 'kickoffAt' | 'kickoffTimeConfirmed' | 'dbStatus'>,
  now: Date,
): boolean {
  if (!match.kickoffTimeConfirmed) return false
  if (
    match.dbStatus === 'finished' ||
    match.dbStatus === 'postponed' ||
    match.dbStatus === 'cancelled'
  ) {
    return false
  }
  return now.getTime() >= new Date(match.kickoffAt).getTime()
}

export function hasMatchAwaitingOfficialResult(
  matches: ReadonlyArray<
    Pick<Match, 'kickoffAt' | 'kickoffTimeConfirmed' | 'dbStatus'>
  >,
  now: Date = new Date(),
): boolean {
  return matches.some((match) => matchAwaitsOfficialResult(match, now))
}

/**
 * Branche focus / pageshow / online / visibility + polling conditionnel
 * sur un seul coalescer (évite les rafales concurrentes).
 */
export function attachSoftPageRefresh(options: {
  onRefresh: () => void
  coalesceDelayMs?: number
  /** Si true, soft-refresh périodique (résultat attendu). */
  shouldPoll?: boolean
  pollIntervalMs?: number
}): { dispose: () => void; requestRefresh: () => void } {
  const coalescer = createRefreshCoalescer({
    delayMs: options.coalesceDelayMs ?? DEFAULT_COALESCE_MS,
    onFlush: options.onRefresh,
  })

  function requestRefresh() {
    coalescer.request()
  }

  function handleVisibility() {
    if (document.visibilityState === 'visible') requestRefresh()
  }

  window.addEventListener('focus', requestRefresh)
  window.addEventListener('pageshow', requestRefresh)
  window.addEventListener('online', requestRefresh)
  document.addEventListener('visibilitychange', handleVisibility)

  let pollTimer: ReturnType<typeof setInterval> | null = null
  if (options.shouldPoll) {
    // Premier soft fetch dès l'entrée en mode « résultat attendu »,
    // puis cadence périodique.
    requestRefresh()
    pollTimer = window.setInterval(
      requestRefresh,
      options.pollIntervalMs ?? SOFT_RESULT_POLL_MS,
    )
  }

  return {
    requestRefresh,
    dispose() {
      coalescer.dispose()
      window.removeEventListener('focus', requestRefresh)
      window.removeEventListener('pageshow', requestRefresh)
      window.removeEventListener('online', requestRefresh)
      document.removeEventListener('visibilitychange', handleVisibility)
      if (pollTimer != null) {
        window.clearInterval(pollTimer)
        pollTimer = null
      }
    },
  }
}
