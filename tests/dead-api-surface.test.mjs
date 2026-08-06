import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, it } from 'node:test'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const api = readFileSync(join(root, 'src/lib/api.ts'), 'utf8')
const revealState = readFileSync(
  join(root, 'src/lib/matchGroupRevealState.ts'),
  'utf8',
)

/**
 * Dead frontend surface removed in A3 (SQL RPCs intentionally untouched):
 * - fetchVisiblePredictions
 * - fetchRanking
 * - recalculateMatchPoints
 * - fetchRoundStatus
 * - fetchRoundPlayerStats
 * - ranking helper re-exports from api.ts
 * - canBeginReveal (unused; loader guards inline)
 */
describe('dead frontend API surface removed (A3)', () => {
  it('no longer exports unused player RPC wrappers', () => {
    assert.doesNotMatch(api, /export async function fetchVisiblePredictions/)
    assert.doesNotMatch(api, /export async function fetchRanking/)
    assert.doesNotMatch(api, /export async function recalculateMatchPoints/)
    assert.doesNotMatch(api, /export async function fetchRoundStatus/)
    assert.doesNotMatch(api, /export async function fetchRoundPlayerStats/)
    assert.doesNotMatch(api, /get_visible_predictions/)
    assert.doesNotMatch(api, /get_ranking['"]/)
    assert.doesNotMatch(api, /recalculate_match_points/)
    assert.doesNotMatch(api, /get_round_status/)
    assert.doesNotMatch(api, /get_round_player_stats/)
  })

  it('no longer re-exports ranking helpers from api.ts', () => {
    assert.doesNotMatch(api, /export \{\s*getCompetitionRanks/)
    assert.doesNotMatch(api, /getDenseRanks/)
    assert.doesNotMatch(api, /selectHomeRanking/)
  })

  it('removes unused canBeginReveal helper', () => {
    assert.doesNotMatch(revealState, /canBeginReveal/)
  })

  it('keeps live ranking and reveal paths', () => {
    assert.match(api, /export async function fetchLiveSeasonRanking/)
    assert.match(api, /get_live_season_ranking/)
    assert.match(api, /get_match_group_reveal/)
  })
})
