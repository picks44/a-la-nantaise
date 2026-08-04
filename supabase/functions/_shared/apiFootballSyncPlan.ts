import {
  isLiveProviderStatus,
  isTerminalProviderStatus,
  type ProviderStatusNormalized,
} from './apiFootballStatus.ts'
import type { NormalizedFixtureDetail } from './apiFootballClient.ts'

export type SyncPhase =
  | 'idle'
  | 'daily_calendar'
  | 'pre_match_15'
  | 'pre_match_5'
  | 'live'
  | 'post_match_immediate'
  | 'post_match_10'
  | 'post_match_60'
  | 'coverage'

export interface LocalMatchRow {
  id: string
  season_id: string
  external_id: string | null
  source: string
  round_number: number
  home_team: string
  away_team: string
  kickoff_at: string
  status: string
  manual_override: boolean
  kickoff_time_confirmed?: boolean
  home_score: number | null
  away_score: number | null
  official_result_source?: string | null
}

export interface LocalProviderFixtureRow {
  id: string
  external_fixture_id: string
  match_id: string | null
  kickoff_at: string
  provider_status_normalized: string
  last_synced_at: string | null
  external_league_id: number
  external_season_year: number
}

export interface SyncDecision {
  phase: SyncPhase
  shouldCallExternal: boolean
  reason: string
  targetExternalFixtureId: string | null
  nextScheduledCallAt: string
  intervalMinutes: number | null
}

const MS_MINUTE = 60_000
const LIVE_MAX_DURATION_MS = 3.5 * 60 * 60 * 1000

function parseTime(value: string): number {
  return new Date(value).getTime()
}

function pickFocusFixture(
  now: number,
  fixtures: LocalProviderFixtureRow[],
): LocalProviderFixtureRow | null {
  const upcoming = fixtures
    .filter((f) => !isTerminalProviderStatus(f.provider_status_normalized as ProviderStatusNormalized))
    .sort((a, b) => parseTime(a.kickoff_at) - parseTime(b.kickoff_at))

  const live = upcoming.find((f) =>
    isLiveProviderStatus(f.provider_status_normalized as ProviderStatusNormalized),
  )
  if (live) return live

  const next = upcoming.find((f) => parseTime(f.kickoff_at) >= now - 5 * MS_MINUTE)
  return next ?? upcoming[0] ?? null
}

/**
 * Décide si un tick cron doit appeler l’API, en s’appuyant uniquement sur l’état local.
 */
export function decideSyncTick(input: {
  now?: Date
  remainingUsable: number
  lastCoverageCheckAt: string | null
  providerFixtures: LocalProviderFixtureRow[]
  calendarSyncedToday: boolean
}): SyncDecision {
  const nowDate = input.now ?? new Date()
  const now = nowDate.getTime()

  if (input.remainingUsable < 1) {
    return {
      phase: 'idle',
      shouldCallExternal: false,
      reason: 'quota_exhausted',
      targetExternalFixtureId: null,
      nextScheduledCallAt: new Date(now + 60 * MS_MINUTE).toISOString(),
      intervalMinutes: 60,
    }
  }

  const focus = pickFocusFixture(now, input.providerFixtures)

  if (!focus) {
    if (!input.calendarSyncedToday) {
      return {
        phase: 'daily_calendar',
        shouldCallExternal: true,
        reason: 'daily_calendar_needed',
        targetExternalFixtureId: null,
        nextScheduledCallAt: new Date(now + 24 * 60 * MS_MINUTE).toISOString(),
        intervalMinutes: null,
      }
    }
    return {
      phase: 'idle',
      shouldCallExternal: false,
      reason: 'no_upcoming_fixture',
      targetExternalFixtureId: null,
      nextScheduledCallAt: new Date(now + 6 * 60 * MS_MINUTE).toISOString(),
      intervalMinutes: 360,
    }
  }

  const kickoff = parseTime(focus.kickoff_at)
  const lastSynced = focus.last_synced_at ? parseTime(focus.last_synced_at) : 0
  const status = focus.provider_status_normalized as ProviderStatusNormalized
  const minutesToKickoff = (kickoff - now) / MS_MINUTE

  if (isLiveProviderStatus(status)) {
    if (now - kickoff > LIVE_MAX_DURATION_MS) {
      return {
        phase: 'idle',
        shouldCallExternal: false,
        reason: 'live_max_duration',
        targetExternalFixtureId: focus.external_fixture_id,
        nextScheduledCallAt: new Date(now + 30 * MS_MINUTE).toISOString(),
        intervalMinutes: 30,
      }
    }
    const due = now - lastSynced >= 2 * MS_MINUTE
    return {
      phase: 'live',
      shouldCallExternal: due,
      reason: due ? 'live_refresh' : 'live_wait',
      targetExternalFixtureId: focus.external_fixture_id,
      nextScheduledCallAt: new Date(now + 2 * MS_MINUTE).toISOString(),
      intervalMinutes: 2,
    }
  }

  if (isTerminalProviderStatus(status) && status === 'finished') {
    const sinceKickoff = now - kickoff
    const windows = [
      { phase: 'post_match_immediate' as const, at: 0, interval: 0 },
      { phase: 'post_match_10' as const, at: 10 * MS_MINUTE, interval: 10 },
      { phase: 'post_match_60' as const, at: 60 * MS_MINUTE, interval: 60 },
    ]
    for (const window of windows) {
      if (sinceKickoff >= window.at && lastSynced < kickoff + window.at + MS_MINUTE) {
        return {
          phase: window.phase,
          shouldCallExternal: true,
          reason: window.phase,
          targetExternalFixtureId: focus.external_fixture_id,
          nextScheduledCallAt: new Date(now + Math.max(window.interval, 10) * MS_MINUTE).toISOString(),
          intervalMinutes: window.interval || 10,
        }
      }
    }
  }

  if (minutesToKickoff <= 15 && minutesToKickoff > 0) {
    const due = now - lastSynced >= 5 * MS_MINUTE
    return {
      phase: 'pre_match_5',
      shouldCallExternal: due,
      reason: due ? 'pre_match_5' : 'pre_match_5_wait',
      targetExternalFixtureId: focus.external_fixture_id,
      nextScheduledCallAt: new Date(now + 5 * MS_MINUTE).toISOString(),
      intervalMinutes: 5,
    }
  }

  if (minutesToKickoff <= 60 && minutesToKickoff > 15) {
    const due = now - lastSynced >= 15 * MS_MINUTE
    return {
      phase: 'pre_match_15',
      shouldCallExternal: due,
      reason: due ? 'pre_match_15' : 'pre_match_15_wait',
      targetExternalFixtureId: focus.external_fixture_id,
      nextScheduledCallAt: new Date(now + 15 * MS_MINUTE).toISOString(),
      intervalMinutes: 15,
    }
  }

  if (!input.calendarSyncedToday) {
    return {
      phase: 'daily_calendar',
      shouldCallExternal: true,
      reason: 'daily_calendar_needed',
      targetExternalFixtureId: null,
      nextScheduledCallAt: new Date(now + 60 * MS_MINUTE).toISOString(),
      intervalMinutes: 60,
    }
  }

  const coverageStale =
    !input.lastCoverageCheckAt ||
    now - parseTime(input.lastCoverageCheckAt) > 24 * 60 * MS_MINUTE

  if (coverageStale && input.remainingUsable >= 2) {
    return {
      phase: 'coverage',
      shouldCallExternal: true,
      reason: 'coverage_daily',
      targetExternalFixtureId: null,
      nextScheduledCallAt: new Date(now + 12 * 60 * MS_MINUTE).toISOString(),
      intervalMinutes: 720,
    }
  }

  return {
    phase: 'idle',
    shouldCallExternal: false,
    reason: 'waiting_next_window',
    targetExternalFixtureId: focus.external_fixture_id,
    nextScheduledCallAt:
      minutesToKickoff > 60
        ? new Date(kickoff - 60 * MS_MINUTE).toISOString()
        : new Date(now + 15 * MS_MINUTE).toISOString(),
    intervalMinutes: null,
  }
}

