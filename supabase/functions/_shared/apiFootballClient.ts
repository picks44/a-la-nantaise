import {
  isLiveProviderStatus,
  isTerminalProviderStatus,
  normalizeApiFootballStatus,
  periodSortRank,
  type ProviderStatusNormalized,
} from './apiFootballStatus.ts'

export const API_FOOTBALL_BASE_URL = 'https://v3.football.api-sports.io'
export const API_FOOTBALL_PROVIDER = 'api_football'

export class ApiFootballError extends Error {
  readonly code: string
  readonly httpStatus: number | null

  constructor(code: string, message: string, httpStatus: number | null = null) {
    super(message)
    this.name = 'ApiFootballError'
    this.code = code
    this.httpStatus = httpStatus
  }
}

export interface ApiFootballRateLimits {
  remaining: number | null
  limit: number | null
  reportedCurrent: number | null
  reportedLimit: number | null
}

export interface ApiFootballResponse<T> {
  data: T
  rateLimits: ApiFootballRateLimits
  httpStatus: number
  durationMs: number
}

export interface NormalizedLineupPlayer {
  id: number | null
  name: string
  number: number | null
  position: string | null
  grid: string | null
}

export interface NormalizedLineup {
  teamExternalId: number | null
  teamName: string
  formation: string | null
  coachName: string | null
  startXI: NormalizedLineupPlayer[]
  substitutes: NormalizedLineupPlayer[]
}

export interface NormalizedEvent {
  external_event_key: string
  event_type: string
  detail: string | null
  period: string | null
  elapsed: number | null
  extra: number | null
  team_side: 'home' | 'away' | null
  player_name: string | null
  assist_name: string | null
  sort_period: number
  sort_elapsed: number
  sort_extra: number
}

export interface NormalizedFixtureDetail {
  external_fixture_id: string
  external_league_id: number
  external_season_year: number
  round_label: string | null
  round_number: number | null
  home_team: string
  away_team: string
  home_team_external_id: number | null
  away_team_external_id: number | null
  kickoff_at: string
  venue_name: string | null
  provider_status_raw: string
  provider_status_normalized: ProviderStatusNormalized
  live_elapsed: number | null
  live_extra: number | null
  live_period: string | null
  live_home_score: number | null
  live_away_score: number | null
  ht_home_score: number | null
  ht_away_score: number | null
  proposed_home_score: number | null
  proposed_away_score: number | null
  provider_updated_at: string | null
  lineups: NormalizedLineup[]
  events: NormalizedEvent[]
  statistics: unknown[]
  players_statistics: unknown[]
}

export interface TeamSearchResult {
  externalId: number
  name: string
  code: string | null
  country: string | null
}

export interface CompetitionDiscovery {
  externalLeagueId: number
  name: string
  country: string | null
  type: string | null
  seasonYear: number
  coverage: {
    events: boolean | null
    lineups: boolean | null
    statisticsFixtures: boolean | null
    statisticsPlayers: boolean | null
  }
}

export type FetchLike = (
  input: string,
  init?: { method?: string; headers?: Record<string, string>; signal?: AbortSignal },
) => Promise<{
  ok: boolean
  status: number
  headers: { get(name: string): string | null }
  arrayBuffer(): Promise<ArrayBuffer>
}>

const DEFAULT_TIMEOUT_MS = 12_000
const MAX_BODY_BYTES = 1_500_000

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null
}

function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : []
}

function asNumber(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return value
  if (typeof value === 'string' && value.trim() !== '' && !Number.isNaN(Number(value))) {
    return Number(value)
  }
  return null
}

function asString(value: unknown): string | null {
  return typeof value === 'string' && value.trim() !== '' ? value.trim() : null
}

function parseRateLimits(
  headers: { get(name: string): string | null },
): ApiFootballRateLimits {
  const remaining = asNumber(headers.get('x-ratelimit-requests-remaining'))
  const limit = asNumber(headers.get('x-ratelimit-requests-limit'))
  return {
    remaining,
    limit,
    reportedCurrent: remaining == null || limit == null ? null : limit - remaining,
    reportedLimit: limit,
  }
}

function extractErrors(payload: Record<string, unknown>): string | null {
  const errors = payload.errors
  if (!errors) return null
  if (typeof errors === 'string' && errors.trim()) return errors.trim()
  if (Array.isArray(errors) && errors.length > 0) return JSON.stringify(errors).slice(0, 300)
  if (typeof errors === 'object') {
    const values = Object.values(errors as Record<string, unknown>)
    if (values.length > 0) return String(values[0]).slice(0, 300)
  }
  return null
}

