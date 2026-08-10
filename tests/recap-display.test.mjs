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
  formatRecapMatchDetail,
  formatRecapMatchHeadline,
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

  it('C1: new rank-1 tie uses ex æquo wording', () => {
    assert.equal(
      formatRankChangeHuman({
        rankBefore: null,
        rankAfter: 1,
        rankDelta: null,
        isNewToRanking: true,
        isTied: true,
        isLeader: false,
      }),
      'Tu entres 1er ex æquo',
    )
  })

  it('C2: unique first place keeps classic wording', () => {
    assert.equal(
      formatRankChangeHuman({
        rankBefore: null,
        rankAfter: 1,
        rankDelta: null,
        isNewToRanking: true,
        isTied: false,
        isLeader: true,
      }),
      'Tu entres au classement à la 1re place',
    )
  })

  it('C3: tied first place is not a sole leader conserve', () => {
    assert.equal(
      formatRankChangeHuman({
        rankBefore: 1,
        rankAfter: 1,
        rankDelta: 0,
        isNewToRanking: false,
        isTied: true,
        isLeader: false,
      }),
      'Tu restes 1er ex æquo',
    )
  })

  it('does not treat rankAfter === 1 alone as unique leader', () => {
    assert.equal(
      formatRankChangeHuman({
        rankBefore: 1,
        rankAfter: 1,
        rankDelta: 0,
        isNewToRanking: false,
        isTied: true,
        isLeader: true,
      }),
      'Tu restes 1er ex æquo',
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
  it('orders by priority, skips group average, and caps at two', () => {
    assert.deepEqual(
      selectRecapIndicators({
        exactScoreCount: 2,
        missedPredictionCount: 1,
        participantAveragePoints: 1.6,
        correctOutcomeOnlyCount: 3,
      }),
      ['2 exacts', '1 match manqué'],
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

  it('formats singular performance labels without average', () => {
    assert.deepEqual(
      selectRecapIndicators({
        exactScoreCount: 1,
        missedPredictionCount: 0,
        participantAveragePoints: null,
        correctOutcomeOnlyCount: 1,
      }),
      ['1 exact', '1 bon résultat'],
    )
  })
})

describe('formatRecapMatch lines', () => {
  it('builds Home-like headline and detail', () => {
    assert.equal(
      formatRecapMatchHeadline({
        label: 'Guingamp – FC Nantes',
        status: 'finished',
        finalScore: { home: 2, away: 0 },
      }),
      'Guingamp 2-0 FC Nantes',
    )
    assert.equal(
      formatRecapMatchDetail({
        predicted: true,
        prediction: { home: 0, away: 2 },
        points: 0,
      }),
      'Prono 0-2 · À côté du score · 0 pt',
    )
    assert.equal(
      formatRecapMatchDetail({
        predicted: false,
        prediction: null,
        points: null,
      }),
      'Non pronostiqué',
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

  it('uses scoreless_day copy for a definitive zero-point day', () => {
    assert.equal(
      formatRecapMessage('scoreless_day', { roundPoints: 0 }, true),
      'Ton prono n’a pas rapporté de point sur cette journée.',
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
  it('keeps player-feedback hierarchy: message then points then rank impact', () => {
    const card = readFileSync(
      join(root, 'src/components/RoundRecapCard.tsx'),
      'utf8',
    )
    assert.match(card, /formatRankChangeHuman/)
    assert.match(card, /isTied/)
    assert.match(card, /rankAfter === 1 && !isTied/)
    assert.match(card, /selectRecapIndicators/)
    assert.match(card, /formatRecapRoundPoints/)
    assert.match(card, /formatRecapMatchHeadline/)
    assert.match(card, /formatRecapMatchDetail/)
    assert.match(card, /Nouveau trophée débloqué/)
    assert.doesNotMatch(card, /formatGapToPreviousHuman/)
    assert.doesNotMatch(card, /formatGroupAverageLabel/)
    assert.doesNotMatch(card, /participantAveragePoints/)
    assert.doesNotMatch(card, /Champions/)
    assert.doesNotMatch(card, /RANK_FOCUSED/)
    assert.doesNotMatch(card, /grid-cols-3/)
    assert.doesNotMatch(card, /pointsResultLabel/)
    assert.doesNotMatch(card, /text-5xl|text-6xl/)
    assert.match(card, /text-3xl font-black tabular-nums[\s\S]*sm:text-4xl/)
    assert.match(
      card,
      /\{message\}[\s\S]*roundPoints[\s\S]*\{rankSentence\}/,
    )
    assert.match(card, /text-base font-bold text-ink sm:text-lg/)
    assert.match(card, /indicators\.length > 0/)
    assert.match(card, /Journée \{recap\.roundNumber\}/)
  })
})
