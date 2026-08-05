import type {
  DbMatchStatus,
  MatchGroupReveal,
  Match,
  MatchUiStatus,
  ParticipationStatus,
  Player,
  PlayerOption,
  PlayerRoundRecap,
  Prediction,
  RoundParticipationRow,
  RoundPlayerStatsPayload,
  RoundStatus,
  RoundStatusPayload,
  Season,
  SeasonTimeline,
  TrophyOverview,
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
  season_id?: string
  external_id: string | null
  round_number: number
  home_team: string
  away_team: string
  kickoff_at: string
  kickoff_time_confirmed?: boolean | null
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

interface DbSeasonRow {
  id: string
  slug: string
  name: string
  starts_at: string | null
  ends_at: string | null
  is_active: boolean
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
    throw new ApiError('INVALID_CREDENTIALS', 'INVALID_CREDENTIALS')
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

export async function fetchActiveSeason(sessionToken: string): Promise<Season> {
  const rows = await rpc<DbSeasonRow[]>('get_active_season', {
    p_session_token: sessionToken,
  })
  const row = rows?.[0]
  if (!row?.id) {
    throw new ApiError('SEASON_NOT_FOUND', 'Saison active introuvable.')
  }
  return {
    id: row.id,
    slug: row.slug,
    name: row.name,
    startsAt: row.starts_at,
    endsAt: row.ends_at,
    isActive: Boolean(row.is_active),
  }
}

function toStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  return value.filter((item): item is string => typeof item === 'string')
}

export async function fetchMatchGroupReveal(input: {
  sessionToken: string
  seasonId: string
  matchId: string
}): Promise<MatchGroupReveal> {
  const data = await rpc<unknown>('get_match_group_reveal', {
    p_session_token: input.sessionToken,
    p_season_id: input.seasonId,
    p_match_id: input.matchId,
  })
  const payload = (data ?? {}) as Record<string, unknown>

  return {
    seasonId: String(payload.seasonId ?? input.seasonId),
    matchId: String(payload.matchId ?? input.matchId),
    revealed: Boolean(payload.revealed),
    lockedUntil: String(payload.lockedUntil ?? ''),
    message:
      typeof payload.message === 'string' ? payload.message : undefined,
    resultReady:
      typeof payload.resultReady === 'boolean'
        ? payload.resultReady
        : undefined,
    myPrediction:
      payload.myPrediction &&
      typeof payload.myPrediction === 'object' &&
      !Array.isArray(payload.myPrediction)
        ? {
            homeScore: Number(
              (payload.myPrediction as Record<string, unknown>).homeScore,
            ),
            awayScore: Number(
              (payload.myPrediction as Record<string, unknown>).awayScore,
            ),
            points:
              (payload.myPrediction as Record<string, unknown>).points == null
                ? null
                : Number(
                    (payload.myPrediction as Record<string, unknown>).points,
                  ),
          }
        : null,
    participants: Array.isArray(payload.participants)
      ? payload.participants.map((item) => {
          const row = item as Record<string, unknown>
          return {
            playerId: String(row.playerId ?? ''),
            pseudo: String(row.pseudo ?? ''),
            homeScore: Number(row.homeScore ?? 0),
            awayScore: Number(row.awayScore ?? 0),
            outcome: String(row.outcome ?? ''),
            points: row.points == null ? null : Number(row.points),
            exactScore: Boolean(row.exactScore),
            bestPrediction: Boolean(row.bestPrediction),
          }
        })
      : undefined,
    participantCount:
      payload.participantCount == null
        ? undefined
        : Number(payload.participantCount),
    nonParticipantCount:
      payload.nonParticipantCount == null
        ? undefined
        : Number(payload.nonParticipantCount),
    percentages:
      payload.percentages &&
      typeof payload.percentages === 'object' &&
      !Array.isArray(payload.percentages)
        ? {
            victory: Number(
              (payload.percentages as Record<string, unknown>).victory ?? 0,
            ),
            draw: Number(
              (payload.percentages as Record<string, unknown>).draw ?? 0,
            ),
            defeat: Number(
              (payload.percentages as Record<string, unknown>).defeat ?? 0,
            ),
          }
        : undefined,
    mostPlayedScores: toStringArray(payload.mostPlayedScores),
    uniqueScores: toStringArray(payload.uniqueScores),
    bestPredictionPoints:
      payload.bestPredictionPoints == null
        ? null
        : Number(payload.bestPredictionPoints),
    correctOutcomePlayers: toStringArray(payload.correctOutcomePlayers),
    performanceRanking: Array.isArray(payload.performanceRanking)
      ? payload.performanceRanking.map((item) => {
          const row = item as Record<string, unknown>
          return {
            playerId: String(row.playerId ?? ''),
            pseudo: String(row.pseudo ?? ''),
            points: Number(row.points ?? 0),
            rank: Number(row.rank ?? 0),
          }
        })
      : undefined,
    newTrophies: Array.isArray(payload.newTrophies)
      ? payload.newTrophies.map((item) => {
          const row = item as Record<string, unknown>
          return {
            playerId: String(row.playerId ?? ''),
            pseudo: String(row.pseudo ?? ''),
            trophyKey: String(row.trophyKey ?? ''),
            name: String(row.name ?? ''),
          }
        })
      : undefined,
  }
}

export async function fetchTrophyOverview(input: {
  sessionToken: string
  seasonId: string
}): Promise<TrophyOverview> {
  const data = await rpc<unknown>('get_player_trophy_overview', {
    p_session_token: input.sessionToken,
    p_season_id: input.seasonId,
  })
  const payload = (data ?? {}) as Record<string, unknown>
  const stats = (payload.stats ?? {}) as Record<string, unknown>

  return {
    seasonId: String(payload.seasonId ?? input.seasonId),
    stats: {
      currentPredictionStreak: Number(stats.currentPredictionStreak ?? 0),
      bestPredictionStreak: Number(stats.bestPredictionStreak ?? 0),
      currentGoodResultStreak: Number(stats.currentGoodResultStreak ?? 0),
      bestGoodResultStreak: Number(stats.bestGoodResultStreak ?? 0),
      currentExactStreak: Number(stats.currentExactStreak ?? 0),
      bestExactStreak: Number(stats.bestExactStreak ?? 0),
      totalExactScores: Number(stats.totalExactScores ?? 0),
      trophiesCount: Number(stats.trophiesCount ?? 0),
    },
    earnedTrophies: Array.isArray(payload.earnedTrophies)
      ? payload.earnedTrophies.map((item) => {
          const row = item as Record<string, unknown>
          return {
            id: String(row.id ?? ''),
            trophyKey: String(row.trophyKey ?? ''),
            name: String(row.name ?? ''),
            description: String(row.description ?? ''),
            icon: String(row.icon ?? ''),
            awardedAt: String(row.awardedAt ?? ''),
            sourceMatchId:
              row.sourceMatchId == null ? null : String(row.sourceMatchId),
            sourceRoundNumber:
              row.sourceRoundNumber == null
                ? null
                : Number(row.sourceRoundNumber),
            sourceMatchLabel:
              row.sourceMatchLabel == null
                ? null
                : String(row.sourceMatchLabel),
            presentedAt:
              row.presentedAt == null ? null : String(row.presentedAt),
          }
        })
      : [],
    lockedTrophies: Array.isArray(payload.lockedTrophies)
      ? payload.lockedTrophies.map((item) => {
          const row = item as Record<string, unknown>
          return {
            trophyKey: String(row.trophyKey ?? ''),
            name: String(row.name ?? ''),
            description: String(row.description ?? ''),
            icon: String(row.icon ?? ''),
            repeatable: Boolean(row.repeatable),
            progressCurrent:
              row.progressCurrent == null
                ? null
                : Number(row.progressCurrent),
            progressTarget:
              row.progressTarget == null ? null : Number(row.progressTarget),
          }
        })
      : [],
    pendingCelebrations: Array.isArray(payload.pendingCelebrations)
      ? payload.pendingCelebrations.map((item) => {
          const row = item as Record<string, unknown>
          return {
            id: String(row.id ?? ''),
            trophyKey: String(row.trophyKey ?? ''),
            name: String(row.name ?? ''),
            description: String(row.description ?? ''),
            icon: String(row.icon ?? ''),
            awardedAt: String(row.awardedAt ?? ''),
          }
        })
      : [],
  }
}

export async function acknowledgeTrophyCelebrations(input: {
  sessionToken: string
  seasonId: string
}): Promise<number> {
  const result = await rpc<number>('acknowledge_trophy_celebrations', {
    p_session_token: input.sessionToken,
    p_season_id: input.seasonId,
  })
  return Number(result ?? 0)
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
    seasonId: row.season_id,
    matchday: row.round_number,
    kickoffAt: row.kickoff_at,
    kickoffTimeConfirmed: row.kickoff_time_confirmed ?? true,
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
      kickoffTimeConfirmed: row.kickoff_time_confirmed ?? true,
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

  // Horaire non confirmé (placeholder) : jamais verrouillé par le temps,
  // jamais ouvert aux pronostics tant que l’admin ne l’a pas confirmé.
  if (!match.kickoffTimeConfirmed) return 'kickoff_unconfirmed'

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

interface DbLiveRankingRow {
  player_id: string
  display_name: string
  is_active: boolean
  points: number | string
  exact_score_count: number | string
  correct_outcome_only_count: number | string
  successful_prediction_count: number | string
  scored_prediction_count: number | string
  success_rate: number | string | null
  rank: number | string
  previous_rank: number | string | null
  rank_delta: number | string | null
  is_new_to_ranking: boolean
  round_points: number | string
  reference_round_number: number | string | null
  reference_round_status: string | null
  is_ranking_provisional: boolean
  gap_to_previous: number | string | null
  gap_to_leader: number | string
}

function optionalNumber(value: number | string | null | undefined): number | null {
  if (value == null || value === '') return null
  return Number(value)
}

function asRoundStatus(value: unknown): RoundStatus {
  if (value === 'provisional' || value === 'completed' || value === 'open') {
    return value
  }
  return 'open'
}

export async function fetchRoundStatus(input: {
  sessionToken: string
  seasonId: string
  roundNumber: number
}): Promise<RoundStatusPayload> {
  const data = await rpc<Record<string, unknown>>('get_round_status', {
    p_session_token: input.sessionToken,
    p_season_id: input.seasonId,
    p_round_number: input.roundNumber,
  })
  return {
    seasonId: String(data.seasonId ?? input.seasonId),
    roundNumber: Number(data.roundNumber ?? input.roundNumber),
    status: asRoundStatus(data.status),
    isDefinitive: Boolean(data.isDefinitive),
    hasStarted: Boolean(data.hasStarted),
    roundMatchCount: Number(data.roundMatchCount ?? 0),
    nonCancelledMatchCount: Number(data.nonCancelledMatchCount ?? 0),
    finishedCount: Number(data.finishedCount ?? 0),
    cancelledCount: Number(data.cancelledCount ?? 0),
    postponedCount: Number(data.postponedCount ?? 0),
    remainingCount: Number(data.remainingCount ?? 0),
  }
}

export async function fetchLiveSeasonRanking(input: {
  sessionToken: string
  seasonId: string
}): Promise<Player[]> {
  const rows = await rpc<DbLiveRankingRow[]>('get_live_season_ranking', {
    p_session_token: input.sessionToken,
    p_season_id: input.seasonId,
  })

  return (rows ?? []).map((row) => ({
    id: row.player_id,
    pseudo: row.display_name,
    isActive: Boolean(row.is_active),
    points: Number(row.points),
    exactScores: Number(row.exact_score_count),
    goodResults: Number(row.correct_outcome_only_count),
    scoredPredictions: Number(row.scored_prediction_count),
    successRate:
      row.success_rate == null || row.success_rate === ''
        ? null
        : Number(row.success_rate),
    gapToLeader: Number(row.gap_to_leader),
    rank: Number(row.rank),
    previousRank: optionalNumber(row.previous_rank),
    rankDelta: optionalNumber(row.rank_delta),
    isNewToRanking: Boolean(row.is_new_to_ranking),
    roundPoints: Number(row.round_points),
    referenceRoundNumber: optionalNumber(row.reference_round_number),
    referenceRoundStatus:
      row.reference_round_status === 'provisional' ||
      row.reference_round_status === 'completed'
        ? row.reference_round_status
        : null,
    isRankingProvisional: Boolean(row.is_ranking_provisional),
    gapToPrevious: optionalNumber(row.gap_to_previous),
  }))
}

export async function fetchRoundPlayerStats(input: {
  sessionToken: string
  seasonId: string
  roundNumber: number
}): Promise<RoundPlayerStatsPayload> {
  const data = await rpc<Record<string, unknown>>('get_round_player_stats', {
    p_session_token: input.sessionToken,
    p_season_id: input.seasonId,
    p_round_number: input.roundNumber,
  })
  const group = (data.group ?? {}) as Record<string, unknown>
  const playersRaw = Array.isArray(data.players) ? data.players : []

  return {
    seasonId: String(data.seasonId ?? input.seasonId),
    roundNumber: Number(data.roundNumber ?? input.roundNumber),
    roundStatus: asRoundStatus(data.roundStatus),
    players: playersRaw.map((raw) => {
      const row = raw as Record<string, unknown>
      const status = String(row.participationStatus ?? 'none')
      return {
        playerId: String(row.playerId),
        displayName: String(row.displayName ?? ''),
        roundPoints: Number(row.roundPoints ?? 0),
        exactScoreCount: Number(row.exactScoreCount ?? 0),
        correctOutcomeOnlyCount: Number(row.correctOutcomeOnlyCount ?? 0),
        successfulPredictionCount: Number(row.successfulPredictionCount ?? 0),
        scoredPredictionCount: Number(row.scoredPredictionCount ?? 0),
        predictedMatchCount: Number(row.predictedMatchCount ?? 0),
        participationMatchCount: Number(row.participationMatchCount ?? 0),
        missedPredictionCount: Number(row.missedPredictionCount ?? 0),
        participationStatus:
          status === 'partial' ||
          status === 'complete' ||
          status === 'not_applicable' ||
          status === 'none'
            ? status
            : 'none',
        rankInRound: optionalNumber(
          row.rankInRound as number | string | null | undefined,
        ),
      }
    }),
    group: {
      participantCount: Number(group.participantCount ?? 0),
      participantAveragePoints: optionalNumber(
        group.participantAveragePoints as number | string | null | undefined,
      ),
      championPlayerIds: toStringArray(group.championPlayerIds),
      championRoundPoints: optionalNumber(
        group.championRoundPoints as number | string | null | undefined,
      ),
    },
  }
}

export async function fetchPlayerRoundRecap(input: {
  sessionToken: string
  seasonId: string
  roundNumber: number
}): Promise<PlayerRoundRecap> {
  const data = await rpc<Record<string, unknown>>('get_player_round_recap', {
    p_session_token: input.sessionToken,
    p_season_id: input.seasonId,
    p_round_number: input.roundNumber,
  })
  const summary = (data.summary ?? {}) as Record<string, unknown>
  const ranking = (data.ranking ?? {}) as Record<string, unknown>
  const social = (data.social ?? {}) as Record<string, unknown>
  const playerAheadRaw = social.playerAhead
  const playerAhead =
    playerAheadRaw &&
    typeof playerAheadRaw === 'object' &&
    !Array.isArray(playerAheadRaw)
      ? {
          displayName: String(
            (playerAheadRaw as Record<string, unknown>).displayName ?? '',
          ),
          points: Number((playerAheadRaw as Record<string, unknown>).points ?? 0),
          gap: optionalNumber(
            (playerAheadRaw as Record<string, unknown>).gap as
              | number
              | string
              | null
              | undefined,
          ),
        }
      : null

  const matchesRaw = Array.isArray(data.matches) ? data.matches : []
  const trophiesRaw = Array.isArray(data.trophies) ? data.trophies : []
  const messageParamsRaw =
    data.messageParams &&
    typeof data.messageParams === 'object' &&
    !Array.isArray(data.messageParams)
      ? (data.messageParams as Record<string, unknown>)
      : {}

  const messageParams: Record<string, string | number> = {}
  for (const [key, value] of Object.entries(messageParamsRaw)) {
    if (typeof value === 'string' || typeof value === 'number') {
      messageParams[key] = value
    }
  }

  const messageKey = String(data.messageKey ?? 'tough_day') as PlayerRoundRecap['messageKey']

  return {
    seasonId: String(data.seasonId ?? input.seasonId),
    roundNumber: Number(data.roundNumber ?? input.roundNumber),
    roundStatus: asRoundStatus(data.roundStatus),
    isDefinitive: Boolean(data.isDefinitive),
    messageKey,
    messageParams,
    summary: {
      roundPoints: Number(summary.roundPoints ?? 0),
      exactScoreCount: Number(summary.exactScoreCount ?? 0),
      correctOutcomeOnlyCount: Number(summary.correctOutcomeOnlyCount ?? 0),
      successfulPredictionCount: Number(summary.successfulPredictionCount ?? 0),
      scoredPredictionCount: Number(summary.scoredPredictionCount ?? 0),
      missedPredictionCount: Number(summary.missedPredictionCount ?? 0),
      predictedMatchCount: Number(summary.predictedMatchCount ?? 0),
      participationMatchCount: Number(summary.participationMatchCount ?? 0),
      participated: Boolean(summary.participated),
    },
    ranking: {
      rankBefore: optionalNumber(
        ranking.rankBefore as number | string | null | undefined,
      ),
      rankAfter: optionalNumber(
        ranking.rankAfter as number | string | null | undefined,
      ),
      rankDelta: optionalNumber(
        ranking.rankDelta as number | string | null | undefined,
      ),
      isNewToRanking: Boolean(ranking.isNewToRanking),
      gapToPrevious: optionalNumber(
        ranking.gapToPrevious as number | string | null | undefined,
      ),
    },
    social: {
      championDisplayNames: toStringArray(social.championDisplayNames),
      championRoundPoints: optionalNumber(
        social.championRoundPoints as number | string | null | undefined,
      ),
      participantAveragePoints: optionalNumber(
        social.participantAveragePoints as number | string | null | undefined,
      ),
      playerAhead,
    },
    matches: matchesRaw.map((raw) => {
      const row = raw as Record<string, unknown>
      const homeTeam = String(row.homeTeam ?? row.label ?? '')
      const awayTeam = String(row.awayTeam ?? '')
      const label =
        typeof row.label === 'string' && row.label.length > 0
          ? row.label
          : awayTeam
            ? `${homeTeam} – ${awayTeam}`
            : homeTeam
      const homeScore = row.homeScore
      const awayScore = row.awayScore
      const predictedHome = row.predictedHomeScore
      const predictedAway = row.predictedAwayScore
      const hasFinal =
        homeScore != null &&
        awayScore != null &&
        homeScore !== '' &&
        awayScore !== ''
      const hasPrediction =
        predictedHome != null &&
        predictedAway != null &&
        predictedHome !== '' &&
        predictedAway !== ''
      return {
        matchId: String(row.matchId ?? ''),
        label,
        status: String(row.status ?? ''),
        finalScore: hasFinal
          ? { home: Number(homeScore), away: Number(awayScore) }
          : null,
        prediction: hasPrediction
          ? { home: Number(predictedHome), away: Number(predictedAway) }
          : null,
        points: optionalNumber(row.points as number | string | null | undefined),
        predicted: hasPrediction || Boolean(row.predicted),
      }
    }),
    trophies: trophiesRaw.map((raw) => {
      const row = raw as Record<string, unknown>
      return {
        trophyKey: String(row.trophyKey ?? ''),
        name: String(row.name ?? ''),
        icon: String(row.icon ?? ''),
        sourceMatchId:
          row.sourceMatchId == null ? null : String(row.sourceMatchId),
      }
    }),
  }
}

export async function fetchPlayerSeasonTimeline(input: {
  sessionToken: string
  seasonId: string
}): Promise<SeasonTimeline> {
  const data = await rpc<Record<string, unknown>>('get_player_season_timeline', {
    p_session_token: input.sessionToken,
    p_season_id: input.seasonId,
  })
  const roundsRaw = Array.isArray(data.rounds) ? data.rounds : []
  const trophiesRaw = Array.isArray(data.trophies) ? data.trophies : []
  const bestRound = data.bestRound
  const bestRank = data.bestRank

  return {
    seasonId: String(data.seasonId ?? input.seasonId),
    rounds: roundsRaw.map((raw) => {
      const row = raw as Record<string, unknown>
      return {
        roundNumber: Number(row.roundNumber ?? 0),
        roundPoints: Number(row.roundPoints ?? 0),
        rank: optionalNumber(row.rank as number | string | null | undefined),
        gapToPrevious: optionalNumber(
          row.gapToPrevious as number | string | null | undefined,
        ),
      }
    }),
    bestRound:
      bestRound && typeof bestRound === 'object'
        ? {
            roundNumber: Number(
              (bestRound as Record<string, unknown>).roundNumber ?? 0,
            ),
            roundPoints: Number(
              (bestRound as Record<string, unknown>).roundPoints ?? 0,
            ),
          }
        : null,
    bestRank:
      bestRank && typeof bestRank === 'object'
        ? {
            roundNumber: Number(
              (bestRank as Record<string, unknown>).roundNumber ?? 0,
            ),
            rank: Number((bestRank as Record<string, unknown>).rank ?? 0),
          }
        : null,
    trophies: trophiesRaw.map((raw) => {
      const row = raw as Record<string, unknown>
      return {
        id: String(row.id ?? ''),
        trophyKey: String(row.trophyKey ?? ''),
        name: String(row.name ?? ''),
        description: String(row.description ?? ''),
        icon: String(row.icon ?? ''),
        awardedAt: String(row.awardedAt ?? ''),
        sourceRoundNumber: optionalNumber(
          row.sourceRoundNumber as number | string | null | undefined,
        ),
      }
    }),
  }
}
