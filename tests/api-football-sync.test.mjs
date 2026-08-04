import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { describe, it } from 'node:test'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  ApiFootballError,
  apiFootballGet,
  fixtureToShadowPayload,
  normalizeCompetitionsForTeam,
  normalizeFixtureItem,
  normalizeTeamSearchResults,
} from '../supabase/functions/_shared/apiFootballClient.ts'
import {
  normalizeApiFootballStatus,
  providerStatusLabelFr,
} from '../supabase/functions/_shared/apiFootballStatus.ts'
import {
  decideSyncTick,
  planFixtureMatchLink,
} from '../supabase/functions/_shared/apiFootballSyncPlan.ts'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const sample = JSON.parse(
  readFileSync(join(root, 'tests/fixtures/api-football-sample.json'), 'utf8'),
)

describe('apiFootball status mapping', () => {
  it('maps known short codes to French labels', () => {
    assert.equal(normalizeApiFootballStatus('1H'), 'first_half')
    assert.equal(providerStatusLabelFr('first_half'), 'Première période')
    assert.equal(normalizeApiFootballStatus('ZZ'), 'unknown')
  })
})

describe('apiFootball normalization', () => {
  it('normalizes team search without hardcoding a league', () => {
    const teams = normalizeTeamSearchResults(sample.teams)
    assert.equal(teams[0]?.externalId, 83)
    assert.equal(teams[0]?.name, 'Nantes')
  })

  it('discovers multiple competitions for a team', () => {
    const competitions = normalizeCompetitionsForTeam(sample.leagues)
    assert.equal(competitions.length, 2)
    assert.ok(competitions.some((c) => c.name === 'Ligue 2'))
    assert.ok(competitions.some((c) => c.name === 'Coupe de France'))
    assert.equal(
      competitions.find((c) => c.name === 'Ligue 2')?.coverage.events,
      true,
    )
  })

  it('normalizes live fixture with events and lineups', () => {
    const fixture = normalizeFixtureItem(sample.fixtures[1])
    assert.equal(fixture.external_fixture_id, '1200002')
    assert.equal(fixture.provider_status_normalized, 'second_half')
    assert.equal(fixture.live_home_score, 1)
    assert.equal(fixture.live_away_score, 2)
    assert.equal(fixture.events.length, 3)
    assert.equal(fixture.lineups.length, 2)
    assert.equal(fixture.events[0]?.event_type, 'goal')
  })

  it('proposes final score only when terminal', () => {
    const finished = normalizeFixtureItem(sample.fixtures[2])
    assert.equal(finished.provider_status_normalized, 'finished')
    assert.equal(finished.proposed_home_score, 2)
    assert.equal(finished.proposed_away_score, 0)

    const scheduled = normalizeFixtureItem(sample.fixtures[0])
    assert.equal(scheduled.proposed_home_score, null)
  })

  it('builds shadow payload that never implies public apply', () => {
    const fixture = normalizeFixtureItem(sample.fixtures[0])
    const payload = fixtureToShadowPayload(fixture, { match_id: null })
    assert.equal(payload.external_fixture_id, '1200001')
    assert.equal(payload.match_id, null)
  })
})

describe('apiFootball client with mocked fetch', () => {
  it('does not call a real network endpoint', async () => {
    let calledUrl = ''
    const result = await apiFootballGet({
      apiKey: 'test-key',
      path: '/fixtures',
      query: { id: 1 },
      fetchImpl: async (url) => {
        calledUrl = url
        return {
          ok: true,
          status: 200,
          headers: { get: () => null },
          arrayBuffer: async () =>
            new TextEncoder().encode(
              JSON.stringify({ response: sample.fixtures }),
            ),
        }
      },
    })
    assert.match(calledUrl, /v3\.football\.api-sports\.io\/fixtures/)
    assert.ok(Array.isArray(result.data))
  })

  it('maps 429 to PROVIDER_RATE_LIMITED', async () => {
    await assert.rejects(
      () =>
        apiFootballGet({
          apiKey: 'test-key',
          path: '/status',
          fetchImpl: async () => ({
            ok: false,
            status: 429,
            headers: { get: () => '0' },
            arrayBuffer: async () =>
              new TextEncoder().encode(JSON.stringify({ errors: 'rate' })),
          }),
        }),
      (error) =>
        error instanceof ApiFootballError &&
        error.code === 'PROVIDER_RATE_LIMITED',
    )
  })

  it('rejects missing API key without fetching', async () => {
    let fetched = false
    await assert.rejects(
      () =>
        apiFootballGet({
          apiKey: '',
          path: '/status',
          fetchImpl: async () => {
            fetched = true
            return {
              ok: true,
              status: 200,
              headers: { get: () => null },
              arrayBuffer: async () => new TextEncoder().encode('{}'),
            }
          },
        }),
      (error) =>
        error instanceof ApiFootballError &&
        error.code === 'PROVIDER_KEY_MISSING',
    )
    assert.equal(fetched, false)
  })
})