export function buildApiFootballUrl(
  path: string,
  query: Record<string, string | number | undefined | null> = {},
): string {
  const url = new URL(
    path.startsWith('http') ? path : `${API_FOOTBALL_BASE_URL}${path}`,
  )
  for (const [key, value] of Object.entries(query)) {
    if (value == null || value === '') continue
    url.searchParams.set(key, String(value))
  }
  return url.toString()
}

export async function apiFootballGet<T = unknown>(input: {
  apiKey: string
  path: string
  query?: Record<string, string | number | undefined | null>
  fetchImpl?: FetchLike
  timeoutMs?: number
}): Promise<ApiFootballResponse<T>> {
  const apiKey = input.apiKey.trim()
  if (!apiKey) {
    throw new ApiFootballError('PROVIDER_KEY_MISSING', 'Clé API-Football absente.')
  }

  const url = buildApiFootballUrl(input.path, input.query ?? {})
  const fetchImpl = input.fetchImpl ?? (globalThis.fetch as FetchLike)
  const timeoutMs = input.timeoutMs ?? DEFAULT_TIMEOUT_MS
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  const started = Date.now()

  try {
    const response = await fetchImpl(url, {
      method: 'GET',
      headers: {
        'x-apisports-key': apiKey,
        Accept: 'application/json',
      },
      signal: controller.signal,
    })

    const durationMs = Date.now() - started
    const buffer = await response.arrayBuffer()
    if (buffer.byteLength > MAX_BODY_BYTES) {
      throw new ApiFootballError(
        'PROVIDER_RESPONSE_TOO_LARGE',
        'Réponse API-Football trop volumineuse.',
        response.status,
      )
    }

    let parsed: unknown
    try {
      parsed = JSON.parse(new TextDecoder().decode(buffer)) as unknown
    } catch {
      throw new ApiFootballError(
        'PROVIDER_NOT_JSON',
        'Réponse API-Football non JSON.',
        response.status,
      )
    }

    const body = asRecord(parsed)
    const rateLimits = parseRateLimits(response.headers)

    if (response.status === 429) {
      throw new ApiFootballError(
        'PROVIDER_RATE_LIMITED',
        'Limite de débit API-Football atteinte.',
        429,
      )
    }

    if (!response.ok) {
      throw new ApiFootballError(
        'PROVIDER_HTTP_ERROR',
        `Erreur HTTP API-Football (${response.status}).`,
        response.status,
      )
    }

    const apiError = body ? extractErrors(body) : null
    if (apiError) {
      throw new ApiFootballError(
        'PROVIDER_API_ERROR',
        apiError.slice(0, 200),
        response.status,
      )
    }

    return {
      data: (body?.response ?? parsed) as T,
      rateLimits,
      httpStatus: response.status,
      durationMs,
    }
  } catch (error) {
    if (error instanceof ApiFootballError) throw error
    if (error instanceof DOMException && error.name === 'AbortError') {
      throw new ApiFootballError('PROVIDER_TIMEOUT', 'Délai API-Football dépassé.')
    }
    throw new ApiFootballError(
      'PROVIDER_HTTP_ERROR',
      'Impossible de contacter API-Football.',
    )
  } finally {
    clearTimeout(timer)
  }
}

function parseRoundNumber(round: string | null): number | null {
  if (!round) return null
  const match = round.match(/(\d+)/)
  return match ? Number(match[1]) : null
}

function teamSide(
  eventTeamId: number | null,
  homeId: number | null,
  awayId: number | null,
): 'home' | 'away' | null {
  if (eventTeamId == null) return null
  if (homeId != null && eventTeamId === homeId) return 'home'
  if (awayId != null && eventTeamId === awayId) return 'away'
  return null
}

