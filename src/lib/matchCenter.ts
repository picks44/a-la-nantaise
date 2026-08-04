export interface MatchCenterEvent {
  external_event_key?: string
  event_type: string
  detail?: string | null
  elapsed?: number | null
  extra?: number | null
  team_side?: 'home' | 'away' | null
  player_name?: string | null
  assist_name?: string | null
}

export interface MatchCenterLineupPlayer {
  name: string
  number?: number | null
  position?: string | null
}

export interface MatchCenterLineup {
  teamName: string
  formation?: string | null
  coachName?: string | null
  startXI: MatchCenterLineupPlayer[]
  substitutes: MatchCenterLineupPlayer[]
}

export interface MatchCenterData {
  homeTeam: string
  awayTeam: string
  kickoffAt: string
  venueName?: string | null
  roundLabel?: string | null
  statusNormalized: string
  liveHomeScore?: number | null
  liveAwayScore?: number | null
  htHomeScore?: number | null
  htAwayScore?: number | null
  liveElapsed?: number | null
  liveExtra?: number | null
  lastSyncedAt?: string | null
  lineups?: MatchCenterLineup[]
  events?: MatchCenterEvent[]
  statistics?: unknown[]
  stale?: boolean
  phase: 'before' | 'live' | 'after'
}

export function mapProviderFixtureToMatchCenter(input: {
  homeTeam: string
  awayTeam: string
  kickoffAt: string
  venueName?: string | null
  roundLabel?: string | null
  statusNormalized: string
  liveHomeScore?: number | null
  liveAwayScore?: number | null
  htHomeScore?: number | null
  htAwayScore?: number | null
  liveElapsed?: number | null
  liveExtra?: number | null
  lastSyncedAt?: string | null
  lineupsJson?: unknown
  eventsJson?: unknown
  statisticsJson?: unknown
}): MatchCenterData {
  const status = input.statusNormalized
  const kickoff = new Date(input.kickoffAt).getTime()
  const now = Date.now()
  let phase: MatchCenterData['phase'] = 'before'
  if (
    status === 'finished' ||
    status === 'cancelled' ||
    status === 'abandoned' ||
    status === 'awarded'
  ) {
    phase = 'after'
  } else if (
    status === 'first_half' ||
    status === 'halftime' ||
    status === 'second_half' ||
    status === 'extra_time' ||
    status === 'penalty' ||
    now >= kickoff
  ) {
    phase = 'live'
  }

  const lineupsRaw = Array.isArray(input.lineupsJson) ? input.lineupsJson : []
  const lineups = lineupsRaw.map((raw) => {
    const row = raw as {
      teamName?: string
      formation?: string | null
      coachName?: string | null
      startXI?: MatchCenterLineupPlayer[]
      substitutes?: MatchCenterLineupPlayer[]
    }
    return {
      teamName: row.teamName ?? 'Équipe',
      formation: row.formation ?? null,
      coachName: row.coachName ?? null,
      startXI: row.startXI ?? [],
      substitutes: row.substitutes ?? [],
    }
  })

  const stale =
    Boolean(input.lastSyncedAt) &&
    now - new Date(input.lastSyncedAt!).getTime() > 10 * 60_000 &&
    phase === 'live'

  return {
    homeTeam: input.homeTeam,
    awayTeam: input.awayTeam,
    kickoffAt: input.kickoffAt,
    venueName: input.venueName,
    roundLabel: input.roundLabel,
    statusNormalized: status,
    liveHomeScore: input.liveHomeScore,
    liveAwayScore: input.liveAwayScore,
    htHomeScore: input.htHomeScore,
    htAwayScore: input.htAwayScore,
    liveElapsed: input.liveElapsed,
    liveExtra: input.liveExtra,
    lastSyncedAt: input.lastSyncedAt,
    lineups,
    events: Array.isArray(input.eventsJson)
      ? (input.eventsJson as MatchCenterEvent[])
      : [],
    statistics: Array.isArray(input.statisticsJson)
      ? input.statisticsJson
      : [],
    stale,
    phase,
  }
}