describe('apiFootball sync planning', () => {
  it('links by unambiguous teams and date window', () => {
    const fixture = normalizeFixtureItem(sample.fixtures[0])
    const plan = planFixtureMatchLink(
      fixture,
      [
        {
          id: 'm1',
          season_id: 's1',
          external_id: null,
          source: 'manual',
          round_number: 1,
          home_team: 'Nantes',
          away_team: 'Valenciennes',
          kickoff_at: '2026-08-15T18:00:00.000Z',
          status: 'scheduled',
          manual_override: false,
          home_score: null,
          away_score: null,
        },
      ],
      [],
    )
    assert.equal(plan.matchId, 'm1')
    assert.equal(plan.conflict, null)
  })

  it('creates conflict when multiple candidates match', () => {
    const fixture = normalizeFixtureItem(sample.fixtures[0])
    const plan = planFixtureMatchLink(
      fixture,
      [
        {
          id: 'm1',
          season_id: 's1',
          external_id: null,
          source: 'manual',
          round_number: 1,
          home_team: 'Nantes',
          away_team: 'Valenciennes',
          kickoff_at: '2026-08-15T18:00:00.000Z',
          status: 'scheduled',
          manual_override: false,
          home_score: null,
          away_score: null,
        },
        {
          id: 'm2',
          season_id: 's1',
          external_id: null,
          source: 'manual',
          round_number: 1,
          home_team: 'Nantes',
          away_team: 'Valenciennes',
          kickoff_at: '2026-08-15T19:00:00.000Z',
          status: 'scheduled',
          manual_override: false,
          home_score: null,
          away_score: null,
        },
      ],
      [],
    )
    assert.equal(plan.matchId, null)
    assert.equal(plan.conflict?.reason, 'AMBIGUOUS_MATCH')
  })

  it('skips external calls when quota is exhausted', () => {
    const decision = decideSyncTick({
      remainingUsable: 0,
      lastCoverageCheckAt: null,
      providerFixtures: [],
      calendarSyncedToday: false,
    })
    assert.equal(decision.shouldCallExternal, false)
    assert.equal(decision.reason, 'quota_exhausted')
  })

  it('requests live refresh every 2 minutes', () => {
    const now = new Date('2026-08-10T15:30:00.000Z')
    const decision = decideSyncTick({
      now,
      remainingUsable: 40,
      lastCoverageCheckAt: now.toISOString(),
      calendarSyncedToday: true,
      providerFixtures: [
        {
          id: 'pf1',
          external_fixture_id: '1200002',
          match_id: 'm1',
          kickoff_at: '2026-08-10T15:00:00.000Z',
          provider_status_normalized: 'second_half',
          last_synced_at: '2026-08-10T15:27:00.000Z',
          external_league_id: 62,
          external_season_year: 2025,
        },
      ],
    })
    assert.equal(decision.phase, 'live')
    assert.equal(decision.shouldCallExternal, true)
  })
})

describe('shadow / cutover guards in source', () => {
  it('keeps public_provider_enabled false in migration check', () => {
    const sql = readFileSync(
      join(
        root,
        'supabase/migrations/20260804190000_api_football_provider.sql',
      ),
      'utf8',
    )
    assert.match(sql, /public_provider_enabled BOOLEAN NOT NULL DEFAULT FALSE/)
    assert.match(sql, /CHECK \(public_provider_enabled = FALSE\)/)
    assert.match(sql, /Activation publique indisponible en mode shadow/)
    assert.doesNotMatch(
      sql,
      /p_public_provider_enabled/,
    )
  })

  it('edge function never applies matches in shadow responses', () => {
    const edge = readFileSync(
      join(root, 'supabase/functions/sync-api-football/index.ts'),
      'utf8',
    )
    assert.match(edge, /applied_to_matches: false/)
    assert.match(edge, /shadow: true/)
    assert.match(edge, /API_FOOTBALL_KEY/)
    assert.doesNotMatch(edge, /VITE_.*API_FOOTBALL/)
  })

  it('keeps legacy sync-fc-nantes connector', () => {
    const legacy = readFileSync(
      join(root, 'supabase/functions/sync-fc-nantes/index.ts'),
      'utf8',
    )
    assert.match(legacy, /sync-fc-nantes/)
  })
})
