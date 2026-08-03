const PARIS_TZ = 'Europe/Paris'

const DATE_FORMATTER = new Intl.DateTimeFormat('fr-FR', {
  weekday: 'long',
  day: 'numeric',
  month: 'long',
  timeZone: PARIS_TZ,
})

const TIME_FORMATTER = new Intl.DateTimeFormat('fr-FR', {
  hour: '2-digit',
  minute: '2-digit',
  timeZone: PARIS_TZ,
})

export function formatMatchDate(isoDate: string): string {
  const formatted = DATE_FORMATTER.format(new Date(isoDate))
  return formatted.charAt(0).toUpperCase() + formatted.slice(1)
}

export function formatMatchTime(isoDate: string): string {
  return TIME_FORMATTER.format(new Date(isoDate))
}

export function formatKickoff(isoDate: string): string {
  return `${formatMatchDate(isoDate)} · ${formatMatchTime(isoDate)}`
}

/** Date courte pour affiches de match. */
export function formatMatchDateShort(isoDate: string): string {
  return new Intl.DateTimeFormat('fr-FR', {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    timeZone: PARIS_TZ,
  }).format(new Date(isoDate))
}

export function venueSecondaryLabel(venue: 'home' | 'away'): string {
  return venue === 'home' ? 'La Beaujoire' : 'À l’extérieur'
}

export const SCORE_MIN = 0
export const SCORE_MAX = 15

export function clampScore(value: number): number {
  if (Number.isNaN(value)) return SCORE_MIN
  return Math.min(SCORE_MAX, Math.max(SCORE_MIN, Math.trunc(value)))
}

export interface CountdownParts {
  totalMs: number
  hours: number
  minutes: number
  seconds: number
  locked: boolean
}

export function getCountdown(kickoffAt: string, now = new Date()): CountdownParts {
  const totalMs = Math.max(0, new Date(kickoffAt).getTime() - now.getTime())
  const locked = totalMs <= 0
  const totalSeconds = Math.floor(totalMs / 1000)
  const hours = Math.floor(totalSeconds / 3600)
  const minutes = Math.floor((totalSeconds % 3600) / 60)
  const seconds = totalSeconds % 60

  return { totalMs, hours, minutes, seconds, locked }
}

export function formatCountdown(parts: CountdownParts): string {
  if (parts.locked) return 'Verrouillé'

  const totalSeconds = Math.floor(parts.totalMs / 1000)
  const days = Math.floor(totalSeconds / 86400)
  const hoursInDay = Math.floor((totalSeconds % 86400) / 3600)
  const totalHours = Math.floor(totalSeconds / 3600)
  const minutes = Math.floor((totalSeconds % 3600) / 60)
  const seconds = totalSeconds % 60

  const fortyEightHoursMs = 48 * 60 * 60 * 1000
  const oneHourMs = 60 * 60 * 1000

  if (parts.totalMs >= fortyEightHoursMs) {
    return `${days} j ${hoursInDay} h`
  }

  if (parts.totalMs >= oneHourMs) {
    return `${totalHours} h ${minutes} min`
  }

  return `${minutes} min ${seconds} s`
}
