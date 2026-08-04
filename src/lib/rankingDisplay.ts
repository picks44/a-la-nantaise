import type { ParticipationStatus } from '../types'

const PARTICIPATION_LABELS: Record<ParticipationStatus, string> = {
  complete: 'Prono fait',
  partial: 'Partiel',
  missing: 'Non fait',
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
