import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { describe, it } from 'node:test'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  formatParticipationSummary,
  getCompetitionRanks,
  getDenseRanks,
  listRoundNumbers,
  selectDefaultRoundNumber,
  selectHomeRanking,
  summarizeParticipation,
} from '../src/lib/ranking.ts'
import {
  formatGapToLeader,
  formatSuccessRate,
  participationLabel,
} from '../src/lib/rankingDisplay.ts'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')

function read(relativePath) {
  return readFileSync(join(root, relativePath), 'utf8')
}

function player(partial) {
  return {
    id: partial.id,
    pseudo: partial.pseudo,
    points: partial.points ?? 0,
    exactScores: partial.exactScores ?? 0,
    isActive: partial.isActive ?? true,
    goodResults: partial.goodResults ?? 0,
    scoredPredictions: partial.scoredPredictions ?? 0,
    successRate: partial.successRate ?? null,
    gapToLeader: partial.gapToLeader ?? 0,
  }
}

describe('competition ranks', () => {
  it('keeps competition ranking 1,1,3 for ties on points and exacts', () => {
    const players = [
      player({ id: 'a', pseudo: 'Ada', points: 6, exactScores: 2 }),
      player({ id: 'b', pseudo: 'Béatrice', points: 6, exactScores: 2 }),
      player({ id: 'c', pseudo: 'Chloé', points: 3, exactScores: 1 }),
    ]
    assert.deepEqual(getCompetitionRanks(players), [1, 1, 3])
    assert.deepEqual(getDenseRanks(players), [1, 1, 3])
  })

  it('breaks rank only when exact scores differ', () => {
    const players = [
      player({ id: 'a', pseudo: 'Ada', points: 6, exactScores: 2 }),
      player({ id: 'b', pseudo: 'Béatrice', points: 6, exactScores: 1 }),
      player({ id: 'c', pseudo: 'Chloé', points: 3, exactScores: 0 }),
    ]
    assert.deepEqual(getCompetitionRanks(players), [1, 2, 3])
  })
})

describe('selectHomeRanking', () => {
  it('includes every ex aequo at rank 3 and not the rest', () => {
    const players = [
      player({
        id: '1',
        pseudo: 'A',
        points: 9,
        exactScores: 3,
        scoredPredictions: 3,
      }),
      player({
        id: '2',
        pseudo: 'B',
        points: 6,
        exactScores: 2,
        scoredPredictions: 2,
      }),
      player({
        id: '3',
        pseudo: 'C',
        points: 3,
        exactScores: 1,
        scoredPredictions: 1,
      }),
      player({
        id: '4',
        pseudo: 'D',
        points: 3,
        exactScores: 1,
        scoredPredictions: 1,
      }),
      player({
        id: '5',
        pseudo: 'E',
        points: 0,
        exactScores: 0,
        scoredPredictions: 0,
      }),
    ]
    const ranks = getCompetitionRanks(players)
    assert.deepEqual(ranks, [1, 2, 3, 3, 5])
    const home = selectHomeRanking(players, ranks, '1')
    assert.equal(home.awaitingFirstResult, false)
    assert.equal(home.participantCount, 5)
    assert.deepEqual(
      home.players.map((p) => p.id),
      ['1', '2', '3', '4'],
    )
    assert.deepEqual(home.ranks, [1, 2, 3, 3])
  })

  it('appends the connected player when outside top ranks', () => {
    const players = [
      player({ id: '1', pseudo: 'A', points: 9, scoredPredictions: 3 }),
      player({ id: '2', pseudo: 'B', points: 6, scoredPredictions: 2 }),
      player({ id: '3', pseudo: 'C', points: 3, scoredPredictions: 1 }),
      player({ id: '5', pseudo: 'E', points: 0, scoredPredictions: 0 }),
    ]
    const ranks = getCompetitionRanks(players)
    const home = selectHomeRanking(players, ranks, '5')
    assert.deepEqual(
      home.players.map((p) => p.id),
      ['1', '2', '3', '5'],
    )
    assert.deepEqual(home.ranks, [1, 2, 3, 4])
  })

  it('does not duplicate the connected player already in top 3', () => {
    const players = [
      player({ id: '1', pseudo: 'A', points: 9, scoredPredictions: 3 }),
      player({ id: '2', pseudo: 'B', points: 6, scoredPredictions: 2 }),
      player({ id: '3', pseudo: 'C', points: 3, scoredPredictions: 1 }),
    ]
    const ranks = getCompetitionRanks(players)
    const home = selectHomeRanking(players, ranks, '2')
    assert.equal(home.players.filter((p) => p.id === '2').length, 1)
    assert.deepEqual(
      home.players.map((p) => p.id),
      ['1', '2', '3'],
    )
  })

  it('hides the all-zero list before the first scored result', () => {
    const players = [
      player({ id: '1', pseudo: 'A' }),
      player({ id: '2', pseudo: 'B' }),
      player({ id: '3', pseudo: 'C' }),
    ]
    const ranks = getCompetitionRanks(players)
    const home = selectHomeRanking(players, ranks, '2')
    assert.equal(home.awaitingFirstResult, true)
    assert.equal(home.participantCount, 3)
    assert.deepEqual(home.players, [])
    assert.deepEqual(home.ranks, [])
  })
})

