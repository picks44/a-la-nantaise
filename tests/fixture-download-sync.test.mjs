import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { describe, it } from 'node:test'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  FixtureValidationError,
  buildExternalId,
  parseFixtureDateUtc,
  validateFixtureFeed,
} from '../supabase/functions/_shared/fixtureDownload.ts'
import {
  planFixtureSync,
} from '../supabase/functions/_shared/planFixtureSync.ts'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const fixturePath = join(root, 'tests/fixtures/ligue-2-2026-fc-nantes.json')
const migrationPath = join(
  root,
  'supabase/migrations/20260803140000_fixture_download_sync.sql',
)
const edgePath = join(
  root,
  'supabase/functions/sync-fc-nantes/index.ts',
)
const schedulePath = join(
  root,
  'supabase/schedule_fixture_sync.example.sql',
)

const rawFixtures = JSON.parse(readFileSync(fixturePath, 'utf8'))

function cloneFixtures() {
  return structuredClone(rawFixtures)
}

describe('fixture download validation', () => {
  it('parses the 34 FC Nantes fixtures', () => {
    const fixtures = validateFixtureFeed(cloneFixtures())
    assert.equal(fixtures.length, 34)
    assert.equal(fixtures[0]?.roundNumber, 1)
    assert.equal(fixtures[0]?.homeTeam, 'FC Nantes')
    assert.equal(
      fixtures[0]?.externalId,
      'fixturedownload:ligue-2-2026:6',
    )
  })

  it('rejects an incomplete array', () => {
    const incomplete = cloneFixtures().slice(0, 33)
    assert.throws(
      () => validateFixtureFeed(incomplete),
      (error) =>
        error instanceof FixtureValidationError &&
        error.code === 'INVALID_FEED_COUNT',
    )
  })

  it('rejects a duplicated round', () => {
    const duplicated = cloneFixtures()
    duplicated[1].RoundNumber = 1
    assert.throws(
      () => validateFixtureFeed(duplicated),
      (error) =>
        error instanceof FixtureValidationError &&
        error.code === 'DUPLICATE_ROUND',
    )
  })

  it('rejects a match without FC Nantes', () => {
    const broken = cloneFixtures()
    broken[0].HomeTeam = 'AJ Auxerre'
    broken[0].AwayTeam = 'Red Star FC'
    assert.throws(
      () => validateFixtureFeed(broken),
      (error) =>
        error instanceof FixtureValidationError &&
        error.code === 'INVALID_NANTES_FIXTURE',
    )
  })

  it('rejects a single score present', () => {
    const broken = cloneFixtures()
    broken[0].HomeTeamScore = 1
    broken[0].AwayTeamScore = null
    assert.throws(
      () => validateFixtureFeed(broken),
      (error) =>
        error instanceof FixtureValidationError &&
        error.code === 'INCOMPLETE_RESULT',
    )
  })

  it('converts DateUtc correctly', () => {
    assert.equal(
      parseFixtureDateUtc('2026-08-08 18:45:00Z'),
      '2026-08-08T18:45:00.000Z',
    )
    assert.equal(buildExternalId(6), 'fixturedownload:ligue-2-2026:6')
  })
})

