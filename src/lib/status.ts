import type { MatchUiStatus } from '../types'

const STATUS_LABELS: Record<MatchUiStatus, string> = {
  to_predict: 'À pronostiquer',
  predicted: 'Pronostic enregistré',
  locked: 'Verrouillé',
  finished: 'Terminé',
  postponed: 'Reporté',
  cancelled: 'Annulé',
}

const STATUS_STYLES: Record<MatchUiStatus, string> = {
  to_predict: 'bg-yellow text-ink border-ink',
  predicted: 'bg-green text-white border-green',
  locked: 'bg-canvas text-muted border-border',
  finished: 'bg-ink text-yellow border-ink',
  postponed: 'bg-danger-soft text-danger border-danger/30',
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
