/** Presentation-only helpers for the trophies tab. No business rules. */

export function formatTrophyAwardMeta(input: {
  awardedAt: string
  sourceRoundNumber: number | null
  sourceMatchLabel: string | null
}): string {
  const parts: string[] = []

  const date = new Date(input.awardedAt)
  if (!Number.isNaN(date.getTime())) {
    parts.push(
      date.toLocaleDateString('fr-FR', {
        day: 'numeric',
        month: 'long',
        year: 'numeric',
      }),
    )
  }

  if (input.sourceRoundNumber != null) {
    parts.push(`J${input.sourceRoundNumber}`)
  }

  if (input.sourceMatchLabel) {
    parts.push(input.sourceMatchLabel)
  }

  return parts.join(' · ')
}

export function hasLockedTrophyProgress(input: {
  progressCurrent: number | null
  progressTarget: number | null
}): boolean {
  return (
    input.progressCurrent != null &&
    input.progressTarget != null &&
    input.progressTarget > 0
  )
}

export function formatLockedTrophyProgress(
  current: number,
  target: number,
): string {
  return `${current} / ${target}`
}
