import type { Match, Player } from '../types'

/**
 * Rang de type compétition (ex. 1, 1, 3) : mêmes points + mêmes exacts → même rang ;
 * sinon le rang suivant saute les places occupées (index + 1).
 * Le pseudo ne départage que l’ordre d’affichage, pas le numéro de rang.
 */
export function getCompetitionRanks(rankedPlayers: Player[]): number[] {
  const ranks: number[] = []

  rankedPlayers.forEach((player, index) => {
    if (index === 0) {
      ranks.push(1)
      return
    }

    const previous = rankedPlayers[index - 1]
    if (
      player.points === previous.points &&
      player.exactScores === previous.exactScores
    ) {
      ranks.push(ranks[index - 1])
    } else {
      ranks.push(index + 1)
    }
  })

  return ranks
}

/** @deprecated Alias — préférer getCompetitionRanks (comportement inchangé). */
export const getDenseRanks = getCompetitionRanks

/**
 * Accueil : tous les joueurs de rang ≤ 3 (ex æquo inclus), plus le joueur
 * connecté s’il est hors de cette fenêtre — sans doublon.
 */
export function selectHomeRanking(
  players: Player[],
  ranks: number[],
  activePlayerId: string,
): { players: Player[]; ranks: number[] } {
  const entries = players.map((player, index) => ({
    player,
    rank: ranks[index] ?? index + 1,
  }))
  const top = entries.filter((entry) => entry.rank <= 3)
  const active = entries.find((entry) => entry.player.id === activePlayerId)

  if (active && !top.some((entry) => entry.player.id === active.player.id)) {
    return {
      players: [...top.map((entry) => entry.player), active.player],
      ranks: [...top.map((entry) => entry.rank), active.rank],
    }
  }

  return {
    players: top.map((entry) => entry.player),
    ranks: top.map((entry) => entry.rank),
  }
}

/** Journée par défaut pour l’onglet Participation. */
export function selectDefaultRoundNumber(
  matches: Match[],
  now = new Date(),
): number | null {
  if (matches.length === 0) return null

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

  if (upcoming[0]) return upcoming[0].matchday

  return Math.max(...matches.map((match) => match.matchday))
}

export function listRoundNumbers(matches: Match[]): number[] {
  return [...new Set(matches.map((match) => match.matchday))].sort(
    (a, b) => a - b,
  )
}
