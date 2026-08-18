import type { Match } from '../types'
import {
  classifyMatchPhase,
  matchAwaitsOfficialResult,
} from './matchLifecycle.ts'

/** Ordre liste calendrier / admin : journée → coup d’envoi → id. */
export function compareMatchesForList(
  a: Pick<Match, 'id' | 'matchday' | 'kickoffAt'>,
  b: Pick<Match, 'id' | 'matchday' | 'kickoffAt'>,
): number {
  if (a.matchday !== b.matchday) return a.matchday - b.matchday

  const kickoffDelta =
    new Date(a.kickoffAt).getTime() - new Date(b.kickoffAt).getTime()
  if (kickoffDelta !== 0) return kickoffDelta

  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0
}

export function sortMatchesForList<
  T extends Pick<Match, 'id' | 'matchday' | 'kickoffAt'>,
>(matches: T[]): T[] {
  return [...matches].sort(compareMatchesForList)
}

function pickLatestKickoff<T extends Pick<Match, 'kickoffAt'>>(
  matches: ReadonlyArray<T>,
): T | null {
  if (matches.length === 0) return null
  return [...matches].sort(
    (a, b) =>
      new Date(b.kickoffAt).getTime() - new Date(a.kickoffAt).getTime(),
  )[0] ?? null
}

export function findNextOpenMatch(matches: Match[], now = new Date()): Match | null {
  const upcoming = matches
    .filter(
      (match) =>
        match.dbStatus === 'scheduled' &&
        match.kickoffTimeConfirmed === true &&
        new Date(match.kickoffAt).getTime() > now.getTime(),
    )
    .sort(
      (a, b) =>
        new Date(a.kickoffAt).getTime() - new Date(b.kickoffAt).getTime(),
    )

  return upcoming[0] ?? null
}

export function findLastFinishedMatch(matches: Match[]): Match | null {
  const finished = matches
    .filter((match) => match.dbStatus === 'finished' && match.finalScore)
    .sort(
      (a, b) =>
        new Date(b.kickoffAt).getTime() - new Date(a.kickoffAt).getTime(),
    )

  return finished[0] ?? null
}

export function findLiveMatch<
  T extends Pick<Match, 'id' | 'kickoffAt' | 'kickoffTimeConfirmed' | 'dbStatus'>,
>(matches: ReadonlyArray<T>, now: Date = new Date()): T | null {
  return pickLatestKickoff(
    matches.filter((match) => classifyMatchPhase(match, now) === 'live'),
  )
}

export function findAwaitingResultMatch<
  T extends Pick<Match, 'id' | 'kickoffAt' | 'kickoffTimeConfirmed' | 'dbStatus'>,
>(matches: ReadonlyArray<T>, now: Date = new Date()): T | null {
  return pickLatestKickoff(
    matches.filter(
      (match) => classifyMatchPhase(match, now) === 'awaiting_result',
    ),
  )
}

/**
 * Match dont les pronos du groupe sont consultables post-kickoff (CTA Home).
 * Réutilise `matchAwaitsOfficialResult` ; si plusieurs, le kickoff le plus récent.
 * Indépendant de `findNextOpenMatch` (qui exclut tout kickoff passé).
 */
export function findHomeGroupRevealMatch<
  T extends Pick<Match, 'id' | 'kickoffAt' | 'kickoffTimeConfirmed' | 'dbStatus'>,
>(matches: ReadonlyArray<T>, now: Date = new Date()): T | null {
  return pickLatestKickoff(
    matches.filter((match) => matchAwaitsOfficialResult(match, now)),
  )
}

/**
 * Carte principale Home :
 * 1. match réellement en cours
 * 2. prochain match ouvert
 * 3. résultat en attente (si aucun prochain ouvert)
 */
export function selectHomePrimaryMatch(
  matches: Match[],
  now: Date = new Date(),
): Match | null {
  return (
    findLiveMatch(matches, now) ??
    findNextOpenMatch(matches, now) ??
    findAwaitingResultMatch(matches, now)
  )
}

/**
 * Surface secondaire Home : reveal / résultat en attente, distinct du primary.
 */
export function findHomePendingResultMatch<
  T extends Pick<Match, 'id' | 'kickoffAt' | 'kickoffTimeConfirmed' | 'dbStatus'>,
>(
  matches: ReadonlyArray<T>,
  primaryId: string | null,
  now: Date = new Date(),
): T | null {
  const reveal = findHomeGroupRevealMatch(matches, now)
  if (!reveal) return null
  if (primaryId && reveal.id === primaryId) return null
  return reveal
}

/**
 * Affiche « Aller au prochain match » seulement si ce match n’est pas
 * déjà le premier de la liste ordonnée (ex. des terminés le précèdent).
 */
export function shouldShowJumpToNextMatch(
  orderedMatchIds: readonly string[],
  nextOpenId: string | null,
): boolean {
  if (!nextOpenId) return false
  const index = orderedMatchIds.indexOf(nextOpenId)
  return index > 0
}
