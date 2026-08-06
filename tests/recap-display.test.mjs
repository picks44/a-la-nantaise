import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  formatGapToPreviousHuman,
  formatRankChangeHuman,
  formatRankOrdinal,
} from '../src/lib/rankingDisplay.ts'
import {
  formatGroupAverageLabel,
  formatRankDeltaLabel,
  formatRecapMessage,
  formatRecapRoundPoints,
  selectRecapIndicators,
} from '../src/lib/recapMessages.ts'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')

describe('formatRankChangeHuman', () => {
  it('keeps 1st place when delta is zero', () => {
    assert.equal(
      formatRankChangeHuman({
        rankBefore: 1,
        rankAfter: 1,
        rankDelta: 0,
        isNewToRanking: false,
        isLeader: true,
      }),
      'Tu conserves la 1re place',
    )
  })

  it('uses restes when stable outside first place', () => {
    assert.equal(
      formatRankChangeHuman({
        rankBefore: 5,
        rankAfter: 5,
        rankDelta: 0,
        isNewToRanking: false,
      }),
      'Tu restes 5e',
    )
  })

  it('describes a rise with et passes', () => {
    assert.equal(
      formatRankChangeHuman({
        rankBefore: 2,
        rankAfter: 1,
        rankDelta: 1,
        isNewToRanking: false,
        isLeader: true,
      }),
      'Tu gagnes 1 place et passes 1re',
    )
  })

  it('describes several places gained', () => {
    assert.equal(
      formatRankChangeHuman({
        rankBefore: 5,
        rankAfter: 3,
        rankDelta: 2,
        isNewToRanking: false,
      }),
      'Tu gagnes 2 places et passes 3e',
    )
  })

  it('describes a one-place drop', () => {
    assert.equal(
      formatRankChangeHuman({
        rankBefore: 1,
        rankAfter: 2,
        rankDelta: -1,
        isNewToRanking: false,
      }),
      'Tu recules d’une place et passes 2e',
    )
  })

  it('describes several places dropped', () => {
    assert.equal(
      formatRankChangeHuman({
        rankBefore: 2,
        rankAfter: 5,
        rankDelta: -3,
        isNewToRanking: false,
      }),
      'Tu recules de 3 places et passes 5e',
    )
  })

  it('marks a new player via isNewToRanking only', () => {
    assert.equal(
      formatRankChangeHuman({
        rankBefore: null,
        rankAfter: 6,
        rankDelta: null,
        isNewToRanking: true,
      }),
      'Tu entres au classement à la 6e place',
    )
  })

  it('does not invent entry when rankBefore is null without isNewToRanking', () => {
    assert.equal(
      formatRankChangeHuman({
        rankBefore: null,
        rankAfter: 4,
        rankDelta: null,
        isNewToRanking: false,
      }),
      'Tu es 4e',
    )
  })

  it('does not treat null delta as stability', () => {
    assert.equal(
      formatRankChangeHuman({
        rankBefore: 3,
        rankAfter: 3,
        rankDelta: null,
        isNewToRanking: false,
      }),
      'Tu es 3e',
    )
    assert.doesNotMatch(
      formatRankChangeHuman({
        rankBefore: 3,
        rankAfter: 3,
        rankDelta: null,
        isNewToRanking: false,
      }),
      /Stable|conserves|restes/,
    )
  })

  it('handles missing after rank', () => {
    assert.equal(
      formatRankChangeHuman({
        rankBefore: 2,
        rankAfter: null,
        rankDelta: null,
        isNewToRanking: false,
      }),
      'Classement indisponible',
    )
  })
})

