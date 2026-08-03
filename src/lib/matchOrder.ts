import type { Match } from '../types'

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

export function findNextOpenMatch(matches: Match[], now = new Date()): Match | null {
  const upcoming = matches
    .filter(
      (match) =>
        match.dbStatus === 'scheduled' &&
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
