export const FIXTURE_SOURCE = 'fixturedownload'
export const FIXTURE_COMPETITION = 'ligue-2-2026'
export const FIXTURE_FEED_URL =
  'https://fixturedownload.com/feed/json/ligue-2-2026/fc-nantes'
export const TRACKED_TEAM = 'FC Nantes'
export const EXPECTED_MATCH_COUNT = 34

export interface RawFixtureItem {
  MatchNumber?: unknown
  RoundNumber?: unknown
  DateUtc?: unknown
  Location?: unknown
  HomeTeam?: unknown
  AwayTeam?: unknown
  HomeTeamScore?: unknown
  AwayTeamScore?: unknown
  Winner?: unknown
}

export interface NormalizedFixture {
  externalId: string
  matchNumber: number
  roundNumber: number
  kickoffAt: string
  homeTeam: string
  awayTeam: string
  homeScore: number | null
  awayScore: number | null
  status: 'scheduled' | 'finished'
  location: string | null
}

export class FixtureValidationError extends Error {
  readonly code: string

  constructor(code: string, message: string) {
    super(message)
    this.name = 'FixtureValidationError'
    this.code = code
  }
}

export function buildExternalId(matchNumber: number): string {
  return `${FIXTURE_SOURCE}:${FIXTURE_COMPETITION}:${matchNumber}`
}

/** Convertit DateUtc Fixture Download → ISO UTC. */
export function parseFixtureDateUtc(raw: unknown): string {
  if (typeof raw !== 'string' || raw.trim() === '') {
    throw new FixtureValidationError(
      'INVALID_FIXTURE_DATE',
      'DateUtc manquante ou invalide.',
    )
  }

  const normalized = raw.trim().includes('T')
    ? raw.trim()
    : raw.trim().replace(' ', 'T')

  const date = new Date(normalized)
  if (Number.isNaN(date.getTime())) {
    throw new FixtureValidationError(
      'INVALID_FIXTURE_DATE',
      `DateUtc illisible : ${raw}`,
    )
  }

  return date.toISOString()
}

function isNantes(name: string): boolean {
  return name.trim().toLowerCase() === TRACKED_TEAM.toLowerCase()
}

function parseScore(value: unknown, label: string): number | null {
  if (value === null || value === undefined || value === '') return null
  if (typeof value !== 'number' || !Number.isInteger(value)) {
    throw new FixtureValidationError(
      'INVALID_FIXTURE_SCORE',
      `Score ${label} invalide.`,
    )
  }
  if (value < 0 || value > 15) {
    throw new FixtureValidationError(
      'INVALID_FIXTURE_SCORE',
      `Score ${label} hors limites (0-15).`,
    )
  }
  return value
}

export function normalizeFixtureItem(raw: RawFixtureItem): NormalizedFixture {
  if (typeof raw !== 'object' || raw === null) {
    throw new FixtureValidationError(
      'INVALID_FIXTURE_ITEM',
      'Élément de match invalide.',
    )
  }

  if (typeof raw.MatchNumber !== 'number' || !Number.isInteger(raw.MatchNumber)) {
    throw new FixtureValidationError(
      'INVALID_MATCH_NUMBER',
      'MatchNumber manquant ou invalide.',
    )
  }

  if (typeof raw.RoundNumber !== 'number' || !Number.isInteger(raw.RoundNumber)) {
    throw new FixtureValidationError(
      'INVALID_ROUND',
      'RoundNumber manquant ou invalide.',
    )
  }

  if (raw.RoundNumber < 1 || raw.RoundNumber > 34) {
    throw new FixtureValidationError(
      'INVALID_ROUND',
      `Journée hors plage : ${raw.RoundNumber}`,
    )
  }

  const homeTeam =
    typeof raw.HomeTeam === 'string' ? raw.HomeTeam.trim() : ''
  const awayTeam =
    typeof raw.AwayTeam === 'string' ? raw.AwayTeam.trim() : ''

  if (!homeTeam || !awayTeam) {
    throw new FixtureValidationError(
      'INVALID_TEAM_NAME',
      'Noms d’équipes manquants.',
    )
  }

  const nantesCount = (isNantes(homeTeam) ? 1 : 0) + (isNantes(awayTeam) ? 1 : 0)
  if (nantesCount !== 1) {
    throw new FixtureValidationError(
      'INVALID_NANTES_FIXTURE',
      `Le match ${raw.MatchNumber} ne contient pas exactement le FC Nantes.`,
    )
  }

  const homeScore = parseScore(raw.HomeTeamScore, 'domicile')
  const awayScore = parseScore(raw.AwayTeamScore, 'extérieur')

  if ((homeScore === null) !== (awayScore === null)) {
    throw new FixtureValidationError(
      'INCOMPLETE_RESULT',
      `Scores incomplets pour le match ${raw.MatchNumber}.`,
    )
  }

  const status = homeScore === null ? 'scheduled' : 'finished'
  const location =
    typeof raw.Location === 'string' && raw.Location.trim()
      ? raw.Location.trim()
      : null

  return {
    externalId: buildExternalId(raw.MatchNumber),
    matchNumber: raw.MatchNumber,
    roundNumber: raw.RoundNumber,
    kickoffAt: parseFixtureDateUtc(raw.DateUtc),
    homeTeam,
    awayTeam,
    homeScore,
    awayScore,
    status,
    location,
  }
}

export function validateFixtureFeed(payload: unknown): NormalizedFixture[] {
  if (!Array.isArray(payload)) {
    throw new FixtureValidationError(
      'INVALID_FEED_SHAPE',
      'Le flux doit être un tableau JSON.',
    )
  }

  if (payload.length !== EXPECTED_MATCH_COUNT) {
    throw new FixtureValidationError(
      'INVALID_FEED_COUNT',
      `Le flux doit contenir exactement ${EXPECTED_MATCH_COUNT} matchs (reçu : ${payload.length}).`,
    )
  }

  const normalized = payload.map((item) =>
    normalizeFixtureItem(item as RawFixtureItem),
  )

  const rounds = normalized.map((item) => item.roundNumber)
  const uniqueRounds = new Set(rounds)
  if (uniqueRounds.size !== EXPECTED_MATCH_COUNT) {
    throw new FixtureValidationError(
      'DUPLICATE_ROUND',
      'Une ou plusieurs journées sont dupliquées.',
    )
  }

  for (let round = 1; round <= EXPECTED_MATCH_COUNT; round += 1) {
    if (!uniqueRounds.has(round)) {
      throw new FixtureValidationError(
        'MISSING_ROUND',
        `Journée manquante : ${round}`,
      )
    }
  }

  const externalIds = new Set(normalized.map((item) => item.externalId))
  if (externalIds.size !== EXPECTED_MATCH_COUNT) {
    throw new FixtureValidationError(
      'DUPLICATE_EXTERNAL_ID',
      'Identifiants externes dupliqués dans le flux.',
    )
  }

  return normalized
}

export function fixturesToRpcPayload(fixtures: NormalizedFixture[]) {
  return fixtures.map((fixture) => ({
    external_id: fixture.externalId,
    round_number: fixture.roundNumber,
    kickoff_at: fixture.kickoffAt,
    home_team: fixture.homeTeam,
    away_team: fixture.awayTeam,
    home_score: fixture.homeScore,
    away_score: fixture.awayScore,
    status: fixture.status,
    location: fixture.location,
  }))
}
