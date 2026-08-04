export type DbMatchStatus =
  | 'scheduled'
  | 'live'
  | 'finished'
  | 'postponed'
  | 'cancelled'

/** État affiché dans l’UI, dérivé du statut DB + coup d’envoi + prono. */
export type MatchUiStatus =
  | 'to_predict'
  | 'predicted'
  | 'locked'
  | 'kickoff_unconfirmed'
  | 'finished'
  | 'postponed'
  | 'cancelled'

export type ParticipationStatus =
  | 'complete'
  | 'partial'
  | 'missing'
  | 'not_applicable'

export interface Score {
  home: number
  away: number
}

export interface Match {
  id: string
  seasonId?: string
  matchday: number
  kickoffAt: string
  kickoffTimeConfirmed: boolean
  homeTeam: string
  awayTeam: string
  venue: 'home' | 'away'
  dbStatus: DbMatchStatus
  status: MatchUiStatus
  finalScore?: Score
}

export interface Prediction {
  id: string
  matchId: string
  playerId: string
  homeScore: number
  awayScore: number
  points?: number
}

export interface Player {
  id: string
  pseudo: string
  points: number
  exactScores: number
  isActive: boolean
  goodResults: number
  scoredPredictions: number
  /** Pourcentage 0–100, ou null si aucun prono noté. */
  successRate: number | null
  gapToLeader: number
}

export interface RoundParticipationRow {
  playerId: string
  pseudo: string
  roundNumber: number
  status: ParticipationStatus
  predictedCount: number
  expectedCount: number
}

export interface PlayerOption {
  id: string
  pseudo: string
  isActive: boolean
}

export interface Season {
  id: string
  slug: string
  name: string
  startsAt: string | null
  endsAt: string | null
  isActive: boolean
}

export interface GroupRevealParticipant {
  playerId: string
  pseudo: string
  homeScore: number
  awayScore: number
  outcome: string
  points: number | null
  exactScore: boolean
  bestPrediction: boolean
}

export interface GroupRevealPerformanceRow {
  playerId: string
  pseudo: string
  points: number
  rank: number
}

export interface MatchTrophyUnlock {
  playerId: string
  pseudo: string
  trophyKey: string
  name: string
}

export interface MatchGroupReveal {
  seasonId: string
  matchId: string
  revealed: boolean
  lockedUntil: string
  message?: string
  resultReady?: boolean
  myPrediction: {
    homeScore: number
    awayScore: number
    points: number | null
  } | null
  participants?: GroupRevealParticipant[]
  participantCount?: number
  nonParticipantCount?: number
  percentages?: {
    victory: number
    draw: number
    defeat: number
  }
  mostPlayedScores?: string[]
  uniqueScores?: string[]
  bestPredictionPoints?: number | null
  correctOutcomePlayers?: string[]
  performanceRanking?: GroupRevealPerformanceRow[]
  newTrophies?: MatchTrophyUnlock[]
}

export interface TrophyStatBlock {
  currentPredictionStreak: number
  bestPredictionStreak: number
  currentGoodResultStreak: number
  bestGoodResultStreak: number
  currentExactStreak: number
  bestExactStreak: number
  totalExactScores: number
  trophiesCount: number
}

export interface TrophyAward {
  id: string
  trophyKey: string
  name: string
  description: string
  icon: string
  awardedAt: string
  sourceMatchId: string | null
  sourceRoundNumber: number | null
  presentedAt: string | null
}

export interface LockedTrophy {
  trophyKey: string
  name: string
  description: string
  icon: string
  repeatable: boolean
}

export interface PendingTrophyCelebration {
  id: string
  trophyKey: string
  name: string
  description: string
  icon: string
  awardedAt: string
}

export interface TrophyOverview {
  seasonId: string
  stats: TrophyStatBlock
  earnedTrophies: TrophyAward[]
  lockedTrophies: LockedTrophy[]
  pendingCelebrations: PendingTrophyCelebration[]
}
