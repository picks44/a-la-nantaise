/** Mapping centralisé des statuts API-Football → métier (libellés FR hors UI). */

export type ProviderStatusNormalized =
  | 'scheduled'
  | 'kickoff_confirmed'
  | 'first_half'
  | 'halftime'
  | 'second_half'
  | 'extra_time'
  | 'penalty'
  | 'finished'
  | 'postponed'
  | 'suspended'
  | 'cancelled'
  | 'abandoned'
  | 'awarded'
  | 'unknown'

const SHORT_TO_NORMALIZED: Record<string, ProviderStatusNormalized> = {
  TBD: 'scheduled',
  NS: 'kickoff_confirmed',
  '1H': 'first_half',
  HT: 'halftime',
  '2H': 'second_half',
  ET: 'extra_time',
  BT: 'extra_time',
  P: 'penalty',
  LIVE: 'first_half',
  FT: 'finished',
  AET: 'finished',
  PEN: 'finished',
  PST: 'postponed',
  SUSP: 'suspended',
  INT: 'suspended',
  CANC: 'cancelled',
  ABD: 'abandoned',
  AWD: 'awarded',
  WO: 'awarded',
}

export const PROVIDER_STATUS_LABELS_FR: Record<ProviderStatusNormalized, string> = {
  scheduled: 'Programmé',
  kickoff_confirmed: 'Horaire confirmé',
  first_half: 'Première période',
  halftime: 'Mi-temps',
  second_half: 'Deuxième période',
  extra_time: 'Prolongation',
  penalty: 'Tirs au but',
  finished: 'Terminé',
  postponed: 'Reporté',
  suspended: 'Suspendu',
  cancelled: 'Annulé',
  abandoned: 'Abandonné',
  awarded: 'Attribué sur tapis vert',
  unknown: 'Statut inconnu',
}

export function normalizeApiFootballStatus(
  short: unknown,
): ProviderStatusNormalized {
  if (typeof short !== 'string' || short.trim() === '') return 'unknown'
  const key = short.trim().toUpperCase()
  return SHORT_TO_NORMALIZED[key] ?? 'unknown'
}

export function providerStatusLabelFr(
  status: ProviderStatusNormalized,
): string {
  return PROVIDER_STATUS_LABELS_FR[status]
}

export function isTerminalProviderStatus(
  status: ProviderStatusNormalized,
): boolean {
  return (
    status === 'finished' ||
    status === 'cancelled' ||
    status === 'abandoned' ||
    status === 'awarded' ||
    status === 'postponed'
  )
}

export function isLiveProviderStatus(
  status: ProviderStatusNormalized,
): boolean {
  return (
    status === 'first_half' ||
    status === 'halftime' ||
    status === 'second_half' ||
    status === 'extra_time' ||
    status === 'penalty'
  )
}

/** Ordre de période pour le tri stable des événements. */
export function periodSortRank(period: string | null | undefined): number {
  switch ((period ?? '').toUpperCase()) {
    case '1H':
      return 1
    case 'HT':
      return 2
    case '2H':
      return 3
    case 'ET':
      return 4
    case 'BT':
      return 5
    case 'P':
      return 6
    case 'FT':
      return 7
    default:
      return 0
  }
}