describe('formatGapToPreviousHuman', () => {
  it('labels the leader', () => {
    assert.equal(
      formatGapToPreviousHuman(null, { isLeader: true }),
      'Leader du classement',
    )
  })

  it('handles zero gap', () => {
    assert.equal(
      formatGapToPreviousHuman(0),
      'À égalité de points avec le joueur précédent',
    )
  })

  it('handles positive gap', () => {
    assert.equal(formatGapToPreviousHuman(2), 'À 2 points du joueur précédent')
  })

  it('returns null when gap unknown and not leader', () => {
    assert.equal(formatGapToPreviousHuman(null), null)
  })
})

describe('formatRecapRoundPoints', () => {
  it('formats 0, 1 and many points', () => {
    assert.equal(formatRecapRoundPoints(0), '0 pt')
    assert.equal(formatRecapRoundPoints(1), '1 pt')
    assert.equal(formatRecapRoundPoints(3), '3 pts')
  })
})

describe('formatGroupAverageLabel', () => {
  it('formats french decimals and plural units', () => {
    assert.equal(formatGroupAverageLabel(1), 'Moyenne du groupe : 1 pt')
    assert.equal(formatGroupAverageLabel(1.5), 'Moyenne du groupe : 1,5 pts')
    assert.equal(formatGroupAverageLabel(2), 'Moyenne du groupe : 2 pts')
  })
})

describe('selectRecapIndicators', () => {
  it('orders by priority and caps at three', () => {
    assert.deepEqual(
      selectRecapIndicators({
        exactScoreCount: 2,
        missedPredictionCount: 1,
        participantAveragePoints: 1.6,
        correctOutcomeOnlyCount: 3,
      }),
      [
        '2 scores exacts',
        '1 match manqué',
        'Moyenne du groupe : 1,6 pts',
      ],
    )
  })

  it('hides zero metrics and returns empty when nothing useful', () => {
    assert.deepEqual(
      selectRecapIndicators({
        exactScoreCount: 0,
        missedPredictionCount: 0,
        participantAveragePoints: null,
        correctOutcomeOnlyCount: 0,
      }),
      [],
    )
  })

  it('formats singular labels', () => {
    assert.deepEqual(
      selectRecapIndicators({
        exactScoreCount: 1,
        missedPredictionCount: 0,
        participantAveragePoints: null,
        correctOutcomeOnlyCount: 1,
      }),
      ['1 score exact', '1 bon résultat'],
    )
  })
})

describe('formatRecapMessage', () => {
  it('uses ordinal helper for personal best', () => {
    assert.equal(
      formatRecapMessage('personal_best_rank', { rank: 1 }, true),
      'Tu atteins ton meilleur classement de la saison : 1re',
    )
  })

  it('does not invent ordinal from string paths', () => {
    assert.equal(formatRankOrdinal(1), '1re')
    assert.equal(formatRankOrdinal(3), '3e')
  })
})

describe('formatRankDeltaLabel', () => {
  it('spells out places', () => {
    assert.equal(formatRankDeltaLabel(2), '+2 places')
    assert.equal(formatRankDeltaLabel(-1), '−1 place')
    assert.equal(formatRankDeltaLabel(0), 'Stable')
    assert.equal(formatRankDeltaLabel(null), null)
  })
})

describe('RoundRecapCard editorial wiring', () => {
  it('keeps editorial hierarchy without gap or champions grid', () => {
    const card = readFileSync(
      join(root, 'src/components/RoundRecapCard.tsx'),
      'utf8',
    )
    assert.match(card, /formatRankChangeHuman/)
    assert.match(card, /selectRecapIndicators/)
    assert.match(card, /formatRecapRoundPoints/)
    assert.doesNotMatch(card, /formatGapToPreviousHuman/)
    assert.doesNotMatch(card, /Champions/)
    assert.doesNotMatch(card, /RANK_FOCUSED/)
    assert.doesNotMatch(card, /grid-cols-3/)
    assert.doesNotMatch(card, /Stable/)
    assert.match(card, /indicators\.length > 0/)
    assert.match(card, /text-5xl/)
    assert.match(card, /Journée \{recap\.roundNumber\}/)
  })
})