export interface MatchConflict {
  externalId: string
  reason: string
  candidateIds: string[]
}

export interface MatchPlanResult {
  matchId: string | null
  conflict: MatchConflict | null
}

const DATE_WINDOW_MS = 36 * 60 * 60 * 1000

function teamNamesMatch(a: string, b: string): boolean {
  return a.trim().toLowerCase() === b.trim().toLowerCase()
}

/**
 * Rapprochement prudent : external_id d’abord, sinon équipes + fenêtre de date.
 * Ambiguïté → conflit, pas de fusion.
 */
export function planFixtureMatchLink(
  fixture: NormalizedFixtureDetail,
  matches: LocalMatchRow[],
  existingLinks: LocalProviderFixtureRow[],
): MatchPlanResult {
  const already = existingLinks.find(
    (row) => row.external_fixture_id === fixture.external_fixture_id && row.match_id,
  )
  if (already?.match_id) {
    return { matchId: already.match_id, conflict: null }
  }

  const byExternal = matches.filter(
    (match) =>
      match.external_id === fixture.external_fixture_id ||
      match.external_id === `api_football:${fixture.external_fixture_id}`,
  )
  if (byExternal.length === 1) {
    return { matchId: byExternal[0]!.id, conflict: null }
  }
  if (byExternal.length > 1) {
    return {
      matchId: null,
      conflict: {
        externalId: fixture.external_fixture_id,
        reason: 'AMBIGUOUS_EXTERNAL_ID',
        candidateIds: byExternal.map((m) => m.id),
      },
    }
  }

  const kickoff = parseTime(fixture.kickoff_at)
  const candidates = matches.filter((match) => {
    const delta = Math.abs(parseTime(match.kickoff_at) - kickoff)
    if (delta > DATE_WINDOW_MS) return false
    return (
      (teamNamesMatch(match.home_team, fixture.home_team) &&
        teamNamesMatch(match.away_team, fixture.away_team)) ||
      (teamNamesMatch(match.home_team, fixture.away_team) &&
        teamNamesMatch(match.away_team, fixture.home_team))
    )
  })

  if (candidates.length === 1) {
    return { matchId: candidates[0]!.id, conflict: null }
  }
  if (candidates.length > 1) {
    return {
      matchId: null,
      conflict: {
        externalId: fixture.external_fixture_id,
        reason: 'AMBIGUOUS_MATCH',
        candidateIds: candidates.map((m) => m.id),
      },
    }
  }

  return { matchId: null, conflict: null }
}
