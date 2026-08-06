import type { MatchGroupReveal, MatchUiStatus } from '../types'
import { formatMatchDateShort, formatMatchTime } from './format.ts'

/** Points calendrier : `0 pt` / `1 pt` / `N pts`. */
export function formatCalendarPoints(points: number): string {
  if (points <= 1) return `${points} pt`
  return `${points} pts`
}

/**
 * Ligne prono personnel (carte terminée fermée).
 * - aucun prono → `Aucun pronostic`
 * - prono non noté → `Ton prono : H–A` (jamais `0 pt`)
 * - prono noté → `Ton prono : H–A · +N pts` / `· 0 pt`
 */
export function formatCalendarPersonalPrediction(
  prediction:
    | {
        homeScore: number
        awayScore: number
        points?: number | null
      }
    | null
    | undefined,
): string {
  if (!prediction) return 'Aucun pronostic'
  const score = `${prediction.homeScore}–${prediction.awayScore}`
  if (prediction.points == null) return `Ton prono : ${score}`
  const pointsLabel =
    prediction.points === 0
      ? formatCalendarPoints(0)
      : `+${formatCalendarPoints(prediction.points)}`
  return `Ton prono : ${score} · ${pointsLabel}`
}

/**
 * Tendance dominante depuis les pourcentages existants.
 * Null si absents, égalité en tête, ou max ≤ 0.
 */
export function formatDominantTendency(
  percentages:
    | {
        victory: number
        draw: number
        defeat: number
      }
    | null
    | undefined,
): string | null {
  if (!percentages) return null
  const entries = [
    { value: percentages.victory, phrase: 'une victoire' },
    { value: percentages.draw, phrase: 'un nul' },
    { value: percentages.defeat, phrase: 'une défaite' },
  ] as const
  const max = Math.max(
    percentages.victory,
    percentages.draw,
    percentages.defeat,
  )
  if (max <= 0) return null
  const leaders = entries.filter((entry) => entry.value === max)
  if (leaders.length !== 1) return null
  return `${max} % ont pronostiqué ${leaders[0].phrase}`
}

function formatMostPlayedScoresLabel(scores: string[]): string | null {
  if (scores.length === 0) return null
  if (scores.length === 1) return `Score le plus joué : ${scores[0]}`
  const shown = scores.slice(0, 2)
  const list =
    scores.length > 2 ? `${shown.join(', ')}, …` : shown.join(', ')
  return `Scores les plus joués : ${list}`
}

/**
 * Jusqu’à 3 infos groupe pour le résumé fermé, ordre fixe.
 * Tableau vide → ne pas rendre de conteneur.
 */
export function selectClosedGroupSummary(
  reveal: Pick<
    MatchGroupReveal,
    'participantCount' | 'participants' | 'mostPlayedScores' | 'percentages'
  >,
): string[] {
  const items: string[] = []
  const participantCount =
    reveal.participantCount ?? reveal.participants?.length ?? 0

  if (participantCount > 0) {
    items.push(
      participantCount === 1
        ? '1 participant'
        : `${participantCount} participants`,
    )
  }

  const mostPlayed = formatMostPlayedScoresLabel(reveal.mostPlayedScores ?? [])
  if (mostPlayed) items.push(mostPlayed)

  const tendency = formatDominantTendency(reveal.percentages)
  if (tendency) items.push(tendency)

  return items.slice(0, 3)
}

/**
 * Un badge exceptionnel max pour une ligne joueur du détail.
 * Priorité : Score exact > Meilleur prono > aucun.
 */
export function selectParticipantBadge(input: {
  exactScore: boolean
  bestPrediction: boolean
}): 'Score exact' | 'Meilleur prono' | null {
  if (input.exactScore) return 'Score exact'
  if (input.bestPrediction) return 'Meilleur prono'
  return null
}

/**
 * Points d’une ligne joueur (détail ouvert), avec `+` si > 0.
 * Null si non noté / résultat pas prêt — ne jamais inventer `0 pt`.
 */
export function formatParticipantPointsLabel(
  points: number | null | undefined,
  resultReady: boolean,
): string | null {
  if (!resultReady || points == null) return null
  if (points === 0) return formatCalendarPoints(0)
  return `+${formatCalendarPoints(points)}`
}

/**
 * Score affiché sur la ligne joueur.
 * Ne traite pas `0–0` comme absence de prono.
 * Réservé aux scores nullish explicites (payload) → `Aucun pronostic`.
 */
export function formatParticipantPredictionScore(input: {
  homeScore: number | null | undefined
  awayScore: number | null | undefined
}): string {
  if (input.homeScore == null || input.awayScore == null) {
    return 'Aucun pronostic'
  }
  return `${input.homeScore}–${input.awayScore}`
}

/**
 * Meta compacte d’un match futur : `J6 · Sam. 22 août · 20:45`
 * ou `J10 · Horaire à confirmer`.
 */
export function formatFutureMatchMeta(input: {
  matchday: number
  kickoffAt: string
  status: MatchUiStatus
  kickoffTimeConfirmed: boolean
}): string {
  const day = `J${input.matchday}`
  if (
    input.status === 'kickoff_unconfirmed' ||
    !input.kickoffTimeConfirmed
  ) {
    return `${day} · Horaire à confirmer`
  }
  if (input.status === 'postponed' || input.status === 'cancelled') {
    return `${day} · ${formatMatchDateShort(input.kickoffAt)}`
  }
  return `${day} · ${formatMatchDateShort(input.kickoffAt)} · ${formatMatchTime(input.kickoffAt)}`
}

/** Prono enregistré sur une ligne future compacte. Null si absent. */
export function formatSavedPrediction(
  prediction:
    | {
        homeScore: number
        awayScore: number
      }
    | null
    | undefined,
): string | null {
  if (!prediction) return null
  return `Ton prono : ${prediction.homeScore}–${prediction.awayScore}`
}

