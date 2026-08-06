/**
 * Shared page-load helpers: full data bundles + single-flight guard for retries.
 * Keeps mount and retry on the same path without depending on prior season state.
 */

import { withPageLoadTimeout } from './pageLoadTimeout.ts'

export function createInFlightGuard() {
  let runId = 0
  let inFlight = false

  return {
    get busy() {
      return inFlight
    },
    reset() {
      runId += 1
      inFlight = false
    },
    async run<T>(task: () => Promise<T>): Promise<T | undefined> {
      if (inFlight) return undefined
      const myId = ++runId
      inFlight = true
      try {
        return await task()
      } finally {
        if (myId === runId) {
          inFlight = false
        }
      }
    },
  }
}

export async function loadRankingBundle(input: {
  sessionToken: string
  fetchActiveSeason: (sessionToken: string) => Promise<{ id: string }>
  fetchLiveSeasonRanking: (input: {
    sessionToken: string
    seasonId: string
  }) => Promise<unknown>
  fetchMatches: (sessionToken: string) => Promise<unknown>
}): Promise<{
  season: { id: string }
  ranking: unknown
  matches: unknown
}> {
  return withPageLoadTimeout(
    (async () => {
      const season = await input.fetchActiveSeason(input.sessionToken)
      const [ranking, matches] = await Promise.all([
        input.fetchLiveSeasonRanking({
          sessionToken: input.sessionToken,
          seasonId: season.id,
        }),
        input.fetchMatches(input.sessionToken),
      ])
      return { season, ranking, matches }
    })(),
  )
}

export async function loadHomeBundle(input: {
  sessionToken: string
  fetchActiveSeason: (sessionToken: string) => Promise<{ id: string }>
  fetchMatches: (sessionToken: string) => Promise<unknown>
  fetchMyPredictions: (sessionToken: string) => Promise<unknown>
  fetchLiveSeasonRanking: (input: {
    sessionToken: string
    seasonId: string
  }) => Promise<unknown>
}): Promise<{
  season: { id: string }
  matches: unknown
  predictions: unknown
  ranking: unknown
}> {
  return withPageLoadTimeout(
    (async () => {
      const season = await input.fetchActiveSeason(input.sessionToken)
      const [matches, predictions, ranking] = await Promise.all([
        input.fetchMatches(input.sessionToken),
        input.fetchMyPredictions(input.sessionToken),
        input.fetchLiveSeasonRanking({
          sessionToken: input.sessionToken,
          seasonId: season.id,
        }),
      ])
      return { season, matches, predictions, ranking }
    })(),
  )
}

export async function loadCalendarBundle(input: {
  sessionToken: string
  fetchActiveSeason: (sessionToken: string) => Promise<unknown>
  fetchMatches: (sessionToken: string) => Promise<unknown>
  fetchMyPredictions: (sessionToken: string) => Promise<unknown>
}): Promise<{
  season: unknown
  matches: unknown
  predictions: unknown
}> {
  return withPageLoadTimeout(
    (async () => {
      const [season, matches, predictions] = await Promise.all([
        input.fetchActiveSeason(input.sessionToken),
        input.fetchMatches(input.sessionToken),
        input.fetchMyPredictions(input.sessionToken),
      ])
      return { season, matches, predictions }
    })(),
  )
}

/** Distinguishes recap UI states without treating errors as empty data. */
export type RecapViewState =
  | { status: 'idle' }
  | { status: 'loading' }
  | { status: 'success'; recap: unknown }
  | { status: 'empty' }
  | { status: 'error'; message: string }

export function resolveRecapViewState(input: {
  loading: boolean
  error: string | null
  recap: unknown | null
  hasReferenceRound: boolean
}): RecapViewState {
  if (!input.hasReferenceRound) return { status: 'idle' }
  if (input.loading) return { status: 'loading' }
  if (input.error) return { status: 'error', message: input.error }
  if (input.recap) return { status: 'success', recap: input.recap }
  return { status: 'empty' }
}
