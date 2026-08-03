import type {
  DbMatchStatus,
  Match,
  MatchUiStatus,
  ParticipationStatus,
  Player,
  PlayerOption,
  Prediction,
  RoundParticipationRow,
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
export {
  getCompetitionRanks,
  getDenseRanks,
  listRoundNumbers,
  selectDefaultRoundNumber,
  selectHomeRanking,
} from './ranking'

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
  is_active: boolean
  points: number | string
  exact_scores: number | string
  good_results: number | string
  scored_predictions: number | string
  success_rate: number | string | null
  gap_to_leader: number | string
}

interface DbParticipationRow {
  player_id: string
  display_name: string
  round_number: number | string
  status: ParticipationStatus
  predicted_count: number | string
  expected_count: number | string
}

async function rpc<T>(
  fn: string,
  args: Record<string, unknown>,
): Promise<T> {
  const { data, error } = await getSupabase().rpc(fn, args)
  if (error) {
    const code = getErrorCode(error) ?? 'RPC_ERROR'
    if (code === 'INVALID_ACCESS_CODE' || code === 'INVALID_SESSION') {
      notifySessionInvalidation(code)
    }
    throw new ApiError(code, error.message)
  }
  return data as T
}

type SessionInvalidationHandler = (code: string) => void

let sessionInvalidationHandler: SessionInvalidationHandler | null = null

/** Enregistré par SessionProvider : invalide la session joueur. */
export function setAccessInvalidationHandler(
  handler: SessionInvalidationHandler | null,
): void {
  sessionInvalidationHandler = handler
}

