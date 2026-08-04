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
  kickoff_time_confirmed?: boolean | null
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

export async function loginAdmin(adminCode: string): Promise<string> {
  const rows = await adminRpc<Array<{ session_token: string }>>('login_admin', {
    p_admin_code: adminCode,
  })
  const row = rows?.[0]
  if (!row?.session_token) {
    throw new ApiError('INVALID_ADMIN_CODE', 'INVALID_ADMIN_CODE')
  }
  return row.session_token
}

export async function logoutAdmin(sessionToken: string): Promise<boolean> {
  const result = await adminRpc<boolean>('logout_admin', {
    p_admin_session_token: sessionToken,
  })
  return Boolean(result)
}

export async function verifyAdminSession(sessionToken: string): Promise<boolean> {
  try {
    const result = await adminRpc<boolean>('verify_admin_code', {
      p_admin_session_token: sessionToken,
    })
    return Boolean(result)
  } catch (error) {
    if (getErrorCode(error) === 'ADMIN_CODE_NOT_CONFIGURED') throw error
    return false
  }
}

export async function adminGetPlayers(
  sessionToken: string,
): Promise<AdminPlayer[]> {
  const rows = await adminRpc<DbPlayerRow[]>('admin_get_players', {
    p_admin_session_token: sessionToken,
  })
  return (rows ?? []).map(mapAdminPlayer)
}

export async function adminCreatePlayer(
  sessionToken: string,
  displayName: string,
): Promise<AdminPlayer> {
  const rows = await adminRpc<DbPlayerRow[]>('admin_create_player', {
    p_admin_session_token: sessionToken,
    p_display_name: displayName,
  })
  const row = rows?.[0]
  if (!row) throw new ApiError('RPC_ERROR', 'Création du participant échouée.')
  return mapAdminPlayer(row)
}

export async function adminUpdatePlayerName(
  sessionToken: string,
  playerId: string,
  displayName: string,
): Promise<AdminPlayer> {
  const rows = await adminRpc<DbPlayerRow[]>('admin_update_player_name', {
    p_admin_session_token: sessionToken,
    p_player_id: playerId,
    p_display_name: displayName,
  })
  const row = rows?.[0]
  if (!row) throw new ApiError('RPC_ERROR', 'Mise à jour du participant échouée.')
  return mapAdminPlayer(row)
}

export async function adminSetPlayerActive(
  sessionToken: string,
  playerId: string,
  isActive: boolean,
): Promise<AdminPlayer> {
  const rows = await adminRpc<DbPlayerRow[]>('admin_set_player_active', {
    p_admin_session_token: sessionToken,
    p_player_id: playerId,
    p_is_active: isActive,
  })
  const row = rows?.[0]
  if (!row) throw new ApiError('RPC_ERROR', 'Changement d’état échoué.')
  return mapAdminPlayer(row)
}

export async function adminResetPlayerPin(
  sessionToken: string,
  playerId: string,
): Promise<{ temporaryPin: string; expiresAt: string }> {
  const rows = await adminRpc<
    Array<{ temporary_pin: string; expires_at: string }>
  >('admin_reset_player_pin', {
    p_admin_session_token: sessionToken,
    p_player_id: playerId,
  })
  const row = rows?.[0]
  if (!row?.temporary_pin) {
    throw new ApiError('RPC_ERROR', 'Réinitialisation du PIN échouée.')
  }
  return {
    temporaryPin: row.temporary_pin,
    expiresAt: row.expires_at,
  }
}

export async function adminUnlockPlayerPin(
  sessionToken: string,
  playerId: string,
): Promise<boolean> {
  const result = await adminRpc<boolean>('admin_unlock_player_pin', {
    p_admin_session_token: sessionToken,
    p_player_id: playerId,
  })
  return Boolean(result)
}

export async function adminGetMatches(
  sessionToken: string,
): Promise<AdminMatch[]> {
  const rows = await adminRpc<DbMatchAdminRow[]>('admin_get_matches', {
    p_admin_session_token: sessionToken,
  })
  return sortMatchesForList((rows ?? []).map(mapAdminMatch))
}

export async function adminCreateMatch(
  sessionToken: string,
  input: {
    roundNumber: number
    homeTeam: string
    awayTeam: string
    kickoffAtUtc: string
    status: DbMatchStatus
    homeScore: number | null
    awayScore: number | null
    externalId: string | null
    kickoffTimeConfirmed: boolean
  },
): Promise<AdminMatchMutationResult> {
  const rows = await adminRpc<DbMatchAdminRow[]>('admin_create_match', {
    p_admin_session_token: sessionToken,
    p_round_number: input.roundNumber,
    p_home_team: input.homeTeam,
    p_away_team: input.awayTeam,
    p_kickoff_at: input.kickoffAtUtc,
    p_status: input.status,
    p_home_score: input.homeScore,
    p_away_score: input.awayScore,
    p_external_id: input.externalId,
    p_kickoff_time_confirmed: input.kickoffTimeConfirmed,
  })
  return mapMutationResult(rows)
}

