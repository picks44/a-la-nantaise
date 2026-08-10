import type { RecapMessageKey } from '../types'
import { formatPoints } from './formatPoints.ts'
import { formatLastMatchVerdict } from './lastMatchDisplay.ts'
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
    case 'scoreless_day':
      return 'Ton prono n’a pas rapporté de point sur cette journée.'
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
  return count === 1 ? '1 exact' : `${count} exacts`
}

function formatMissedMatchesLabel(count: number): string {
  return count === 1 ? '1 match manqué' : `${count} matchs manqués`
}

function formatGoodResultsLabel(count: number): string {
  return count === 1 ? '1 bon résultat' : `${count} bons résultats`
}

/**
 * Jusqu’à 2 indicateurs de performance personnelle.
 * Priorité : exacts → manqués → bons. Pas de moyenne de groupe.
 */
export function selectRecapIndicators(input: {
  exactScoreCount: number
  missedPredictionCount: number
  correctOutcomeOnlyCount: number
  /** @deprecated Ignoré — conservé pour compat appelants. */
  participantAveragePoints?: number | null
}): string[] {
  const indicators: string[] = []

  if (input.exactScoreCount > 0) {
    indicators.push(formatExactScoresLabel(input.exactScoreCount))
  }
  if (input.missedPredictionCount > 0) {
    indicators.push(formatMissedMatchesLabel(input.missedPredictionCount))
  }
  if (input.correctOutcomeOnlyCount > 0) {
    indicators.push(formatGoodResultsLabel(input.correctOutcomeOnlyCount))
  }

  return indicators.slice(0, 2)
}

/** Ligne 1 d’un match récap : `Guingamp 2-0 FC Nantes`. */
export function formatRecapMatchHeadline(match: {
  label: string
  status: string
  finalScore: { home: number; away: number } | null
}): string {
  if (match.finalScore) {
    const parts = match.label.split(/\s+[–-]\s+/)
    if (parts.length === 2) {
      return `${parts[0]} ${match.finalScore.home}-${match.finalScore.away} ${parts[1]}`
    }
    return `${match.label} ${match.finalScore.home}-${match.finalScore.away}`
  }
  return match.label || match.status
}

/** Ligne 2 : `Prono 0-2 · À côté du score · 0 pt` (langage Home). */
export function formatRecapMatchDetail(match: {
  predicted: boolean
  prediction: { home: number; away: number } | null
  points: number | null
}): string {
  if (!match.predicted || !match.prediction) {
    return 'Non pronostiqué'
  }

  const score = `Prono ${match.prediction.home}-${match.prediction.away}`
  if (match.points == null) {
    return `${score} · Résultat en attente`
  }

  const verdict = formatLastMatchVerdict(match.points)
  const pointsLabel = formatPoints(match.points, { signed: true })
  return `${score} · ${verdict} · ${pointsLabel}`
}

