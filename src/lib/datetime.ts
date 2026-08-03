const PARIS_TZ = 'Europe/Paris'

/** Convertit une valeur datetime-local (heure locale navigateur) en ISO UTC. */
export function localInputToUtcIso(localValue: string): string {
  const date = new Date(localValue)
  if (Number.isNaN(date.getTime())) {
    throw new Error('INVALID_KICKOFF')
  }
  return date.toISOString()
}

/** Convertit un ISO UTC vers une valeur compatible datetime-local (fuseau Europe/Paris). */
export function utcIsoToLocalInput(iso: string): string {
  const date = new Date(iso)
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: PARIS_TZ,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(date)

  const get = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((part) => part.type === type)?.value ?? '00'

  return `${get('year')}-${get('month')}-${get('day')}T${get('hour')}:${get('minute')}`
}
