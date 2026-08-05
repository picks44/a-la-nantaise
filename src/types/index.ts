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

export type RoundStatus = 'open' | 'provisional' | 'completed'

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
  /** Rang compétition serveur (classement vivant). */
  rank?: number
  previousRank?: number | null
  rankDelta?: number | null
  isNewToRanking?: boolean
  roundPoints?: number
  referenceRoundNumber?: number | null
  referenceRoundStatus?: RoundStatus | null
  isRankingProvisional?: boolean
  /** Écart de points avec la ligne précédente ; null pour le leader. */
  gapToPrevious?: number | null
}

export type RoundPlayerParticipationStatus =
  | 'none'
  | 'partial'
  | 'complete'
  | 'not_applicable'

export type RecapMessageKey =
  | 'no_participation'
  | 'champion_of_round'
  | 'personal_best_rank'
  | 'strong_rise'
  | 'exact_scores_notable'
  | 'positive_day'
  | 'neutral_day'
  | 'tough_day'

export interface RoundStatusPayload {
  seasonId: string
  roundNumber: number
  status: RoundStatus
  isDefinitive: boolean
  hasStarted: boolean
  roundMatchCount: number
  nonCancelledMatchCount: number
  finishedCount: number
  cancelledCount: number
  postponedCount: number
  remainingCount: number
}

export interface RoundPlayerStatsRow {
  playerId: string
  displayName: string
  roundPoints: number
  exactScoreCount: number
  correctOutcomeOnlyCount: number
  successfulPredictionCount: number
  scoredPredictionCount: number
  predictedMatchCount: number
  participationMatchCount: number
  missedPredictionCount: number
  participationStatus: RoundPlayerParticipationStatus
  rankInRound: number | null
}

export interface RoundPlayerStatsPayload {
  seasonId: string
  roundNumber: number
  roundStatus: RoundStatus
  players: RoundPlayerStatsRow[]
  group: {
    participantCount: number
    participantAveragePoints: number | null
    championPlayerIds: string[]
    championRoundPoints: number | null
  }
}

export interface PlayerRoundRecapMatch {
  matchId: string
  label: string
  status: string
  finalScore: Score | null
  prediction: Score | null
  points: number | null
  predicted: boolean
}

export interface PlayerRoundRecapTrophy {
  trophyKey: string
  name: string
  icon: string
  sourceMatchId: string | null
}

export interface PlayerRoundRecap {
  seasonId: string
  roundNumber: number
  roundStatus: RoundStatus
  isDefinitive: boolean
  messageKey: RecapMessageKey
  messageParams: Record<string, string | number>
  summary: {
    roundPoints: number
    exactScoreCount: number
    correctOutcomeOnlyCount: number
    successfulPredictionCount: number
    scoredPredictionCount: number
    missedPredictionCount: number
    predictedMatchCount: number
    participationMatchCount: number
    participated: boolean
  }
  ranking: {
    rankBefore: number | null
    rankAfter: number | null
    rankDelta: number | null
    isNewToRanking: boolean
    gapToPrevious: number | null
  }
  social: {
    championDisplayNames: string[]
    championRoundPoints: number | null
    participantAveragePoints: number | null
    playerAhead: {
      displayName: string
      points: number
      gap: number | null
    } | null
  }
  matches: PlayerRoundRecapMatch[]
  trophies: PlayerRoundRecapTrophy[]
}

export interface SeasonTimelineRound {
  roundNumber: number
  roundPoints: number
  rank: number | null
  gapToPrevious: number | null
}

export interface SeasonTimeline {
  seasonId: string
  rounds: SeasonTimelineRound[]
  bestRound: { roundNumber: number; roundPoints: number } | null
  bestRank: { roundNumber: number; rank: number } | null
  trophies: Array<{
    id: string
    trophyKey: string
    name: string
    description: string
    icon: string
    awardedAt: string
    sourceRoundNumber: number | null
  }>
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
  sourceMatchLabel: string | null
  presentedAt: string | null
}

export interface LockedTrophy {
  trophyKey: string
  name: string
  description: string
  icon: string
  repeatable: boolean
  progressCurrent: number | null
  progressTarget: number | null
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
