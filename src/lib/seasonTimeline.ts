import { formatPoints } from './formatPoints.ts'
import { formatRankOrdinal } from './rankingDisplay.ts'

/** Helpers présentation Parcours — pures, sans recalcul métier. */
export function formatTimelinePoints(points: number): string {
  return formatPoints(points)
}

export function formatTimelineRoundLine(input: {
  roundNumber: number
  roundPoints: number
  rank: number | null
}): string {
  const rankLabel =
    input.rank == null ? '—' : `${formatRankOrdinal(input.rank)} place`
  return `J${input.roundNumber} · ${formatTimelinePoints(input.roundPoints)} · ${rankLabel}`
}

export function isTimelineMilestone(input: {
  isBestRound: boolean
  isBestRank: boolean
  trophyCount: number
}): boolean {
  return input.isBestRound || input.isBestRank || input.trophyCount > 0
}

export function buildRoundAnnotations(input: {
  isBestRound: boolean
  isBestRank: boolean
  trophyNames: string[]
}): string[] {
  const annotations: string[] = []
  if (input.isBestRound) annotations.push('Meilleure journée')
  if (input.isBestRank) annotations.push('Meilleure position')
  for (const name of input.trophyNames) annotations.push(name)
  return annotations
}
