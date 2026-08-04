import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { describe, it } from 'node:test'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { formatKickoff, formatKickoffDisplay } from '../src/lib/format.ts'
import { findNextOpenMatch } from '../src/lib/matchOrder.ts'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')

function read(relativePath) {
  return readFileSync(join(root, relativePath), 'utf8')
}

describe('formatKickoffDisplay', () => {
  it('shows date and time once the kickoff is confirmed', () => {
    const iso = '2026-08-08T18:45:00.000Z'
    assert.equal(formatKickoffDisplay(iso, true), formatKickoff(iso))
  })

  it('hides the time and flags the placeholder while unconfirmed', () => {
    const iso = '2026-08-08T00:00:00.000Z'
    const displayed = formatKickoffDisplay(iso, false)
    assert.match(displayed, /Horaire à confirmer$/)
    assert.notEqual(displayed, formatKickoff(iso))
  })
})

// api.ts is not runtime-imported here: its extensionless internal imports
// (./errors, ./supabase, ./matchOrder) only resolve through Vite's bundler,
// not through `node --experimental-strip-types`. Regression coverage for
// mapMatch / withPredictionStatus therefore uses targeted source assertions,
// matching the pattern already used for adminApi.ts and the edge function.
describe('mapMatch / withPredictionStatus derive kickoff_unconfirmed (source check)', () => {
  const api = read('src/lib/api.ts')

  it('reads kickoff_time_confirmed from the row and defaults it to true', () => {
    assert.match(api, /kickoff_time_confirmed\?:\s*boolean \| null/)
    assert.match(api, /kickoffTimeConfirmed:\s*row\.kickoff_time_confirmed \?\? true/)
  })

  it('derives kickoff_unconfirmed before checking the kickoff-reached lock, after terminal states', () => {
    const fn = api.match(
      /function deriveUiStatusFromMatch\([\s\S]*?\n\}/,
    )?.[0]
    assert.ok(fn, 'deriveUiStatusFromMatch not found')
    const postponedIdx = fn.indexOf("'postponed'")
    const finishedIdx = fn.indexOf("dbStatus === 'finished'")
    const unconfirmedIdx = fn.indexOf('kickoff_unconfirmed')
    const kickoffReachedIdx = fn.indexOf('kickoffReached')
    assert.ok(postponedIdx > 0 && finishedIdx > postponedIdx)
    assert.ok(unconfirmedIdx > finishedIdx)
    assert.ok(kickoffReachedIdx > unconfirmedIdx)
  })

  it('withPredictionStatus reuses the same derivation, so a draft cannot mask an unconfirmed kickoff', () => {
    assert.match(
      api,
      /export function withPredictionStatus\([\s\S]{0,200}deriveUiStatusFromMatch/,
    )
  })
})

describe('findNextOpenMatch skips unconfirmed kickoffs', () => {
  it('never selects a match whose kickoff time is unconfirmed', () => {
    const now = new Date('2026-08-01T00:00:00.000Z')
    const matches = [
      {
        id: 'unconfirmed',
        matchday: 1,
        kickoffAt: '2026-08-02T00:00:00.000Z',
        kickoffTimeConfirmed: false,
        homeTeam: 'FC Nantes',
        awayTeam: 'X',
        venue: 'home',
        dbStatus: 'scheduled',
        status: 'kickoff_unconfirmed',
      },
      {
        id: 'confirmed',
        matchday: 2,
        kickoffAt: '2026-08-05T00:00:00.000Z',
        kickoffTimeConfirmed: true,
        homeTeam: 'FC Nantes',
        awayTeam: 'Y',
        venue: 'home',
        dbStatus: 'scheduled',
        status: 'to_predict',
      },
    ]
    assert.equal(findNextOpenMatch(matches, now)?.id, 'confirmed')
  })

  it('returns null when every upcoming match still has an unconfirmed kickoff', () => {
    const now = new Date('2026-08-01T00:00:00.000Z')
    const matches = [
      {
        id: 'only-unconfirmed',
        matchday: 1,
        kickoffAt: '2026-08-02T00:00:00.000Z',
        kickoffTimeConfirmed: false,
        homeTeam: 'FC Nantes',
        awayTeam: 'X',
        venue: 'home',
        dbStatus: 'scheduled',
        status: 'kickoff_unconfirmed',
      },
    ]
    assert.equal(findNextOpenMatch(matches, now), null)
  })
})

describe('kickoff confirmed migration and SQL regression', () => {
  const migration = read(
    'supabase/migrations/20260804100000_kickoff_confirmed_and_must_change_pin.sql',
  )
  const adminMigration = read(
    'supabase/migrations/20260804130000_admin_kickoff_confirmed.sql',
  )
  const provenanceMigration = read(
    'supabase/migrations/20260804140000_kickoff_confirmation_provenance.sql',
  )
  const sqlTests = read('supabase/tests/kickoff_confirmed.sql')

  it('adds kickoff_time_confirmed and enforces it server-side before kickoff lock', () => {
    assert.match(migration, /kickoff_time_confirmed BOOLEAN NOT NULL DEFAULT TRUE/)
    assert.match(migration, /CREATE OR REPLACE FUNCTION public\.is_paris_midnight_kickoff/)
    assert.match(migration, /MATCH_KICKOFF_UNCONFIRMED/)
    assert.match(
      migration,
      /IF match_row\.kickoff_time_confirmed IS NOT TRUE THEN[\s\S]{0,120}MATCH_KICKOFF_UNCONFIRMED/,
    )
    assert.doesNotMatch(migration, /DROP TABLE/i)
    assert.doesNotMatch(migration, /TRUNCATE/i)
    assert.doesNotMatch(migration, /DELETE FROM public\.(players|matches|predictions)/i)
  })

  it('excludes unconfirmed kickoffs from participation and push reminder eligibility', () => {
    assert.match(migration, /get_round_participation[\s\S]{0,1200}kickoff_time_confirmed IS TRUE/)
    assert.match(migration, /push_reminder_eligibility/)
    assert.match(migration, /m\.kickoff_time_confirmed IS TRUE/)
  })

  it('admin RPCs accept and expose kickoff_time_confirmed without accidental DEFAULT true', () => {
    assert.match(adminMigration, /kickoff_time_confirmed BOOLEAN/)
    assert.match(
      provenanceMigration,
      /p_kickoff_time_confirmed BOOLEAN DEFAULT NULL/,
    )
    assert.match(provenanceMigration, /kickoff_confirmation_source/)
    assert.match(provenanceMigration, /resolve_kickoff_confirmation/)
  })

  it('SQL regression covers DST, manual confirm, sync, and participation exclusion', () => {
    assert.match(sqlTests, /MATCH_KICKOFF_UNCONFIRMED/)
    assert.match(sqlTests, /MATCH_LOCKED/)
    assert.match(sqlTests, /is_paris_midnight_kickoff/)
    assert.match(sqlTests, /minuit Paris été/)
    assert.match(sqlTests, /minuit Paris hiver/)
    assert.match(sqlTests, /confirmation manuelle/)
    assert.match(sqlTests, /expected_count devrait exclure le non confirmé/)
    assert.match(sqlTests, /ROLLBACK/)
  })
})

describe('kickoff confirmation frontend wiring', () => {
  it('exposes a dedicated UI status with a matching label and style', () => {
    const types = read('src/types/index.ts')
    const status = read('src/lib/status.ts')
    assert.match(types, /'kickoff_unconfirmed'/)
    assert.match(types, /kickoffTimeConfirmed: boolean/)
    assert.match(status, /kickoff_unconfirmed: 'Horaire à confirmer'/)
  })

  it('admin match form exposes a kickoff confirmation toggle', () => {
    const adminPage = read('src/pages/AdminPage.tsx')
    assert.match(adminPage, /kickoffTimeConfirmed/)
    assert.match(adminPage, /Horaire confirmé/)
    assert.match(adminPage, /formatKickoffDisplay/)
  })

  it('home and match list surface the unconfirmed state without a misleading countdown', () => {
    const home = read('src/pages/HomePage.tsx')
    const item = read('src/components/MatchListItem.tsx')
    assert.match(home, /isUnconfirmed/)
    assert.match(home, /Bientôt disponible/)
    assert.match(item, /kickoff_unconfirmed/)
    assert.match(item, /Horaire à confirmer/)
  })
})