export async function adminUpdateMatch(
  sessionToken: string,
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
    kickoffTimeConfirmed: boolean
  },
): Promise<AdminMatchMutationResult> {
  const rows = await adminRpc<DbMatchAdminRow[]>('admin_update_match', {
    p_admin_session_token: sessionToken,
    p_match_id: matchId,
    p_round_number: input.roundNumber,
    p_home_team: input.homeTeam,
    p_away_team: input.awayTeam,
    p_kickoff_at: input.kickoffAtUtc,
    p_status: input.status,
    p_home_score: input.homeScore,
    p_away_score: input.awayScore,
    p_external_id: input.externalId,
    p_kickoff_time_confirmed: input.kickoffTimeConfirmed,
  })
  return mapMutationResult(rows)
}

export async function adminSetMatchResult(
  sessionToken: string,
  matchId: string,
  homeScore: number,
  awayScore: number,
): Promise<AdminMatchMutationResult> {
  const rows = await adminRpc<DbMatchAdminRow[]>('admin_set_match_result', {
    p_admin_session_token: sessionToken,
    p_match_id: matchId,
    p_home_score: homeScore,
    p_away_score: awayScore,
  })
  return mapMutationResult(rows)
}

export async function adminClearMatchOverride(
  sessionToken: string,
  matchId: string,
): Promise<AdminMatchMutationResult> {
  const rows = await adminRpc<DbMatchAdminRow[]>('admin_clear_match_override', {
    p_admin_session_token: sessionToken,
    p_match_id: matchId,
  })
  return mapMutationResult(rows)
}

export async function adminGetFixtureSyncMeta(
  sessionToken: string,
): Promise<FixtureSyncMeta> {
  const rows = await adminRpc<DbSyncMetaRow[]>('admin_get_fixture_sync_meta', {
    p_admin_session_token: sessionToken,
  })
  const row = rows?.[0]
  return {
    lastSyncedAt: row?.last_synced_at ?? null,
    sourceLabel: row?.source_label ?? 'Fixture Download',
  }
}

