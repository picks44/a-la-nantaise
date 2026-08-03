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
  matchday: number
  kickoffAt: string
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
