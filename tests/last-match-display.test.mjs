import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { describe, it } from 'node:test'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  formatLastMatchVerdict,
  getLastMatchPerformance,
} from '../src/lib/lastMatchDisplay.ts'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')

function read(relativePath) {
  return readFileSync(join(root, relativePath), 'utf8')
}

describe('last match performance display', () => {
  it('strips points from verdict and keeps formatPoints as sole gain source', () => {
    assert.equal(formatLastMatchVerdict(3), 'Pleine lucarne')
    assert.equal(formatLastMatchVerdict(1), 'Bon résultat')
    assert.equal(formatLastMatchVerdict(0), 'À côté du score')

    assert.deepEqual(
      getLastMatchPerformance({
        id: 'p1',
        matchId: 'm1',
        playerId: 'u1',
        homeScore: 2,
        awayScore: 0,
        points: 3,
      }),
      {
        kind: 'scored',
        homeScore: 2,
        awayScore: 0,
        resultLabel: 'Pleine lucarne',
        pointsLabel: '+3 pts',
        tone: 'exact',
      },
    )

    assert.deepEqual(
      getLastMatchPerformance({
        id: 'p2',
        matchId: 'm1',
        playerId: 'u1',
        homeScore: 1,
        awayScore: 0,
        points: 1,
      }),
      {
        kind: 'scored',
        homeScore: 1,
        awayScore: 0,
        resultLabel: 'Bon résultat',
        pointsLabel: '+1 pt',
        tone: 'good',
      },
    )

    assert.deepEqual(
      getLastMatchPerformance({
        id: 'p3',
        matchId: 'm1',
        playerId: 'u1',
        homeScore: 0,
        awayScore: 2,
        points: 0,
      }),
      {
        kind: 'scored',
        homeScore: 0,
        awayScore: 2,
        resultLabel: 'À côté du score',
        pointsLabel: '0 pt',
        tone: 'miss',
      },
    )

    assert.deepEqual(getLastMatchPerformance(undefined), { kind: 'missing' })

    assert.deepEqual(
      getLastMatchPerformance({
        id: 'p4',
        matchId: 'm1',
        playerId: 'u1',
        homeScore: 1,
        awayScore: 0,
      }),
      { kind: 'pending', homeScore: 1, awayScore: 0 },
    )
  })

  it('keeps Score final / Ton prono hierarchy without nested card or label redundancy', () => {
    const home = read('src/pages/HomePage.tsx')
    assert.match(home, /getLastMatchPerformance/)
    assert.match(home, /Score final/)
    assert.match(home, /Ton prono/)
    assert.match(home, /Non pronostiqué/)
    assert.match(home, /Résultat en attente/)
    assert.match(home, /lastMatchRewardClass/)
    assert.match(home, /mt-5 text-center/)
    assert.match(home, /gap-0\.5/)
    assert.doesNotMatch(home, /bg-ink\/40/)
    assert.doesNotMatch(home, /pointsResultLabel/)
  })

  it('tones reward contrast: exact yellow, good white, miss readable neutrals', () => {
    const home = read('src/pages/HomePage.tsx')
    const rewardFn = home.match(
      /function lastMatchRewardClass[\s\S]*?\n\}\n\nfunction LastMatchBlock/,
    )?.[0]
    assert.ok(rewardFn, 'lastMatchRewardClass missing')
    assert.match(
      rewardFn,
      /tone === 'exact'[\s\S]*badge border-yellow\/40 text-yellow[\s\S]*points: 'text-yellow'/,
    )
    assert.match(
      rewardFn,
      /tone === 'good'[\s\S]*verdict: 'text-white'[\s\S]*points: 'text-white'/,
    )
    assert.match(
      rewardFn,
      /verdict: 'text-white\/80'[\s\S]*points: 'text-white\/85'/,
    )
    assert.doesNotMatch(rewardFn, /text-danger|text-warning|ui-success-pop/)
  })
})
