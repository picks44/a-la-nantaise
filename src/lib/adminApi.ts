import type { DbMatchStatus } from '../types'
import { ApiError, getErrorCode } from './errors'
import { mapMatch, TRACKED_TEAM } from './api'
import { getSupabase } from './supabase'
import type { Match } from '../types'

export interface AdminPlayer {
  id: string
  pseudo: string
  isActive: boolean
  createdAt: string
}

export interface AdminMatch extends Match {
  externalId: string | null
  createdAt: string
  updatedAt: string
}

export interface AdminMatchMutationResult {
  match: AdminMatch
  recalculatedCount: number
}

export interface AdminStats {
  playersCount: number
  activePlayersCount: number
  matchesCount: number
  finishedMatchesCount: number
  supabaseOk: boolean
}

interface DbPlayerRow {
  id: string
  display_name: string
  is_active: boolean
  created_at: string
}

interface DbMatchAdminRow {
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
  recalculated_count?: number | string
}

interface DbStatsRow {
  players_count: number | string
  active_players_count: number | string
  matches_count: number | string
  finished_matches_count: number | string
  supabase_ok: boolean
}

async function adminRpc<T>(
  fn: string,
  args: Record<string, unknown>,
): Promise<T> {
  const { data, error } = await getSupabase().rpc(fn, args)
  if (error) {
    const code = getErrorCode(error) ?? 'RPC_ERROR'
    throw new ApiError(code, error.message)
  }
  return data as T
}

function mapAdminPlayer(row: DbPlayerRow): AdminPlayer {
  return {
    id: row.id,
    pseudo: row.display_name,
    isActive: row.is_active,
    createdAt: row.created_at,
  }
}

function mapAdminMatch(row: DbMatchAdminRow): AdminMatch {
  const base = mapMatch(row)
  return {
    ...base,
    externalId: row.external_id,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }
}

function mapMutationResult(rows: DbMatchAdminRow[] | null): AdminMatchMutationResult {
  const row = rows?.[0]
  if (!row) {
    throw new ApiError('RPC_ERROR', 'Aucune donnée renvoyée par l’administration.')
  }
  return {
    match: mapAdminMatch(row),
    recalculatedCount: Number(row.recalculated_count ?? 0),
  }
}

export async function verifyAdminCode(adminCode: string): Promise<boolean> {
  try {
    const result = await adminRpc<boolean>('verify_admin_code', {
      p_admin_code: adminCode,
    })
    return Boolean(result)
  } catch (error) {
    if (getErrorCode(error) === 'ADMIN_CODE_NOT_CONFIGURED') throw error
    return false
  }
}

export async function adminGetPlayers(adminCode: string): Promise<AdminPlayer[]> {
  const rows = await adminRpc<DbPlayerRow[]>('admin_get_players', {
    p_admin_code: adminCode,
  })
  return (rows ?? []).map(mapAdminPlayer)
}

export async function adminCreatePlayer(
  adminCode: string,
  displayName: string,
): Promise<AdminPlayer> {
  const rows = await adminRpc<DbPlayerRow[]>('admin_create_player', {
    p_admin_code: adminCode,
    p_display_name: displayName,
  })
  const row = rows?.[0]
  if (!row) throw new ApiError('RPC_ERROR', 'Création du participant échouée.')
  return mapAdminPlayer(row)
}

export async function adminUpdatePlayerName(
  adminCode: string,
  playerId: string,
  displayName: string,
): Promise<AdminPlayer> {
  const rows = await adminRpc<DbPlayerRow[]>('admin_update_player_name', {
    p_admin_code: adminCode,
    p_player_id: playerId,
    p_display_name: displayName,
  })
  const row = rows?.[0]
  if (!row) throw new ApiError('RPC_ERROR', 'Mise à jour du participant échouée.')
  return mapAdminPlayer(row)
}

export async function adminSetPlayerActive(
  adminCode: string,
  playerId: string,
  isActive: boolean,
): Promise<AdminPlayer> {
  const rows = await adminRpc<DbPlayerRow[]>('admin_set_player_active', {
    p_admin_code: adminCode,
    p_player_id: playerId,
    p_is_active: isActive,
  })
  const row = rows?.[0]
  if (!row) throw new ApiError('RPC_ERROR', 'Changement d’état échoué.')
  return mapAdminPlayer(row)
}

export async function adminGetMatches(adminCode: string): Promise<AdminMatch[]> {
  const rows = await adminRpc<DbMatchAdminRow[]>('admin_get_matches', {
    p_admin_code: adminCode,
  })
  return (rows ?? []).map(mapAdminMatch)
}

export async function adminCreateMatch(
  adminCode: string,
  input: {
    roundNumber: number
    homeTeam: string
    awayTeam: string
    kickoffAtUtc: string
    status: DbMatchStatus
    homeScore: number | null
    awayScore: number | null
    externalId: string | null
  },
): Promise<AdminMatchMutationResult> {
  const rows = await adminRpc<DbMatchAdminRow[]>('admin_create_match', {
    p_admin_code: adminCode,
    p_round_number: input.roundNumber,
    p_home_team: input.homeTeam,
    p_away_team: input.awayTeam,
    p_kickoff_at: input.kickoffAtUtc,
    p_status: input.status,
    p_home_score: input.homeScore,
    p_away_score: input.awayScore,
    p_external_id: input.externalId,
  })
  return mapMutationResult(rows)
}

export async function adminUpdateMatch(
  adminCode: string,
  matchId: string,
  input: {
    roundNumber: number
    homeTeam: string
    awayTeam: string
    kickoffAtUtc: string
    status: DbMatchStatus
    homeScore: number | null
    awayScore: number | null
    externalId: string | null
  },
): Promise<AdminMatchMutationResult> {
  const rows = await adminRpc<DbMatchAdminRow[]>('admin_update_match', {
    p_admin_code: adminCode,
    p_match_id: matchId,
    p_round_number: input.roundNumber,
    p_home_team: input.homeTeam,
    p_away_team: input.awayTeam,
    p_kickoff_at: input.kickoffAtUtc,
    p_status: input.status,
    p_home_score: input.homeScore,
    p_away_score: input.awayScore,
    p_external_id: input.externalId,
  })
  return mapMutationResult(rows)
}

export async function adminSetMatchResult(
  adminCode: string,
  matchId: string,
  homeScore: number,
  awayScore: number,
): Promise<AdminMatchMutationResult> {
  const rows = await adminRpc<DbMatchAdminRow[]>('admin_set_match_result', {
    p_admin_code: adminCode,
    p_match_id: matchId,
    p_home_score: homeScore,
    p_away_score: awayScore,
  })
  return mapMutationResult(rows)
}

export async function adminGetStats(adminCode: string): Promise<AdminStats> {
  const rows = await adminRpc<DbStatsRow[]>('admin_get_stats', {
    p_admin_code: adminCode,
  })
  const row = rows?.[0]
  if (!row) {
    throw new ApiError('RPC_ERROR', 'Impossible de récupérer les statistiques.')
  }
  return {
    playersCount: Number(row.players_count),
    activePlayersCount: Number(row.active_players_count),
    matchesCount: Number(row.matches_count),
    finishedMatchesCount: Number(row.finished_matches_count),
    supabaseOk: Boolean(row.supabase_ok),
  }
}

export { TRACKED_TEAM }
