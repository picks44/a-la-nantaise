import type {
  DbMatchStatus,
  Match,
  MatchUiStatus,
  Player,
  PlayerOption,
  Prediction,
} from '../types'
import { ApiError, getErrorCode } from './errors'
import { getSupabase } from './supabase'
import {
  findLastFinishedMatch,
  findNextOpenMatch,
  sortMatchesForList,
} from './matchOrder'

export { findLastFinishedMatch, findNextOpenMatch, sortMatchesForList }
export { compareMatchesForList } from './matchOrder'

export const TRACKED_TEAM = 'FC Nantes'

interface DbPlayerRow {
  id: string
  display_name: string
  is_active: boolean
  created_at: string
}

interface DbMatchRow {
  id: string
  external_id: string | null
  round_number: number
  home_team: string
  away_team: string
  kickoff_at: string
  status: DbMatchStatus
  home_score: number | null
  away_score: number | null
  created_at: string
  updated_at: string
}

interface DbPredictionRow {
  id: string
  player_id: string
  match_id: string
  predicted_home_score: number
  predicted_away_score: number
  points: number | null
  created_at: string
  updated_at: string
}

interface DbRankingRow {
  id: string
  display_name: string
  points: number | string
  exact_scores: number | string
}

async function rpc<T>(
  fn: string,
  args: Record<string, unknown>,
): Promise<T> {
  const { data, error } = await getSupabase().rpc(fn, args)
  if (error) {
    const code = getErrorCode(error) ?? 'RPC_ERROR'
    if (code === 'INVALID_ACCESS_CODE') {
      notifyInvalidAccessCode()
    }
    throw new ApiError(code, error.message)
  }
  return data as T
}

type AccessInvalidationHandler = () => void

let accessInvalidationHandler: AccessInvalidationHandler | null = null

/** Enregistré par SessionProvider : invalide la session joueur uniquement. */
export function setAccessInvalidationHandler(
  handler: AccessInvalidationHandler | null,
): void {
  accessInvalidationHandler = handler
}

function notifyInvalidAccessCode(): void {
  accessInvalidationHandler?.()
}

export async function verifyAccessCode(accessCode: string): Promise<boolean> {
  try {
    const result = await rpc<boolean>('verify_access_code', {
      p_access_code: accessCode,
    })
    return Boolean(result)
  } catch (error) {
    if (getErrorCode(error) === 'ACCESS_CODE_NOT_CONFIGURED') throw error
    return false
  }
}

export async function fetchActivePlayers(
  accessCode: string,
): Promise<PlayerOption[]> {
  const rows = await rpc<DbPlayerRow[]>('get_active_players', {
    p_access_code: accessCode,
  })

  return (rows ?? []).map((row) => ({
    id: row.id,
    pseudo: row.display_name,
    isActive: row.is_active,
  }))
}

export async function fetchMatches(accessCode: string): Promise<Match[]> {
  const rows = await rpc<DbMatchRow[]>('get_matches', {
    p_access_code: accessCode,
  })

  return sortMatchesForList((rows ?? []).map((row) => mapMatch(row)))
}

export async function fetchMyPredictions(
  accessCode: string,
  playerId: string,
): Promise<Prediction[]> {
  const rows = await rpc<DbPredictionRow[]>('get_my_predictions', {
    p_access_code: accessCode,
    p_player_id: playerId,
  })

  return (rows ?? []).map(mapPrediction)
}

export async function fetchVisiblePredictions(
  accessCode: string,
  playerId: string,
): Promise<Prediction[]> {
  const rows = await rpc<DbPredictionRow[]>('get_visible_predictions', {
    p_access_code: accessCode,
    p_player_id: playerId,
  })

  return (rows ?? []).map(mapPrediction)
}

export async function upsertPrediction(input: {
  accessCode: string
  playerId: string
  matchId: string
  homeScore: number
  awayScore: number
}): Promise<Prediction> {
  const rows = await rpc<DbPredictionRow[]>('upsert_prediction', {
    p_access_code: input.accessCode,
    p_player_id: input.playerId,
    p_match_id: input.matchId,
    p_predicted_home_score: input.homeScore,
    p_predicted_away_score: input.awayScore,
  })

  const row = rows?.[0]
  if (!row) {
    throw new ApiError('RPC_ERROR', 'Aucune donnée renvoyée après enregistrement.')
  }

  return mapPrediction(row)
}

