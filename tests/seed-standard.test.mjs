import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { describe, it } from 'node:test'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const seedPath = join(root, 'supabase/seed.sql')
const invariantsPath = join(root, 'supabase/maintenance/verify_seed_invariants.sql')

const seed = readFileSync(seedPath, 'utf8')
const invariants = readFileSync(invariantsPath, 'utf8')

const seedPlayerIds = [
  '11111111-1111-1111-1111-111111111101',
  '11111111-1111-1111-1111-111111111102',
  '11111111-1111-1111-1111-111111111103',
  '11111111-1111-1111-1111-111111111104',
  '11111111-1111-1111-1111-111111111105',
  '11111111-1111-1111-1111-111111111106',
  '11111111-1111-1111-1111-111111111107',
  '11111111-1111-1111-1111-111111111108',
]

describe('standard seed (dev)', () => {
  it('does not insert matches, predictions, or fixture-scenario recalculation', () => {
    assert.doesNotMatch(seed, /INSERT\s+INTO\s+public\.matches\b/i)
    assert.doesNotMatch(seed, /'seed-j/)
    assert.doesNotMatch(seed, /22222222-2222-2222-2222-22222222220/)
    assert.doesNotMatch(seed, /INSERT\s+INTO\s+public\.predictions\b/i)
    assert.doesNotMatch(seed, /recalculate_season_achievements/)
  })

  it('keeps local access settings and eight stable players', () => {
    assert.match(seed, /access_code_hash/)
    assert.match(seed, /admin_code_hash/)
    for (const id of seedPlayerIds) {
      assert.match(seed, new RegExp(id))
    }
  })
})

describe('standard seed invariants checker', () => {
  it('requires an empty calendar and no predictions after standard seed', () => {
    assert.match(invariants, /expected 0 matches after standard seed/)
    assert.match(invariants, /expected 0 predictions after standard seed/)
    assert.match(invariants, /expected 0 manual matches after standard seed/)
    assert.match(invariants, /external_id LIKE 'seed-j%'/)
    assert.doesNotMatch(invariants, /22222222-2222-2222-2222-22222222220/)
    assert.doesNotMatch(invariants, /33333333-3333-3333-3333-333333333/)
  })

  it('still verifies the eight seed players and access hashes', () => {
    assert.match(invariants, /expected 8 active seed players/)
    assert.match(invariants, /access_code_hash/)
    assert.match(invariants, /admin_code_hash/)
    for (const id of seedPlayerIds) {
      assert.match(invariants, new RegExp(id))
    }
  })
})
