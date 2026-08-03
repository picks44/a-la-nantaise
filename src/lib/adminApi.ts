import type { DbMatchStatus } from '../types'
import { ApiError, getErrorCode } from './errors'
import { mapMatch, TRACKED_TEAM } from './api'
import { sortMatchesForList } from './matchOrder'
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
  source: 'manual' | 'fixturedownload' | string
  lastSyncedAt: string | null
  manualOverride: boolean
  sourceHomeTeam: string | null
  sourceAwayTeam: string | null
  sourceKickoffAt: string | null
  sourceHomeScore: number | null
  sourceAwayScore: number | null
  sourceStatus: 'scheduled' | 'finished' | null
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

export interface FixtureSyncMeta {
  lastSyncedAt: string | null
  sourceLabel: string
}

export interface FixtureSyncProtectedDetail {
  id: string
  externalId: string
  driftTeams: boolean
  driftKickoff: boolean
  driftResult: boolean
}

export interface FixtureSyncResult {
  ok: true
  source: string
  created: number
  updated: number
  unchanged: number
  newResults: number
  pointsRecalculated: number
  protected: number
  conflicts: unknown[]
  protectedDetails: FixtureSyncProtectedDetail[]
  lastSyncedAt: string | null
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
  source?: string | null
  last_synced_at?: string | null
  manual_override?: boolean | null
  source_home_team?: string | null
  source_away_team?: string | null
  source_kickoff_at?: string | null
  source_home_score?: number | null
  source_away_score?: number | null
  source_status?: string | null
  recalculated_count?: number | string
}

interface DbStatsRow {
  players_count: number | string
  active_players_count: number | string
  matches_count: number | string
  finished_matches_count: number | string
  supabase_ok: boolean
}

interface DbSyncMetaRow {
  last_synced_at: string | null
  source_label: string
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
    source: row.source ?? 'manual',
    lastSyncedAt: row.last_synced_at ?? null,
    manualOverride: Boolean(row.manual_override),
    sourceHomeTeam: row.source_home_team ?? null,
    sourceAwayTeam: row.source_away_team ?? null,
    sourceKickoffAt: row.source_kickoff_at ?? null,
    sourceHomeScore: row.source_home_score ?? null,
    sourceAwayScore: row.source_away_score ?? null,
    sourceStatus:
      row.source_status === 'scheduled' || row.source_status === 'finished'
        ? row.source_status
        : null,
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

export function matchSyncBadge(
  match: AdminMatch,
): 'synced' | 'manual_override' | 'manual' {
  if (match.manualOverride) return 'manual_override'
  if (match.source === 'fixturedownload') return 'synced'
  return 'manual'
}

export function matchHasSourceDrift(match: AdminMatch): boolean {
  if (!match.manualOverride || match.source !== 'fixturedownload') return false
  if (!match.sourceHomeTeam || !match.sourceAwayTeam || !match.sourceKickoffAt) {
    return false
  }
  const teamsDiffer =
    match.homeTeam !== match.sourceHomeTeam ||
    match.awayTeam !== match.sourceAwayTeam
  const kickoffDiffer =
    new Date(match.kickoffAt).getTime() !==
    new Date(match.sourceKickoffAt).getTime()
  return teamsDiffer || kickoffDiffer
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
  return sortMatchesForList((rows ?? []).map(mapAdminMatch))
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

export async function adminClearMatchOverride(
  adminCode: string,
  matchId: string,
): Promise<AdminMatchMutationResult> {
  const rows = await adminRpc<DbMatchAdminRow[]>('admin_clear_match_override', {
    p_admin_code: adminCode,
    p_match_id: matchId,
  })
  return mapMutationResult(rows)
}

export async function adminGetFixtureSyncMeta(
  adminCode: string,
): Promise<FixtureSyncMeta> {
  const rows = await adminRpc<DbSyncMetaRow[]>('admin_get_fixture_sync_meta', {
    p_admin_code: adminCode,
  })
  const row = rows?.[0]
  return {
    lastSyncedAt: row?.last_synced_at ?? null,
    sourceLabel: row?.source_label ?? 'Fixture Download',
  }
}

export async function syncFcNantesMatches(
  adminCode: string,
): Promise<FixtureSyncResult> {
  const { data, error } = await getSupabase().functions.invoke('sync-fc-nantes', {
    body: { admin_code: adminCode },
  })

  if (error) {
    const nested =
      data && typeof data === 'object'
        ? (data as { error?: { code?: string; message?: string } }).error
        : null
    if (nested?.code) {
      throw new ApiError(nested.code, nested.message ?? nested.code)
    }
    throw new ApiError(
      getErrorCode(error) ?? 'SYNC_FAILED',
      error.message || 'La synchronisation a échoué.',
    )
  }

  const payload = data as {
    ok?: boolean
    error?: { code?: string; message?: string }
    source?: string
    created?: number
    updated?: number
    unchanged?: number
    new_results?: number
    points_recalculated?: number
    protected?: number
    conflicts?: unknown[]
    protected_details?: Array<{
      id: string
      external_id: string
      drift_teams: boolean
      drift_kickoff: boolean
      drift_result: boolean
    }>
    last_synced_at?: string | null
  }

  if (!payload?.ok) {
    throw new ApiError(
      payload?.error?.code ?? 'SYNC_FAILED',
      payload?.error?.message ?? 'La synchronisation a échoué.',
    )
  }

  return {
    ok: true,
    source: payload.source ?? 'Fixture Download',
    created: Number(payload.created ?? 0),
    updated: Number(payload.updated ?? 0),
    unchanged: Number(payload.unchanged ?? 0),
    newResults: Number(payload.new_results ?? 0),
    pointsRecalculated: Number(payload.points_recalculated ?? 0),
    protected: Number(payload.protected ?? 0),
    conflicts: payload.conflicts ?? [],
    protectedDetails: (payload.protected_details ?? []).map((item) => ({
      id: item.id,
      externalId: item.external_id,
      driftTeams: item.drift_teams,
      driftKickoff: item.drift_kickoff,
      driftResult: item.drift_result,
    })),
    lastSyncedAt: payload.last_synced_at ?? null,
  }
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

export const ACCESS_CODE_MIN_LENGTH = 4
export const ACCESS_CODE_MAX_LENGTH = 64

export async function adminUpdateAccessCode(
  adminCode: string,
  newAccessCode: string,
): Promise<boolean> {
  const result = await adminRpc<boolean>('admin_update_access_code', {
    p_admin_code: adminCode,
    p_new_access_code: newAccessCode,
  })
  return Boolean(result)
}

export { TRACKED_TEAM }
