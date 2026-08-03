import type { MatchUiStatus } from '../types'

const STATUS_LABELS: Record<MatchUiStatus, string> = {
  to_predict: 'À pronostiquer',
  predicted: 'Prédit',
  locked: 'Verrouillé',
  finished: 'Terminé',
  postponed: 'Reporté',
  cancelled: 'Annulé',
}

const STATUS_STYLES: Record<MatchUiStatus, string> = {
  to_predict: 'bg-yellow/40 text-ink border-ink/20',
  predicted: 'bg-success-soft text-green-dark border-green/35',
  locked: 'bg-surface-muted text-muted border-border',
  finished: 'bg-surface-muted text-ink border-border',
  postponed: 'bg-warning-soft text-warning border-warning/30',
  cancelled: 'bg-danger-soft text-danger border-danger/30',
}

export function statusLabel(status: MatchUiStatus): string {
  return STATUS_LABELS[status]
}

export function statusClassName(status: MatchUiStatus): string {
  return STATUS_STYLES[status]
}

export function pointsResultLabel(points: number | undefined | null): string | null {
  if (points == null) return null
  if (points >= 3) return 'Pleine lucarne · +3'
  if (points === 1) return 'Bon résultat · +1'
  return 'À côté · 0'
}