describe('participation summary', () => {
  it('counts complete and partial over applicable players only', () => {
    const rows = [
      { status: 'complete' },
      { status: 'partial' },
      { status: 'missing' },
      { status: 'not_applicable' },
      { status: 'not_applicable' },
    ]
    assert.deepEqual(summarizeParticipation(rows), {
      predictedCount: 2,
      applicableCount: 3,
    })
    assert.equal(
      formatParticipationSummary(2, 3),
      '2 joueurs sur 3 ont pronostiqué',
    )
    assert.equal(
      formatParticipationSummary(1, 5),
      '1 joueur sur 5 a pronostiqué',
    )
    assert.equal(
      formatParticipationSummary(0, 0),
      'Aucun joueur concerné sur cette journée.',
    )
  })
})

describe('ranking display helpers', () => {
  it('formats success rate and gap', () => {
    assert.equal(formatSuccessRate(null), '—')
    assert.equal(formatSuccessRate(100), '100 %')
    assert.equal(formatSuccessRate(66.7), '66.7 %')
    assert.equal(formatGapToLeader(0, true), 'Leader')
    assert.equal(formatGapToLeader(4, false), '−4')
  })

  it('exposes French participation labels', () => {
    assert.equal(participationLabel('complete'), 'Fait')
    assert.equal(participationLabel('partial'), 'Partiel')
    assert.equal(participationLabel('missing'), 'Non fait')
    assert.equal(participationLabel('not_applicable'), 'Non applicable')
  })
})

describe('default round selection', () => {
  it('prefers the next open matchday then the latest', () => {
    const now = new Date('2026-08-03T12:00:00Z')
    const matches = [
      {
        id: 'a',
        matchday: 2,
        kickoffAt: '2026-07-01T18:00:00Z',
        kickoffTimeConfirmed: true,
        homeTeam: 'FC Nantes',
        awayTeam: 'X',
        venue: 'home',
        dbStatus: 'finished',
        status: 'finished',
        finalScore: { home: 1, away: 0 },
      },
      {
        id: 'b',
        matchday: 4,
        kickoffAt: '2026-09-01T18:00:00Z',
        kickoffTimeConfirmed: true,
        homeTeam: 'FC Nantes',
        awayTeam: 'Y',
        venue: 'home',
        dbStatus: 'scheduled',
        status: 'to_predict',
      },
      {
        id: 'c',
        matchday: 3,
        kickoffAt: '2026-08-20T18:00:00Z',
        kickoffTimeConfirmed: true,
        homeTeam: 'Z',
        awayTeam: 'FC Nantes',
        venue: 'away',
        dbStatus: 'scheduled',
        status: 'to_predict',
      },
    ]
    assert.equal(selectDefaultRoundNumber(matches, now), 3)
    assert.deepEqual(listRoundNumbers(matches), [2, 3, 4])

    const finishedOnly = matches.map((match) => ({
      ...match,
      dbStatus: 'finished',
      status: 'finished',
      kickoffAt: '2026-07-01T18:00:00Z',
      finalScore: { home: 1, away: 0 },
    }))
    assert.equal(selectDefaultRoundNumber(finishedOnly, now), 4)
  })
})

