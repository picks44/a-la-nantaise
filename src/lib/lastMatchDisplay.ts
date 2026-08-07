import { formatPoints } from './formatPoints.ts'
import { pointsResultLabel } from './status.ts'
import type { Prediction } from '../types'

export type LastMatchTone = 'exact' | 'good' | 'miss'

export type LastMatchPerformance =
  | { kind: 'missing' }
  | { kind: 'pending'; homeScore: number; awayScore: number }
  | {
      kind: 'scored'
      homeScore: number
      awayScore: number
      resultLabel: string
      pointsLabel: string
      tone: LastMatchTone
    }

/**
 * Verdict d’affichage dérivé de `pointsResultLabel`, sans le suffixe de points.
 * Présentation uniquement — ne recalcule pas le barème.
 */
export function formatLastMatchVerdict(points: number): string {
  const labeled = pointsResultLabel(points)
  if (!labeled) return ''

  const withoutPoints = labeled.replace(/\s·\s\+?\d+$/, '')
  if (withoutPoints === 'À côté') return 'À côté du score'
  return withoutPoints
}

function toneForPoints(points: number): LastMatchTone {
  if (points >= 3) return 'exact'
  if (points === 1) return 'good'
  return 'miss'
}

/** Vue d’affichage du prono personnel sur le dernier match (Home). */
export function getLastMatchPerformance(
  prediction?: Prediction,
): LastMatchPerformance {
  if (!prediction) return { kind: 'missing' }

  const { homeScore, awayScore, points } = prediction
  if (points == null) {
    return { kind: 'pending', homeScore, awayScore }
  }

  return {
    kind: 'scored',
    homeScore,
    awayScore,
    resultLabel: formatLastMatchVerdict(points),
    pointsLabel: formatPoints(points, { signed: true }),
    tone: toneForPoints(points),
  }
}
