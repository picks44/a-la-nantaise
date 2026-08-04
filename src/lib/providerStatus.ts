/** Libellés FR des statuts fournisseur (jamais de codes techniques dans l’UI). */

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

export function providerStatusLabelFr(status: string | null | undefined): string {
  if (!status) return PROVIDER_STATUS_LABELS_FR.unknown
  return (
    PROVIDER_STATUS_LABELS_FR[status as ProviderStatusNormalized] ??
    PROVIDER_STATUS_LABELS_FR.unknown
  )
}