export function normalizeFixtureItem(
  raw: unknown,
  options: {
    includeLineups?: boolean
    includeEvents?: boolean
    includeStatistics?: boolean
    includePlayers?: boolean
  } = {},
): NormalizedFixtureDetail {
  const row = asRecord(raw)
  if (!row) {
    throw new ApiFootballError('PROVIDER_INVALID_FIXTURE', 'Fixture invalide.')
  }

  const fixture = asRecord(row.fixture)
  const league = asRecord(row.league)
  const teams = asRecord(row.teams)
  const goals = asRecord(row.goals)
  const score = asRecord(row.score)
  const status = asRecord(fixture?.status)
  const venue = asRecord(fixture?.venue)
  const home = asRecord(teams?.home)
  const away = asRecord(teams?.away)
  const halftime = asRecord(score?.halftime)
  const fulltime = asRecord(score?.fulltime)

  const externalId = asNumber(fixture?.id)
  const leagueId = asNumber(league?.id)
  const seasonYear = asNumber(league?.season)
  const homeName = asString(home?.name)
  const awayName = asString(away?.name)
  const kickoff = asString(fixture?.date)

  if (
    externalId == null ||
    leagueId == null ||
    seasonYear == null ||
    !homeName ||
    !awayName ||
    !kickoff
  ) {
    throw new ApiFootballError(
      'PROVIDER_INVALID_FIXTURE',
      'Fixture incomplète.',
    )
  }

  const statusShort = asString(status?.short) ?? 'NS'
  const normalized = normalizeApiFootballStatus(statusShort)
  const homeId = asNumber(home?.id)
  const awayId = asNumber(away?.id)
  const liveHome = asNumber(goals?.home)
  const liveAway = asNumber(goals?.away)
  const ftHome = asNumber(fulltime?.home)
  const ftAway = asNumber(fulltime?.away)

  const proposed =
    isTerminalProviderStatus(normalized) &&
    (ftHome != null || liveHome != null) &&
    (ftAway != null || liveAway != null)
      ? {
          home: ftHome ?? liveHome,
          away: ftAway ?? liveAway,
        }
      : { home: null, away: null }

  const eventsRaw = options.includeEvents === false ? [] : asArray(row.events)
  const lineupsRaw = options.includeLineups === false ? [] : asArray(row.lineups)
  const statisticsRaw =
    options.includeStatistics === false ? [] : asArray(row.statistics)
  const playersRaw =
    options.includePlayers === false ? [] : asArray(row.players)

  const events: NormalizedEvent[] = eventsRaw.map((item, index) => {
    const event = asRecord(item) ?? {}
    const time = asRecord(event.time)
    const team = asRecord(event.team)
    const player = asRecord(event.player)
    const assist = asRecord(event.assist)
    const elapsed = asNumber(time?.elapsed)
    const extra = asNumber(time?.extra)
    const type = asString(event.type) ?? 'unknown'
    const detail = asString(event.detail)
    const teamId = asNumber(team?.id)
    const side = teamSide(teamId, homeId, awayId)
    const playerName = asString(player?.name)
    const key = [
      type,
      detail ?? '',
      String(elapsed ?? ''),
      String(extra ?? ''),
      String(teamId ?? ''),
      playerName ?? '',
      String(index),
    ].join('|')

    return {
      external_event_key: key,
      event_type: type.toLowerCase(),
      detail,
      period: statusShort,
      elapsed,
      extra,
      team_side: side,
      player_name: playerName,
      assist_name: asString(assist?.name),
      sort_period: periodSortRank(statusShort),
      sort_elapsed: elapsed ?? 0,
      sort_extra: extra ?? 0,
    }
  })

  events.sort((a, b) => {
    if (a.sort_period !== b.sort_period) return a.sort_period - b.sort_period
    if (a.sort_elapsed !== b.sort_elapsed) return a.sort_elapsed - b.sort_elapsed
    if (a.sort_extra !== b.sort_extra) return a.sort_extra - b.sort_extra
    return a.external_event_key.localeCompare(b.external_event_key)
  })

  const lineups: NormalizedLineup[] = lineupsRaw.map((item) => {
    const lineup = asRecord(item) ?? {}
    const team = asRecord(lineup.team)
    const coach = asRecord(lineup.coach)
    const mapPlayer = (rawPlayer: unknown): NormalizedLineupPlayer => {
      const entry = asRecord(rawPlayer) ?? {}
      const player = asRecord(entry.player) ?? entry
      return {
        id: asNumber(player.id),
        name: asString(player.name) ?? 'Joueur',
        number: asNumber(player.number),
        position: asString(player.pos) ?? asString(player.position),
        grid: asString(player.grid),
      }
    }
    return {
      teamExternalId: asNumber(team?.id),
      teamName: asString(team?.name) ?? 'Équipe',
      formation: asString(lineup.formation),
      coachName: asString(coach?.name),
      startXI: asArray(lineup.startXI).map(mapPlayer),
      substitutes: asArray(lineup.substitutes).map(mapPlayer),
    }
  })

  return {
    external_fixture_id: String(externalId),
    external_league_id: leagueId,
    external_season_year: seasonYear,
    round_label: asString(league?.round),
    round_number: parseRoundNumber(asString(league?.round)),
    home_team: homeName,
    away_team: awayName,
    home_team_external_id: homeId,
    away_team_external_id: awayId,
    kickoff_at: new Date(kickoff).toISOString(),
    venue_name: asString(venue?.name),
    provider_status_raw: statusShort,
    provider_status_normalized: normalized,
    live_elapsed: asNumber(status?.elapsed),
    live_extra: asNumber(status?.extra),
    live_period: statusShort,
    live_home_score: liveHome,
    live_away_score: liveAway,
    ht_home_score: asNumber(halftime?.home),
    ht_away_score: asNumber(halftime?.away),
    proposed_home_score: proposed.home,
    proposed_away_score: proposed.away,
    provider_updated_at: asString(fixture?.date),
    lineups,
    events,
    statistics: statisticsRaw,
    players_statistics: playersRaw,
  }
}