export async function syncFcNantesMatches(
  sessionToken: string,
): Promise<FixtureSyncResult> {
  const { data, error } = await getSupabase().functions.invoke('sync-fc-nantes', {
    body: { admin_session_token: sessionToken },
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

export async function adminGetStats(sessionToken: string): Promise<AdminStats> {
  const rows = await adminRpc<DbStatsRow[]>('admin_get_stats', {
    p_admin_session_token: sessionToken,
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
  sessionToken: string,
  newAccessCode: string,
): Promise<boolean> {
  const result = await adminRpc<boolean>('admin_update_access_code', {
    p_admin_session_token: sessionToken,
    p_new_access_code: newAccessCode,
  })
  return Boolean(result)
}

export interface ProviderStatus {
  provider: string
  integrationEnabled: boolean
  shadowEnabled: boolean
  publicProviderEnabled: boolean
  publicActivationMessage: string
  trackedTeamExternalId: number | null
  trackedTeamName: string | null
  trackedTeamVerifiedAt: string | null
  activeSeasonYear: number | null
  dailyQuotaLimit: number
  quotaReserve: number
  quotaDate: string
  reservedCount: number
  consumedCount: number
  releasedCount: number
  remainingUsable: number
  providerReportedCurrent: number | null
  providerReportedLimit: number | null
  lastSuccessfulCallAt: string | null
  lastErrorAt: string | null
  lastErrorCode: string | null
  lastErrorMessage: string | null
  nextScheduledCallAt: string | null
  manualSyncCooldownUntil: string | null
  lastCoverageCheckAt: string | null
}

export interface ProviderCompetition {
  id: string
  externalLeagueId: number
  externalSeasonYear: number
  name: string
  country: string | null
  competitionType: string | null
  enabled: boolean
  coverageEvents: boolean | null
  coverageLineups: boolean | null
  coverageStatisticsFixtures: boolean | null
  coverageStatisticsPlayers: boolean | null
  coverageAccessible: boolean | null
  coverageCheckedAt: string | null
}

export interface ProviderFixtureAdmin {
  id: string
  externalFixtureId: string
  matchId: string | null
  externalLeagueId: number
  externalSeasonYear: number
  roundLabel: string | null
  roundNumber: number | null
  homeTeam: string
  awayTeam: string
  kickoffAt: string
  venueName: string | null
  providerStatusNormalized: string
  liveHomeScore: number | null
  liveAwayScore: number | null
  proposedHomeScore: number | null
  proposedAwayScore: number | null
  lastSyncedAt: string
  syncState: string
  lineupsJson: unknown
  eventsJson: unknown
  statisticsJson: unknown
}

export interface ProviderConflict {
  id: string
  externalFixtureId: string
  reason: string
  candidateMatchIds: string[]
  createdAt: string
}

export async function adminGetProviderStatus(
  sessionToken: string,
): Promise<ProviderStatus> {
  const rows = await adminRpc<
    Array<{
      provider: string
      integration_enabled: boolean
      shadow_enabled: boolean
      public_provider_enabled: boolean
      public_activation_message: string
      tracked_team_external_id: number | null
      tracked_team_name: string | null
      tracked_team_verified_at: string | null
      active_season_year: number | null
      daily_quota_limit: number | string
      quota_reserve: number | string
      quota_date: string
      reserved_count: number | string
      consumed_count: number | string
      released_count: number | string
      remaining_usable: number | string
      provider_reported_current: number | string | null
      provider_reported_limit: number | string | null
      last_successful_call_at: string | null
      last_error_at: string | null
      last_error_code: string | null
      last_error_message: string | null
      next_scheduled_call_at: string | null
      manual_sync_cooldown_until: string | null
      last_coverage_check_at: string | null
    }>
  >('admin_get_provider_status', {
    p_admin_session_token: sessionToken,
  })
  const row = rows?.[0]
  if (!row) {
    throw new ApiError('RPC_ERROR', 'Statut fournisseur indisponible.')
  }
  return {
    provider: row.provider,
    integrationEnabled: Boolean(row.integration_enabled),
    shadowEnabled: Boolean(row.shadow_enabled),
    publicProviderEnabled: Boolean(row.public_provider_enabled),
    publicActivationMessage:
      row.public_activation_message ||
      'Activation publique indisponible en mode shadow',
    trackedTeamExternalId: row.tracked_team_external_id,
    trackedTeamName: row.tracked_team_name,
    trackedTeamVerifiedAt: row.tracked_team_verified_at,
    activeSeasonYear: row.active_season_year,
    dailyQuotaLimit: Number(row.daily_quota_limit),
    quotaReserve: Number(row.quota_reserve),
    quotaDate: row.quota_date,
    reservedCount: Number(row.reserved_count),
    consumedCount: Number(row.consumed_count),
    releasedCount: Number(row.released_count),
    remainingUsable: Number(row.remaining_usable),
    providerReportedCurrent:
      row.provider_reported_current == null
        ? null
        : Number(row.provider_reported_current),
    providerReportedLimit:
      row.provider_reported_limit == null
        ? null
        : Number(row.provider_reported_limit),
    lastSuccessfulCallAt: row.last_successful_call_at,
    lastErrorAt: row.last_error_at,
    lastErrorCode: row.last_error_code,
    lastErrorMessage: row.last_error_message,
    nextScheduledCallAt: row.next_scheduled_call_at,
    manualSyncCooldownUntil: row.manual_sync_cooldown_until,
    lastCoverageCheckAt: row.last_coverage_check_at,
  }
}

export async function adminGetProviderCompetitions(
  sessionToken: string,
): Promise<ProviderCompetition[]> {
  const rows = await adminRpc<
    Array<{
      id: string
      external_league_id: number
      external_season_year: number
      name: string
      country: string | null
      competition_type: string | null
      enabled: boolean
      coverage_events: boolean | null
      coverage_lineups: boolean | null
      coverage_statistics_fixtures: boolean | null
      coverage_statistics_players: boolean | null
      coverage_accessible: boolean | null
      coverage_checked_at: string | null
    }>
  >('admin_get_provider_competitions', {
    p_admin_session_token: sessionToken,
  })
  return (rows ?? []).map((row) => ({
    id: row.id,
    externalLeagueId: row.external_league_id,
    externalSeasonYear: row.external_season_year,
    name: row.name,
    country: row.country,
    competitionType: row.competition_type,
    enabled: Boolean(row.enabled),
    coverageEvents: row.coverage_events,
    coverageLineups: row.coverage_lineups,
    coverageStatisticsFixtures: row.coverage_statistics_fixtures,
    coverageStatisticsPlayers: row.coverage_statistics_players,
    coverageAccessible: row.coverage_accessible,
    coverageCheckedAt: row.coverage_checked_at,
  }))
}

export async function adminUpdateProviderSettings(
  sessionToken: string,
  input: {
    integrationEnabled?: boolean
    trackedTeamExternalId?: number | null
    trackedTeamName?: string | null
    activeSeasonYear?: number | null
    markTeamVerified?: boolean
  },
): Promise<void> {
  await adminRpc('admin_update_provider_settings', {
    p_admin_session_token: sessionToken,
    p_integration_enabled: input.integrationEnabled ?? null,
    p_tracked_team_external_id: input.trackedTeamExternalId ?? null,
    p_tracked_team_name: input.trackedTeamName ?? null,
    p_active_season_year: input.activeSeasonYear ?? null,
    p_mark_team_verified: input.markTeamVerified ?? false,
  })
}

export async function adminListProviderFixtures(
  sessionToken: string,
  limit = 40,
): Promise<ProviderFixtureAdmin[]> {
  const rows = await adminRpc<
    Array<{
      id: string
      external_fixture_id: string
      match_id: string | null
      external_league_id: number
      external_season_year: number
      round_label: string | null
      round_number: number | null
      home_team: string
      away_team: string
      kickoff_at: string
      venue_name: string | null
      provider_status_normalized: string
      live_home_score: number | null
      live_away_score: number | null
      proposed_home_score: number | null
      proposed_away_score: number | null
      last_synced_at: string
      sync_state: string
      lineups_json: unknown
      events_json: unknown
      statistics_json: unknown
    }>
  >('admin_list_provider_fixtures', {
    p_admin_session_token: sessionToken,
    p_limit: limit,
  })
  return (rows ?? []).map((row) => ({
    id: row.id,
    externalFixtureId: row.external_fixture_id,
    matchId: row.match_id,
    externalLeagueId: row.external_league_id,
    externalSeasonYear: row.external_season_year,
    roundLabel: row.round_label,
    roundNumber: row.round_number,
    homeTeam: row.home_team,
    awayTeam: row.away_team,
    kickoffAt: row.kickoff_at,
    venueName: row.venue_name,
    providerStatusNormalized: row.provider_status_normalized,
    liveHomeScore: row.live_home_score,
    liveAwayScore: row.live_away_score,
    proposedHomeScore: row.proposed_home_score,
    proposedAwayScore: row.proposed_away_score,
    lastSyncedAt: row.last_synced_at,
    syncState: row.sync_state,
    lineupsJson: row.lineups_json,
    eventsJson: row.events_json,
    statisticsJson: row.statistics_json,
  }))
}

export async function adminListProviderConflicts(
  sessionToken: string,
): Promise<ProviderConflict[]> {
  const rows = await adminRpc<
    Array<{
      id: string
      external_fixture_id: string
      reason: string
      candidate_match_ids: string[] | null
      created_at: string
    }>
  >('admin_list_provider_conflicts', {
    p_admin_session_token: sessionToken,
  })
  return (rows ?? []).map((row) => ({
    id: row.id,
    externalFixtureId: row.external_fixture_id,
    reason: row.reason,
    candidateMatchIds: row.candidate_match_ids ?? [],
    createdAt: row.created_at,
  }))
}

export async function adminResolveProviderConflict(
  sessionToken: string,
  conflictId: string,
  matchId: string,
): Promise<void> {
  await adminRpc('admin_resolve_provider_conflict', {
    p_admin_session_token: sessionToken,
    p_conflict_id: conflictId,
    p_match_id: matchId,
  })
}

export async function adminValidateProviderProposedResult(
  sessionToken: string,
  matchId: string,
): Promise<{ recalculatedCount: number }> {
  const rows = await adminRpc<Array<{ recalculated_count: number | string }>>(
    'admin_validate_provider_proposed_result',
    {
      p_admin_session_token: sessionToken,
      p_match_id: matchId,
    },
  )
  return { recalculatedCount: Number(rows?.[0]?.recalculated_count ?? 0) }
}

async function invokeApiFootball(
  sessionToken: string,
  body: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  const { data, error } = await getSupabase().functions.invoke(
    'sync-api-football',
    {
      body: { ...body, admin_session_token: sessionToken },
    },
  )

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
      error.message || 'La synchronisation API-Football a échoué.',
    )
  }

  const payload = (data ?? {}) as {
    ok?: boolean
    error?: { code?: string; message?: string }
  }
  if (!payload.ok) {
    throw new ApiError(
      payload.error?.code ?? 'SYNC_FAILED',
      payload.error?.message ?? 'La synchronisation API-Football a échoué.',
    )
  }
  return data as Record<string, unknown>
}

export async function syncApiFootballManual(
  sessionToken: string,
): Promise<Record<string, unknown>> {
  return invokeApiFootball(sessionToken, { mode: 'manual' })
}

export async function discoverApiFootballTeam(
  sessionToken: string,
  teamSearch: string,
): Promise<Record<string, unknown>> {
  return invokeApiFootball(sessionToken, {
    mode: 'discover',
    team_search: teamSearch,
  })
}

export async function refreshApiFootballCoverage(
  sessionToken: string,
): Promise<Record<string, unknown>> {
  return invokeApiFootball(sessionToken, { mode: 'coverage' })
}

export { TRACKED_TEAM }