export async function fetchRanking(accessCode: string): Promise<Player[]> {
  const rows = await rpc<DbRankingRow[]>('get_ranking', {
    p_access_code: accessCode,
  })

  return (rows ?? []).map((row) => ({
    id: row.id,
    pseudo: row.display_name,
    points: Number(row.points),
    exactScores: Number(row.exact_scores),
  }))
}

export async function recalculateMatchPoints(
  accessCode: string,
  matchId: string,
): Promise<number> {
  const rows = await rpc<Array<{ updated_count: number }>>(
    'recalculate_match_points',
    {
      p_access_code: accessCode,
      p_match_id: matchId,
    },
  )
  return Number(rows?.[0]?.updated_count ?? 0)
}

export function mapMatch(row: DbMatchRow, now = new Date()): Match {
  const venue: Match['venue'] =
    row.home_team === TRACKED_TEAM ? 'home' : 'away'

  return {
    id: row.id,
    matchday: row.round_number,
    kickoffAt: row.kickoff_at,
    homeTeam: row.home_team,
    awayTeam: row.away_team,
    venue,
    dbStatus: row.status,
    status: deriveUiStatus(row, false, now),
    finalScore:
      row.home_score != null && row.away_score != null
        ? { home: row.home_score, away: row.away_score }
        : undefined,
  }
}

export function withPredictionStatus(
  match: Match,
  hasPrediction: boolean,
  now = new Date(),
): Match {
  return {
    ...match,
    status: deriveUiStatusFromMatch(match, hasPrediction, now),
  }
}

function deriveUiStatus(
  row: DbMatchRow,
  hasPrediction: boolean,
  now: Date,
): MatchUiStatus {
  return deriveUiStatusFromMatch(
    {
      id: row.id,
      matchday: row.round_number,
      kickoffAt: row.kickoff_at,
      homeTeam: row.home_team,
      awayTeam: row.away_team,
      venue: row.home_team === TRACKED_TEAM ? 'home' : 'away',
      dbStatus: row.status,
      status: 'to_predict',
      finalScore:
        row.home_score != null && row.away_score != null
          ? { home: row.home_score, away: row.away_score }
          : undefined,
    },
    hasPrediction,
    now,
  )
}

function deriveUiStatusFromMatch(
  match: Match,
  hasPrediction: boolean,
  now: Date,
): MatchUiStatus {
  if (match.dbStatus === 'postponed') return 'postponed'
  if (match.dbStatus === 'cancelled') return 'cancelled'
  if (match.dbStatus === 'finished') return 'finished'

  const kickoffReached =
    match.dbStatus === 'live' || now.getTime() >= new Date(match.kickoffAt).getTime()

  if (kickoffReached) return 'locked'
  if (hasPrediction) return 'predicted'
  return 'to_predict'
}

function mapPrediction(row: DbPredictionRow): Prediction {
  return {
    id: row.id,
    matchId: row.match_id,
    playerId: row.player_id,
    homeScore: row.predicted_home_score,
    awayScore: row.predicted_away_score,
    points: row.points ?? undefined,
  }
}

export function getDenseRanks(rankedPlayers: Player[]): number[] {
  const ranks: number[] = []

  rankedPlayers.forEach((player, index) => {
    if (index === 0) {
      ranks.push(1)
      return
    }

    const previous = rankedPlayers[index - 1]
    if (
      player.points === previous.points &&
      player.exactScores === previous.exactScores
    ) {
      ranks.push(ranks[index - 1])
    } else {
      ranks.push(index + 1)
    }
  })

  return ranks
}

export function getPredictionForMatch(
  predictions: Prediction[],
  matchId: string,
  playerId?: string,
): Prediction | undefined {
  return predictions.find(
    (prediction) =>
      prediction.matchId === matchId &&
      (playerId == null || prediction.playerId === playerId),
  )
}