describe('fixture sync planning', () => {
  const fixtures = validateFixtureFeed(cloneFixtures())

  it('creates then synchronizes idempotently', () => {
    const first = planFixtureSync([], fixtures, '2026-08-03T10:00:00.000Z')
    assert.equal(first.summary.created, 34)
    assert.equal(first.summary.conflicts, 0)

    const existing = first.creates.map((item, index) => ({
      id: `created-${index}`,
      externalId: item.external_id,
      source: 'fixturedownload',
      roundNumber: item.round_number,
      homeTeam: item.home_team,
      awayTeam: item.away_team,
      kickoffAt: item.kickoff_at,
      status: item.status,
      homeScore: item.home_score,
      awayScore: item.away_score,
      manualOverride: false,
    }))

    const second = planFixtureSync(
      existing,
      fixtures,
      '2026-08-03T11:00:00.000Z',
    )
    assert.equal(second.summary.created, 0)
    assert.equal(second.summary.updated, 0)
    assert.equal(second.summary.unchanged, 34)
    assert.equal(second.conflicts.length, 0)
  })

  it('matches an existing manual fixture by round and teams', () => {
    const target = fixtures[0]
    assert.ok(target)
    const existing = [
      {
        id: 'manual-1',
        externalId: null,
        source: 'manual',
        roundNumber: target.roundNumber,
        homeTeam: target.homeTeam,
        awayTeam: target.awayTeam,
        kickoffAt: '2026-08-08T17:00:00.000Z',
        status: 'scheduled',
        homeScore: null,
        awayScore: null,
        manualOverride: false,
      },
    ]

    const plan = planFixtureSync(existing, [target])
    assert.equal(plan.summary.created, 0)
    assert.equal(plan.updates.length, 1)
    assert.equal(plan.updates[0]?.id, 'manual-1')
    assert.equal(plan.updates[0]?.external_id, target.externalId)
    assert.equal(plan.updates[0]?.unchanged, false)
  })

  it('returns an ambiguous conflict', () => {
    const target = fixtures[0]
    assert.ok(target)
    const existing = [
      {
        id: 'a',
        externalId: null,
        source: 'manual',
        roundNumber: target.roundNumber,
        homeTeam: target.homeTeam,
        awayTeam: target.awayTeam,
        kickoffAt: target.kickoffAt,
        status: 'scheduled',
        homeScore: null,
        awayScore: null,
        manualOverride: false,
      },
      {
        id: 'b',
        externalId: null,
        source: 'manual',
        roundNumber: target.roundNumber,
        homeTeam: target.homeTeam,
        awayTeam: target.awayTeam,
        kickoffAt: target.kickoffAt,
        status: 'scheduled',
        homeScore: null,
        awayScore: null,
        manualOverride: false,
      },
    ]

    const plan = planFixtureSync(existing, [target])
    assert.equal(plan.conflicts.length, 1)
    assert.equal(plan.conflicts[0]?.reason, 'AMBIGUOUS_MATCH')
    assert.deepEqual(plan.conflicts[0]?.candidateIds, ['a', 'b'])
  })

  it('flags a new finished result for recalculation', () => {
    const base = fixtures[0]
    assert.ok(base)
    const finished = {
      ...base,
      homeScore: 2,
      awayScore: 1,
      status: 'finished',
    }

    const existing = [
      {
        id: 'm1',
        externalId: base.externalId,
        source: 'fixturedownload',
        roundNumber: base.roundNumber,
        homeTeam: base.homeTeam,
        awayTeam: base.awayTeam,
        kickoffAt: base.kickoffAt,
        status: 'scheduled',
        homeScore: null,
        awayScore: null,
        manualOverride: false,
      },
    ]

    const plan = planFixtureSync(existing, [finished])
    assert.equal(plan.summary.newResults, 1)
    assert.equal(plan.updates[0]?.recalculate, true)
    assert.equal(plan.updates[0]?.status, 'finished')
    assert.equal(plan.updates[0]?.home_score, 2)
  })

  it('never demotes a finished match to scheduled', () => {
    const base = fixtures[0]
    assert.ok(base)
    const existing = [
      {
        id: 'm1',
        externalId: base.externalId,
        source: 'fixturedownload',
        roundNumber: base.roundNumber,
        homeTeam: base.homeTeam,
        awayTeam: base.awayTeam,
        kickoffAt: base.kickoffAt,
        status: 'finished',
        homeScore: 1,
        awayScore: 0,
        manualOverride: false,
      },
    ]

    const plan = planFixtureSync(existing, [base])
    assert.equal(plan.updates[0]?.status, 'finished')
    assert.equal(plan.updates[0]?.home_score, 1)
    assert.equal(plan.updates[0]?.away_score, 0)
    assert.equal(plan.updates[0]?.recalculate, false)
  })

  it('protects a manual override from result overwrite', () => {
    const base = fixtures[0]
    assert.ok(base)
    const finished = {
      ...base,
      homeScore: 3,
      awayScore: 0,
      status: 'finished',
    }
    const existing = [
      {
        id: 'm1',
        externalId: base.externalId,
        source: 'fixturedownload',
        roundNumber: base.roundNumber,
        homeTeam: base.homeTeam,
        awayTeam: base.awayTeam,
        kickoffAt: base.kickoffAt,
        status: 'finished',
        homeScore: 1,
        awayScore: 1,
        manualOverride: true,
      },
    ]

    const plan = planFixtureSync(existing, [finished])
    assert.equal(plan.summary.protected, 1)
    assert.equal(plan.updates[0]?.protected, true)
    assert.equal(plan.updates[0]?.home_score, 1)
    assert.equal(plan.updates[0]?.away_score, 1)
    assert.equal(plan.updates[0]?.drift_result, true)
    assert.equal(plan.updates[0]?.recalculate, false)
  })
})

describe('fixture sync migration and edge function', () => {
  const sql = readFileSync(migrationPath, 'utf8')
  const edge = readFileSync(edgePath, 'utf8')

  it('adds sync columns without deleting data', () => {
    assert.match(sql, /manual_override/)
    assert.match(sql, /last_synced_at/)
    assert.match(sql, /matches_source_external_id_unique/)
    assert.match(sql, /admin_commit_fixture_sync/)
    assert.match(sql, /admin_clear_match_override/)
    assert.doesNotMatch(sql, /DROP TABLE/i)
    assert.doesNotMatch(sql, /TRUNCATE/i)
    assert.doesNotMatch(sql, /DELETE FROM public\.(players|matches|predictions)/i)
  })

  it('verifies admin code before fetching the feed', () => {
    const verifyIndex = edge.indexOf("rpc(\n      'verify_admin_code'")
    const fetchCallIndex = edge.indexOf('await fetchFixtureFeed()')
    assert.ok(verifyIndex > 0)
    assert.ok(fetchCallIndex > verifyIndex)
    assert.match(edge, /admin_commit_fixture_sync/)
    assert.doesNotMatch(edge, /service_role/i)
  })

  it('documents refusal of a bad admin code in the edge function', () => {
    assert.match(edge, /INVALID_ADMIN_CODE/)
    assert.match(edge, /Code administrateur incorrect/)
  })
})

describe('daily fixture sync schedule', () => {
  const schedule = readFileSync(schedulePath, 'utf8')

  it('runs daily and invokes the existing Edge Function', () => {
    assert.match(schedule, /'15 5 \* \* \*'/)
    assert.match(schedule, /\/functions\/v1\/sync-fc-nantes/)
    assert.match(schedule, /net\.http_post/)
    assert.match(schedule, /a-la-nantaise-daily-fixture-sync/)
  })

  it('reads credentials from Vault without hard-coding them', () => {
    assert.match(schedule, /vault\.decrypted_secrets/)
    assert.match(schedule, /function_anon_key/)
    assert.match(schedule, /fixture_sync_admin_code/)
    assert.match(schedule, /jsonb_build_object\(\s*'admin_code'/)
    assert.doesNotMatch(schedule, /service_role/i)
    assert.doesNotMatch(schedule, /https:\/\/[a-z0-9-]+\.supabase\.co/i)
  })

  it('replaces an existing job with the same name', () => {
    assert.match(schedule, /cron\.unschedule\(existing_job_id\)/)
    assert.match(schedule, /cron\.schedule\(/)
  })
})