export function normalizeTeamSearchResults(raw: unknown): TeamSearchResult[] {
  return asArray(raw)
    .map((item) => {
      const row = asRecord(item)
      const team = asRecord(row?.team) ?? row
      const id = asNumber(team?.id)
      const name = asString(team?.name)
      if (id == null || !name) return null
      return {
        externalId: id,
        name,
        code: asString(team?.code),
        country: asString(team?.country) ?? asString(asRecord(row?.team)?.country),
      } satisfies TeamSearchResult
    })
    .filter((item): item is TeamSearchResult => item != null)
}

export function normalizeCompetitionsForTeam(raw: unknown): CompetitionDiscovery[] {
  return asArray(raw)
    .map((item) => {
      const row = asRecord(item)
      const league = asRecord(row?.league)
      const seasons = asArray(row?.seasons)
      const leagueId = asNumber(league?.id)
      const name = asString(league?.name)
      if (leagueId == null || !name) return []

      return seasons
        .map((seasonRaw) => {
          const season = asRecord(seasonRaw)
          const year = asNumber(season?.year)
          if (year == null) return null
          const coverage = asRecord(season?.coverage)
          const fixtures = asRecord(coverage?.fixtures)
          return {
            externalLeagueId: leagueId,
            name,
            country: asString(asRecord(row?.country)?.name),
            type: asString(league?.type),
            seasonYear: year,
            coverage: {
              events: fixtures?.events == null ? null : Boolean(fixtures.events),
              lineups: fixtures?.lineups == null ? null : Boolean(fixtures.lineups),
              statisticsFixtures:
                fixtures?.statistics_fixtures == null
                  ? null
                  : Boolean(fixtures.statistics_fixtures),
              statisticsPlayers:
                fixtures?.statistics_players == null
                  ? null
                  : Boolean(fixtures.statistics_players),
            },
          } satisfies CompetitionDiscovery
        })
        .filter((item): item is CompetitionDiscovery => item != null)
    })
    .flat()
}

export function fixtureToShadowPayload(
  fixture: NormalizedFixtureDetail,
  extras: { season_id?: string | null; match_id?: string | null; sync_state?: string } = {},
): Record<string, unknown> {
  return {
    external_fixture_id: fixture.external_fixture_id,
    season_id: extras.season_id ?? null,
    match_id: extras.match_id ?? null,
    external_league_id: fixture.external_league_id,
    external_season_year: fixture.external_season_year,
    round_label: fixture.round_label,
    round_number: fixture.round_number,
    home_team: fixture.home_team,
    away_team: fixture.away_team,
    home_team_external_id: fixture.home_team_external_id,
    away_team_external_id: fixture.away_team_external_id,
    kickoff_at: fixture.kickoff_at,
    venue_name: fixture.venue_name,
    provider_status_raw: fixture.provider_status_raw,
    provider_status_normalized: fixture.provider_status_normalized,
    live_elapsed: fixture.live_elapsed,
    live_extra: fixture.live_extra,
    live_period: fixture.live_period,
    live_home_score: fixture.live_home_score,
    live_away_score: fixture.live_away_score,
    ht_home_score: fixture.ht_home_score,
    ht_away_score: fixture.ht_away_score,
    proposed_home_score: fixture.proposed_home_score,
    proposed_away_score: fixture.proposed_away_score,
    provider_updated_at: fixture.provider_updated_at,
    lineups: fixture.lineups,
    events: fixture.events,
    statistics: fixture.statistics,
    players_statistics: fixture.players_statistics,
    sync_state: extras.sync_state ?? 'synced',
  }
}

export { isLiveProviderStatus, isTerminalProviderStatus }