describe('ranking migration and UI wiring', () => {
  const migration = read(
    'supabase/migrations/20260803181000_ranking_stats_and_participation.sql',
  )
  const sqlTests = read('supabase/tests/ranking_and_participation.sql')
  const rankingPage = read('src/pages/RankingPage.tsx')
  const home = read('src/pages/HomePage.tsx')
  const podium = read('src/components/Podium.tsx')

  it('enriches get_ranking and adds privacy-safe participation RPC', () => {
    assert.match(migration, /CREATE OR REPLACE FUNCTION public\.get_ranking/)
    assert.match(migration, /good_results/)
    assert.match(migration, /success_rate/)
    assert.match(migration, /gap_to_leader/)
    assert.match(migration, /is_active/)
    assert.match(
      migration,
      /CREATE OR REPLACE FUNCTION public\.get_round_participation/,
    )
    assert.match(migration, /not_applicable/)
    assert.match(migration, /assert_player_session/)
    assert.doesNotMatch(
      migration,
      /get_round_participation[\s\S]{0,800}predicted_home_score/,
    )
    assert.doesNotMatch(
      migration,
      /get_round_participation[\s\S]{0,800}predicted_away_score/,
    )
  })

  it('SQL tests cover ranking stats and participation cases', () => {
    assert.match(sqlTests, /score exact|exact_scores/)
    assert.match(sqlTests, /bon résultat|good_results/)
    assert.match(sqlTests, /inactif avec points/)
    assert.match(sqlTests, /complete/)
    assert.match(sqlTests, /partial/)
    assert.match(sqlTests, /missing/)
    assert.match(sqlTests, /not_applicable/)
    assert.match(sqlTests, /nouveau joueur/)
    assert.match(sqlTests, /colonnes de score/)
    assert.match(sqlTests, /ROLLBACK/)
  })

  it('home uses compact selection instead of the full list', () => {
    assert.match(home, /selectHomeRanking/)
    assert.match(home, /homeRanking\.players/)
    assert.match(home, /awaitingFirstResult/)
    assert.match(home, /participantCount/)
    assert.match(home, /variant="compact"/)
    assert.doesNotMatch(home, /players=\{ranking\}/)
  })

  it('ranking page exposes general and participation tabs via shared rows', () => {
    assert.match(rankingPage, /Général/)
    assert.match(rankingPage, /Participation/)
    assert.match(rankingPage, /fetchRoundParticipation/)
    assert.match(rankingPage, /variant="full"/)
    assert.match(rankingPage, /GroupRanking/)
    assert.match(rankingPage, /formatParticipationSummary/)
    assert.match(rankingPage, /summarizeParticipation/)
    assert.doesNotMatch(rankingPage, /players\.map\(\(player, index\) =>/)
    assert.match(podium, /variant === 'full'/)
    assert.match(podium, /RankingRow/)
    assert.match(podium, /Aucun résultat noté/)
    assert.match(podium, /awaitingFirstResult/)
    assert.match(podium, /premier match/)
  })

  it('loads participation in a single RPC per selected round', () => {
    assert.match(
      rankingPage,
      /fetchRoundParticipation\(\s*sessionToken!,\s*selectedRound!/,
    )
    assert.doesNotMatch(rankingPage, /for \(const .* of .*players/)
  })
})
