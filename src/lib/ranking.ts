import type { Match, Player, RoundParticipationRow } from '../types'

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

/** Aucun pronostic noté et total de points nul pour tout le monde. */
export function isRankingAwaitingFirstResult(players: Player[]): boolean {
  if (players.length === 0) return false
  return players.every(
    (player) => player.scoredPredictions === 0 && player.points === 0,
  )
}

export interface HomeRankingSelection {
  players: Player[]
  ranks: number[]
  awaitingFirstResult: boolean
  participantCount: number
}

/**
 * Accueil : tous les joueurs de rang ≤ 3 (ex æquo inclus), plus le joueur
 * connecté s’il est hors de cette fenêtre — sans doublon.
 * Avant le premier résultat noté : liste vide + drapeau awaitingFirstResult.
 */
export function selectHomeRanking(
  players: Player[],
  ranks: number[],
  activePlayerId: string,
): HomeRankingSelection {
  const participantCount = players.length

  if (isRankingAwaitingFirstResult(players)) {
    return {
      players: [],
      ranks: [],
      awaitingFirstResult: true,
      participantCount,
    }
  }

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
      awaitingFirstResult: false,
      participantCount,
    }
  }

  return {
    players: top.map((entry) => entry.player),
    ranks: top.map((entry) => entry.rank),
    awaitingFirstResult: false,
    participantCount,
  }
}

/** Synthèse Participation : complete + partial, hors not_applicable. */
export function summarizeParticipation(rows: RoundParticipationRow[]): {
  predictedCount: number
  applicableCount: number
} {
  const applicable = rows.filter((row) => row.status !== 'not_applicable')
  const predicted = applicable.filter(
    (row) => row.status === 'complete' || row.status === 'partial',
  )
  return {
    predictedCount: predicted.length,
    applicableCount: applicable.length,
  }
}

export function formatParticipationSummary(
  predictedCount: number,
  applicableCount: number,
): string {
  if (applicableCount === 0) {
    return 'Aucun joueur concerné sur cette journée.'
  }
  const joueur = predictedCount > 1 ? 'joueurs' : 'joueur'
  const verbe = predictedCount > 1 ? 'ont' : 'a'
  return `${predictedCount} ${joueur} sur ${applicableCount} ${verbe} pronostiqué`
}

/** Groupes sociaux frontend — hors not_applicable. */
export function groupParticipationRows(rows: RoundParticipationRow[]): {
  complete: RoundParticipationRow[]
  partial: RoundParticipationRow[]
  missing: RoundParticipationRow[]
} {
  return {
    complete: rows.filter((row) => row.status === 'complete'),
    partial: rows.filter((row) => row.status === 'partial'),
    missing: rows.filter((row) => row.status === 'missing'),
  }
}

/**
 * Fraction N/M utile uniquement en multi-match ou partiel.
 * Masquée pour le cas classique 1/1 ou 0/1.
 */
export function shouldShowParticipationFraction(
  row: Pick<RoundParticipationRow, 'status' | 'expectedCount'>,
): boolean {
  return row.status === 'partial' || row.expectedCount > 1
}

export function formatParticipationFraction(
  row: Pick<RoundParticipationRow, 'predictedCount' | 'expectedCount'>,
): string {
  return `${row.predictedCount}/${row.expectedCount}`
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
        match.kickoffTimeConfirmed === true &&
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
