import type { RecapMessageKey } from '../types'
import { formatPoints } from './formatPoints.ts'
import { formatPlacesDelta, formatRankOrdinal } from './rankingDisplay.ts'

/** Textes FR stables — map dépendante du statut définitif / provisoire. */
export function formatRecapMessage(
  key: RecapMessageKey,
  params: Record<string, string | number>,
  isDefinitive: boolean,
): string {
  const places = Number(params.places ?? 0)
  const rank = Number(params.rank ?? 0)
  const exacts = Number(params.exactScoreCount ?? params.exacts ?? 0)

  switch (key) {
    case 'no_participation': {
      const delta =
        params.rankDelta != null && params.rankDelta !== ''
          ? Number(params.rankDelta)
          : null
      if (delta != null && delta !== 0) {
        const n = Math.abs(delta)
        return delta < 0
          ? `Tu n’as pas participé à cette journée. Tu recules de ${n} place${n > 1 ? 's' : ''} au classement.`
          : `Tu n’as pas participé à cette journée. Tu gagnes ${n} place${n > 1 ? 's' : ''} au classement.`
      }
      return 'Tu n’as pas participé à cette journée.'
    }
    case 'champion_of_round':
      return 'Tu termines meilleur pronostiqueur de la journée'
    case 'personal_best_rank':
      return rank > 0
        ? `Tu atteins ton meilleur classement de la saison : ${formatRankOrdinal(rank)}`
        : 'Tu atteins ton meilleur classement de la saison'
    case 'strong_rise':
      return isDefinitive
        ? `Belle remontée : tu gagnes ${formatPlacesDelta(places)}`
        : `Tu gagnes provisoirement ${formatPlacesDelta(places)}`
    case 'exact_scores_notable':
      return isDefinitive
        ? `${exacts} score${exacts > 1 ? 's' : ''} exact${exacts > 1 ? 's' : ''} trouvé${exacts > 1 ? 's' : ''} cette journée`
        : `Déjà ${exacts} score${exacts > 1 ? 's' : ''} exact${exacts > 1 ? 's' : ''} sur cette journée`
    case 'positive_day':
      return isDefinitive
        ? 'Une journée positive'
        : 'Journée en cours positive pour l’instant'
    case 'neutral_day':
      return isDefinitive ? 'Journée neutre' : 'Journée en cours sans grand mouvement'
    case 'tough_day':
      return isDefinitive
        ? 'Une journée plus difficile'
        : 'Journée en cours un peu difficile'
    default:
      return 'Récap de la journée'
  }
}

/** Compact delta for ranking list (+2 / −1 / =). */
export function formatRankDelta(delta: number | null | undefined): string | null {
  if (delta == null) return null
  if (delta === 0) return '='
  if (delta > 0) return `+${delta}`
  return String(delta)
}

/** Libellé explicite pour le classement vivant (S1) — pas utilisé dans le récap. */
export function formatRankDeltaLabel(
  delta: number | null | undefined,
): string | null {
  if (delta == null) return null
  if (delta === 0) return 'Stable'
  if (delta > 0) return `+${delta} place${delta > 1 ? 's' : ''}`
  const n = Math.abs(delta)
  return `−${n} place${n > 1 ? 's' : ''}`
}

/** Points de la journée pour le récap éditorial. */
export function formatRecapRoundPoints(points: number): string {
  return formatPoints(points)
}

const groupAverageFormatter = new Intl.NumberFormat('fr-FR', {
  maximumFractionDigits: 1,
})

/** Moyenne du groupe — virgule FR, pluriel selon la valeur numérique. */
export function formatGroupAverageLabel(average: number): string {
  const formatted = groupAverageFormatter.format(average)
  const unit = average === 1 ? 'pt' : 'pts'
  return `Moyenne du groupe : ${formatted} ${unit}`
}

function formatExactScoresLabel(count: number): string {
  return count === 1 ? '1 score exact' : `${count} scores exacts`
}

function formatMissedMatchesLabel(count: number): string {
  return count === 1 ? '1 match manqué' : `${count} matchs manqués`
}

function formatGoodResultsLabel(count: number): string {
  return count === 1 ? '1 bon résultat' : `${count} bons résultats`
}

/**
 * Jusqu’à 3 indicateurs non nuls / utiles.
 * Priorité : exacts → manqués → moyenne → bons. Liste vide si rien à montrer.
 */
export function selectRecapIndicators(input: {
  exactScoreCount: number
  missedPredictionCount: number
  participantAveragePoints: number | null | undefined
  correctOutcomeOnlyCount: number
}): string[] {
  const indicators: string[] = []

  if (input.exactScoreCount > 0) {
    indicators.push(formatExactScoresLabel(input.exactScoreCount))
  }
  if (input.missedPredictionCount > 0) {
    indicators.push(formatMissedMatchesLabel(input.missedPredictionCount))
  }
  if (input.participantAveragePoints != null) {
    indicators.push(formatGroupAverageLabel(input.participantAveragePoints))
  }
  if (input.correctOutcomeOnlyCount > 0) {
    indicators.push(formatGoodResultsLabel(input.correctOutcomeOnlyCount))
  }

  return indicators.slice(0, 3)
}
