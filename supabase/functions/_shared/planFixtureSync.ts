import type { NormalizedFixture } from './fixtureDownload.ts'
import { FIXTURE_SOURCE } from './fixtureDownload.ts'

export interface SyncMatchRow {
  id: string
  externalId: string | null
  source: string
  roundNumber: number
  homeTeam: string
  awayTeam: string
  kickoffAt: string
  status: string
  homeScore: number | null
  awayScore: number | null
  manualOverride: boolean
}

export interface SyncConflict {
  externalId: string
  roundNumber: number
  homeTeam: string
  awayTeam: string
  reason: string
  candidateIds: string[]
}

export interface SyncCreateOp {
  external_id: string
  round_number: number
  home_team: string
  away_team: string
  kickoff_at: string
  status: 'scheduled' | 'finished'
  home_score: number | null
  away_score: number | null
}

export interface SyncUpdateOp {
  id: string
  external_id: string
  round_number: number
  home_team: string
  away_team: string
  kickoff_at: string
  status: string
  home_score: number | null
  away_score: number | null
  source_home_team: string
  source_away_team: string
  source_kickoff_at: string
  source_home_score: number | null
  source_away_score: number | null
  source_status: 'scheduled' | 'finished'
  protected: boolean
  unchanged: boolean
  new_result: boolean
  recalculate: boolean
  drift_teams: boolean
  drift_kickoff: boolean
  drift_result: boolean
}

export interface SyncPlan {
  synced_at: string
  creates: SyncCreateOp[]
  updates: SyncUpdateOp[]
  conflicts: SyncConflict[]
  summary: {
    created: number
    updated: number
    unchanged: number
    newResults: number
    protected: number
    conflicts: number
  }
}

function sameInstant(a: string, b: string): boolean {
  return new Date(a).getTime() === new Date(b).getTime()
}

function scoresEqual(
  aHome: number | null,
  aAway: number | null,
  bHome: number | null,
  bAway: number | null,
): boolean {
  return aHome === bHome && aAway === bAway
}

function findByExternalId(
  matches: SyncMatchRow[],
  claimed: Set<string>,
  externalId: string,
): SyncMatchRow | null {
  const preferred = matches.find(
    (match) =>
      !claimed.has(match.id) &&
      match.source === FIXTURE_SOURCE &&
      match.externalId === externalId,
  )
  if (preferred) return preferred

  return (
    matches.find(
      (match) => !claimed.has(match.id) && match.externalId === externalId,
    ) ?? null
  )
}

function findByRoundAndTeams(
  matches: SyncMatchRow[],
  claimed: Set<string>,
  fixture: NormalizedFixture,
): { match: SyncMatchRow | null; candidates: SyncMatchRow[] } {
  const candidates = matches.filter(
    (match) =>
      !claimed.has(match.id) &&
      match.roundNumber === fixture.roundNumber &&
      match.homeTeam === fixture.homeTeam &&
      match.awayTeam === fixture.awayTeam,
  )

  if (candidates.length === 1) {
    return { match: candidates[0]!, candidates }
  }

  return { match: null, candidates }
}

function resolveWritableState(
  current: SyncMatchRow,
  fixture: NormalizedFixture,
): {
  status: string
  homeScore: number | null
  awayScore: number | null
  newResult: boolean
  recalculate: boolean
} {
  // Report / annulation : restent manuels tant que non levés côté admin.
  if (current.status === 'postponed' || current.status === 'cancelled') {
    return {
      status: current.status,
      homeScore: null,
      awayScore: null,
      newResult: false,
      recalculate: false,
    }
  }

  // Ne jamais rétrograder finished → scheduled sur scores absents.
  if (current.status === 'finished' && fixture.status === 'scheduled') {
    return {
      status: 'finished',
      homeScore: current.homeScore,
      awayScore: current.awayScore,
      newResult: false,
      recalculate: false,
    }
  }

  if (fixture.status === 'finished') {
    const same = scoresEqual(
      current.homeScore,
      current.awayScore,
      fixture.homeScore,
      fixture.awayScore,
    )
    const wasFinished = current.status === 'finished'
    return {
      status: 'finished',
      homeScore: fixture.homeScore,
      awayScore: fixture.awayScore,
      newResult: !wasFinished || !same,
      recalculate: !wasFinished || !same,
    }
  }

  return {
    status: current.status === 'live' ? 'live' : 'scheduled',
    homeScore: null,
    awayScore: null,
    newResult: false,
    recalculate: false,
  }
}

