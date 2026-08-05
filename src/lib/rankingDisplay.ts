import type { ParticipationStatus } from '../types'

const PARTICIPATION_LABELS: Record<ParticipationStatus, string> = {
  complete: 'Prono fait',
  partial: 'Partiel',
  missing: 'À pronostiquer',
  not_applicable: 'Non applicable',
}

const PARTICIPATION_STYLES: Record<ParticipationStatus, string> = {
  complete: 'border-green/40 bg-success-soft text-green-dark',
  partial: 'border-warning/40 bg-warning-soft text-warning',
  missing: 'border-border bg-surface-muted text-muted',
  not_applicable: 'border-border bg-canvas text-muted',
}

export function participationLabel(status: ParticipationStatus): string {
  return PARTICIPATION_LABELS[status]
}

export function participationClassName(status: ParticipationStatus): string {
  return PARTICIPATION_STYLES[status]
}

export function formatSuccessRate(rate: number | null): string {
  if (rate == null) return '—'
  const rounded = Number.isInteger(rate) ? String(rate) : rate.toFixed(1)
  return `${rounded} %`
}

export function formatGapToLeader(gap: number, isLeader: boolean): string {
  if (isLeader || gap === 0) return 'Leader'
  return `−${gap}`
}

/** Écart de points brut (affichage compact classement). */
export function formatGapToPrevious(gap: number | null | undefined): string {
  if (gap == null) return '—'
  if (gap === 0) return '0 pt'
  return `${gap} pt${gap > 1 ? 's' : ''}`
}

/** Phrase humaine pour l’écart au joueur précédent. */
export function formatGapToPreviousHuman(
  gap: number | null | undefined,
  options?: { isLeader?: boolean },
): string | null {
  if (options?.isLeader || gap == null) {
    return options?.isLeader ? 'Leader du classement' : null
  }
  if (gap === 0) {
    return 'À égalité de points avec le joueur précédent'
  }
  return `À ${gap} point${gap > 1 ? 's' : ''} du joueur précédent`
}

export function formatProvisionalBadge(isProvisional: boolean): string {
  return isProvisional ? 'Provisoire' : 'Définitif'
}

/** Ordinal FR à partir d’un rang numérique (appliqué en dernier). */
export function formatRankOrdinal(rank: number): string {
  if (rank === 1) return '1re'
  return `${rank}e`
}

export function formatPlacesDelta(delta: number): string {
  const n = Math.abs(delta)
  return `${n} place${n > 1 ? 's' : ''}`
}

/**
 * Formulation humaine du mouvement de rang.
 * S’appuie sur les nombres, pas sur une chaîne déjà formatée.
 */
export function formatRankChangeHuman(input: {
  rankBefore: number | null
  rankAfter: number | null
  rankDelta: number | null
  isNewToRanking: boolean
  isLeader?: boolean
}): string {
  const { rankBefore, rankAfter, rankDelta, isNewToRanking, isLeader } = input

  if (isNewToRanking) {
    if (rankAfter != null) {
      return `Nouveau au classement · ${formatRankOrdinal(rankAfter)} place`
    }
    return 'Nouveau au classement'
  }

  if (rankAfter == null) {
    return 'Classement indisponible'
  }

  if (rankBefore == null) {
    return `Tu es ${formatRankOrdinal(rankAfter)}`
  }

  if (rankDelta == null || rankDelta === 0) {
    if (isLeader || rankAfter === 1) {
      return `Tu conserves la ${formatRankOrdinal(1)} place`
    }
    return `Tu conserves la ${formatRankOrdinal(rankAfter)} place`
  }

  if (rankDelta > 0) {
    return `Tu gagnes ${formatPlacesDelta(rankDelta)} · ${formatRankOrdinal(rankAfter)}`
  }

  return `Tu recules de ${formatPlacesDelta(rankDelta)} · ${formatRankOrdinal(rankAfter)}`
}
