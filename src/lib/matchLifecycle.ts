import type { Match } from '../types'

/**
 * Fenêtre métier « match en cours » :
 * 90’ de jeu + mi-temps + arrêts + marge retard/VAR.
 * Ligue 2 championnat : pas de prolongations.
 * Distinct du seuil technique SQL de sync résultat (105 min).
 */
export const MATCH_LIVE_WINDOW_MS = 150 * 60 * 1000

/**
 * Après la fenêtre live, le score reste plausible le soir même.
 * Au-delà : plus de poll réseau (refresh au focus uniquement).
 */
export const MATCH_RESULT_POLL_GRACE_MS = 6 * 60 * 60 * 1000

/** Seuil SQL `fixture_result_sync_is_needed` : kickoff + 105 minutes. */
export const RESULT_SYNC_MIN_ELAPSED_MS = 105 * 60 * 1000

export const STALE_FIXTURE_SYNC_MS = 36 * 60 * 60 * 1000

export type MatchPhase =
  | 'unconfirmed'
  | 'postponed'
  | 'cancelled'
  | 'finished'
  | 'upcoming'
  | 'live'
  | 'awaiting_result'

export type MatchLifecycleInput = Pick<
  Match,
  'kickoffAt' | 'kickoffTimeConfirmed' | 'dbStatus'
>

export function classifyMatchPhase(
  match: MatchLifecycleInput,
  now: Date = new Date(),
): MatchPhase {
  if (match.dbStatus === 'postponed') return 'postponed'
  if (match.dbStatus === 'cancelled') return 'cancelled'
  if (match.dbStatus === 'finished') return 'finished'
  if (!match.kickoffTimeConfirmed) return 'unconfirmed'

  const kickoffMs = new Date(match.kickoffAt).getTime()
  const nowMs = now.getTime()
  if (nowMs < kickoffMs) return 'upcoming'
  if (nowMs < kickoffMs + MATCH_LIVE_WINDOW_MS) return 'live'
  return 'awaiting_result'
}

export function matchIsLive(
  match: MatchLifecycleInput,
  now: Date = new Date(),
): boolean {
  return classifyMatchPhase(match, now) === 'live'
}

export function matchIsStaleAwaiting(
  match: MatchLifecycleInput,
  now: Date = new Date(),
): boolean {
  return classifyMatchPhase(match, now) === 'awaiting_result'
}

/**
 * Kickoff confirmé passé, pas encore finished / reporté / annulé.
 * Couvre les phases `live` et `awaiting_result`.
 */
export function matchAwaitsOfficialResult(
  match: MatchLifecycleInput,
  now: Date,
): boolean {
  const phase = classifyMatchPhase(match, now)
  return phase === 'live' || phase === 'awaiting_result'
}

export function hasMatchAwaitingOfficialResult(
  matches: ReadonlyArray<MatchLifecycleInput>,
  now: Date = new Date(),
): boolean {
  return matches.some((match) => matchAwaitsOfficialResult(match, now))
}

export function shouldPollForOfficialResult(
  matches: ReadonlyArray<MatchLifecycleInput>,
  now: Date = new Date(),
): boolean {
  const pollUntilOffset = MATCH_LIVE_WINDOW_MS + MATCH_RESULT_POLL_GRACE_MS
  return matches.some((match) => {
    if (!matchAwaitsOfficialResult(match, now)) return false
    return now.getTime() < new Date(match.kickoffAt).getTime() + pollUntilOffset
  })
}

export function matchPhaseHeadline(phase: MatchPhase): string {
  if (phase === 'live') return 'Match en cours'
  if (phase === 'awaiting_result') return 'Résultat en attente'
  if (phase === 'finished') return 'Terminé'
  if (phase === 'postponed') return 'Reporté'
  if (phase === 'cancelled') return 'Annulé'
  if (phase === 'unconfirmed') return 'Horaire à confirmer'
  return 'À venir'
}

export function hasMatchNeedingResultSync(
  matches: ReadonlyArray<MatchLifecycleInput>,
  now: Date = new Date(),
): boolean {
  return matches.some((match) => {
    if (!match.kickoffTimeConfirmed) return false
    if (
      match.dbStatus === 'finished' ||
      match.dbStatus === 'postponed' ||
      match.dbStatus === 'cancelled'
    ) {
      return false
    }
    return (
      now.getTime() >=
      new Date(match.kickoffAt).getTime() + RESULT_SYNC_MIN_ELAPSED_MS
    )
  })
}

export function isFixtureSyncStale(
  lastSyncedAt: string | null | undefined,
  now: Date = new Date(),
): boolean {
  if (!lastSyncedAt) return true
  const syncedMs = new Date(lastSyncedAt).getTime()
  if (Number.isNaN(syncedMs)) return true
  return now.getTime() - syncedMs > STALE_FIXTURE_SYNC_MS
}

export function shouldShowFixtureSyncHealthAlert(input: {
  lastSyncedAt: string | null | undefined
  lastAttemptOk: boolean | null | undefined
  matches: ReadonlyArray<MatchLifecycleInput>
  now?: Date
}): boolean {
  const now = input.now ?? new Date()
  if (input.lastAttemptOk === false) return true
  if (!hasMatchNeedingResultSync(input.matches, now)) return false
  return isFixtureSyncStale(input.lastSyncedAt, now)
}