export function planFixtureSync(
  existing: SyncMatchRow[],
  fixtures: NormalizedFixture[],
  syncedAt: string = new Date().toISOString(),
): SyncPlan {
  const claimed = new Set<string>()
  const creates: SyncCreateOp[] = []
  const updates: SyncUpdateOp[] = []
  const conflicts: SyncConflict[] = []

  for (const fixture of fixtures) {
    let match = findByExternalId(existing, claimed, fixture.externalId)

    if (!match) {
      const byTeams = findByRoundAndTeams(existing, claimed, fixture)
      if (byTeams.candidates.length > 1) {
        conflicts.push({
          externalId: fixture.externalId,
          roundNumber: fixture.roundNumber,
          homeTeam: fixture.homeTeam,
          awayTeam: fixture.awayTeam,
          reason: 'AMBIGUOUS_MATCH',
          candidateIds: byTeams.candidates.map((item) => item.id),
        })
        continue
      }
      match = byTeams.match
    }

    if (!match) {
      creates.push({
        external_id: fixture.externalId,
        round_number: fixture.roundNumber,
        home_team: fixture.homeTeam,
        away_team: fixture.awayTeam,
        kickoff_at: fixture.kickoffAt,
        status: fixture.status,
        home_score: fixture.homeScore,
        away_score: fixture.awayScore,
      })
      continue
    }

    claimed.add(match.id)

    const driftTeams =
      match.homeTeam !== fixture.homeTeam || match.awayTeam !== fixture.awayTeam
    const driftKickoff = !sameInstant(match.kickoffAt, fixture.kickoffAt)
    const driftResult =
      match.manualOverride &&
      !scoresEqual(
        match.homeScore,
        match.awayScore,
        fixture.homeScore,
        fixture.awayScore,
      )

    if (match.manualOverride) {
      updates.push({
        id: match.id,
        external_id: fixture.externalId,
        round_number: match.roundNumber,
        home_team: match.homeTeam,
        away_team: match.awayTeam,
        kickoff_at: match.kickoffAt,
        status: match.status,
        home_score: match.homeScore,
        away_score: match.awayScore,
        source_home_team: fixture.homeTeam,
        source_away_team: fixture.awayTeam,
        source_kickoff_at: fixture.kickoffAt,
        source_home_score: fixture.homeScore,
        source_away_score: fixture.awayScore,
        source_status: fixture.status,
        protected: true,
        unchanged: false,
        new_result: false,
        recalculate: false,
        drift_teams: driftTeams,
        drift_kickoff: driftKickoff,
        drift_result: driftResult,
      })
      continue
    }

    const writable = resolveWritableState(match, fixture)
    const metaChanged =
      match.roundNumber !== fixture.roundNumber ||
      driftTeams ||
      driftKickoff ||
      match.externalId !== fixture.externalId ||
      match.source !== FIXTURE_SOURCE
    const resultChanged =
      writable.status !== match.status ||
      !scoresEqual(
        match.homeScore,
        match.awayScore,
        writable.homeScore,
        writable.awayScore,
      )

    const unchanged = !metaChanged && !resultChanged

    updates.push({
      id: match.id,
      external_id: fixture.externalId,
      round_number: fixture.roundNumber,
      home_team: fixture.homeTeam,
      away_team: fixture.awayTeam,
      kickoff_at: fixture.kickoffAt,
      status: writable.status,
      home_score: writable.homeScore,
      away_score: writable.awayScore,
      source_home_team: fixture.homeTeam,
      source_away_team: fixture.awayTeam,
      source_kickoff_at: fixture.kickoffAt,
      source_home_score: fixture.homeScore,
      source_away_score: fixture.awayScore,
      source_status: fixture.status,
      protected: false,
      unchanged,
      new_result: writable.newResult,
      recalculate: writable.recalculate,
      drift_teams: false,
      drift_kickoff: false,
      drift_result: false,
    })
  }

  const summary = {
    created: creates.length,
    updated: updates.filter((item) => !item.protected && !item.unchanged).length,
    unchanged: updates.filter((item) => item.unchanged).length,
    newResults:
      creates.filter((item) => item.status === 'finished').length +
      updates.filter((item) => item.new_result).length,
    protected: updates.filter((item) => item.protected).length,
    conflicts: conflicts.length,
  }

  return {
    synced_at: syncedAt,
    creates,
    updates,
    conflicts,
    summary,
  }
}

export function syncPlanToRpcPayload(plan: SyncPlan) {
  return {
    synced_at: plan.synced_at,
    creates: plan.creates,
    updates: plan.updates,
    conflicts: plan.conflicts,
  }
}