function notifySessionInvalidation(code: string): void {
  sessionInvalidationHandler?.(code)
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

interface DbLoginRow {
  session_token: string
  player_id: string
  pseudo: string
  must_change_pin: boolean
}

export async function loginPlayer(
  accessCode: string,
  playerId: string,
  pin: string,
): Promise<{
  sessionToken: string
  playerId: string
  pseudo: string
  mustChangePin: boolean
}> {
  const rows = await rpc<DbLoginRow[]>('login_player', {
    p_access_code: accessCode,
    p_player_id: playerId,
    p_pin: pin,
  })
  const row = rows?.[0]
  if (!row?.session_token) {
    throw new ApiError('RPC_ERROR', 'Connexion sans jeton de session.')
  }
  return {
    sessionToken: row.session_token,
    playerId: row.player_id,
    pseudo: row.pseudo,
    mustChangePin: Boolean(row.must_change_pin),
  }
}

interface DbSessionPlayerRow {
  player_id: string
  pseudo: string
  must_change_pin: boolean
  expires_at: string
}

export async function fetchSessionPlayer(sessionToken: string): Promise<{
  playerId: string
  pseudo: string
  mustChangePin: boolean
  expiresAt: string
} | null> {
  const rows = await rpc<DbSessionPlayerRow[]>('get_session_player', {
    p_session_token: sessionToken,
  })
  const row = rows?.[0]
  if (!row) return null
  return {
    playerId: row.player_id,
    pseudo: row.pseudo,
    mustChangePin: Boolean(row.must_change_pin),
    expiresAt: row.expires_at,
  }
}

export async function logoutPlayer(sessionToken: string): Promise<boolean> {
  const result = await rpc<boolean>('logout_player', {
    p_session_token: sessionToken,
  })
  return Boolean(result)
}

export async function changePlayerPin(
  sessionToken: string,
  oldPin: string,
  newPin: string,
): Promise<boolean> {
  const result = await rpc<boolean>('change_player_pin', {
    p_session_token: sessionToken,
    p_old_pin: oldPin,
    p_new_pin: newPin,
  })
  return Boolean(result)
}

export async function fetchMatches(sessionToken: string): Promise<Match[]> {
  const rows = await rpc<DbMatchRow[]>('get_matches', {
    p_session_token: sessionToken,
  })

  return sortMatchesForList((rows ?? []).map((row) => mapMatch(row)))
}

export async function fetchMyPredictions(
  sessionToken: string,
): Promise<Prediction[]> {
  const rows = await rpc<DbPredictionRow[]>('get_my_predictions', {
    p_session_token: sessionToken,
  })

  return (rows ?? []).map(mapPrediction)
}

export async function fetchVisiblePredictions(
  sessionToken: string,
): Promise<Prediction[]> {
  const rows = await rpc<DbPredictionRow[]>('get_visible_predictions', {
    p_session_token: sessionToken,
  })

  return (rows ?? []).map(mapPrediction)
}

export async function upsertPrediction(input: {
  sessionToken: string
  matchId: string
  homeScore: number
  awayScore: number
}): Promise<Prediction> {
  const rows = await rpc<DbPredictionRow[]>('upsert_prediction', {
    p_session_token: input.sessionToken,
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

export async function fetchRanking(sessionToken: string): Promise<Player[]> {
  const rows = await rpc<DbRankingRow[]>('get_ranking', {
    p_session_token: sessionToken,
  })

  return (rows ?? []).map((row) => ({
    id: row.id,
    pseudo: row.display_name,
    isActive: Boolean(row.is_active),
    points: Number(row.points),
    exactScores: Number(row.exact_scores),
    goodResults: Number(row.good_results),
    scoredPredictions: Number(row.scored_predictions),
    successRate:
      row.success_rate == null || row.success_rate === ''
        ? null
        : Number(row.success_rate),
    gapToLeader: Number(row.gap_to_leader),
  }))
}

export async function fetchRoundParticipation(
  sessionToken: string,
  roundNumber: number,
): Promise<RoundParticipationRow[]> {
  const rows = await rpc<DbParticipationRow[]>('get_round_participation', {
    p_session_token: sessionToken,
    p_round_number: roundNumber,
  })

  return (rows ?? []).map((row) => ({
    playerId: row.player_id,
    pseudo: row.display_name,
    roundNumber: Number(row.round_number),
    status: row.status,
    predictedCount: Number(row.predicted_count),
    expectedCount: Number(row.expected_count),
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

interface DbPushStatusRow {
  active: boolean
  status: string
  player_id: string
}

export async function registerPushSubscription(input: {
  sessionToken: string
  endpoint: string
  p256dh: string
  auth: string
  expirationTime?: string | null
  userAgent?: string | null
}): Promise<{ id: string; playerId: string; status: string }> {
  const rows = await rpc<
    Array<{ id: string; player_id: string; status: string; updated_at: string }>
  >('register_push_subscription', {
    p_session_token: input.sessionToken,
    p_endpoint: input.endpoint,
    p_p256dh: input.p256dh,
    p_auth: input.auth,
    p_expiration_time: input.expirationTime ?? null,
    p_user_agent: input.userAgent ?? null,
  })

  const row = rows?.[0]
  if (!row) {
    throw new ApiError('RPC_ERROR', 'Inscription push sans réponse.')
  }

  return {
    id: row.id,
    playerId: row.player_id,
    status: row.status,
  }
}

export async function deactivatePushSubscription(
  sessionToken: string,
  endpoint: string,
): Promise<boolean> {
  const result = await rpc<boolean>('deactivate_push_subscription', {
    p_session_token: sessionToken,
    p_endpoint: endpoint,
  })
  return Boolean(result)
}

export async function getPushSubscriptionStatus(
  sessionToken: string,
  endpoint: string,
): Promise<{ active: boolean; status: string; playerId: string } | null> {
  const rows = await rpc<DbPushStatusRow[]>('get_push_subscription_status', {
    p_session_token: sessionToken,
    p_endpoint: endpoint,
  })
  const row = rows?.[0]
  if (!row) return null
  return {
    active: Boolean(row.active),
    status: row.status,
    playerId: row.player_id,
  }
}
