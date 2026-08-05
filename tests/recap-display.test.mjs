import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
  formatGapToPreviousHuman,
  formatRankChangeHuman,
  formatRankOrdinal,
} from '../src/lib/rankingDisplay.ts'
import {
  formatRankDeltaLabel,
  formatRecapMessage,
} from '../src/lib/recapMessages.ts'

describe('formatRankChangeHuman', () => {
  it('keeps 1st place stable without arrow notation', () => {
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

  it('describes a rise 2 → 1', () => {
    assert.equal(
      formatRankChangeHuman({
        rankBefore: 2,
        rankAfter: 1,
        rankDelta: 1,
        isNewToRanking: false,
        isLeader: true,
      }),
      'Tu gagnes 1 place · 1re',
    )
  })

  it('describes a drop 1 → 2', () => {
    assert.equal(
      formatRankChangeHuman({
        rankBefore: 1,
        rankAfter: 2,
        rankDelta: -1,
        isNewToRanking: false,
      }),
      'Tu recules de 1 place · 2e',
    )
  })

  it('marks a new player', () => {
    assert.equal(
      formatRankChangeHuman({
        rankBefore: null,
        rankAfter: 7,
        rankDelta: null,
        isNewToRanking: true,
      }),
      'Nouveau au classement · 7e place',
    )
  })

  it('handles missing before rank', () => {
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
