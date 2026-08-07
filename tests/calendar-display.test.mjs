import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { describe, it } from 'node:test'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  formatCalendarPersonalPrediction,
  formatCalendarPoints,
  formatDominantTendency,
  formatParticipantPointsLabel,
  formatParticipantPredictionScore,
  getCalendarPersonalPredictionView,
  selectClosedGroupSummary,
  selectParticipantBadge,
} from '../src/lib/calendarDisplay.ts'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')

function read(relativePath) {
  return readFileSync(join(root, relativePath), 'utf8')
}

describe('formatCalendarPoints', () => {
  it('formats 0, 1 and many points', () => {
    assert.equal(formatCalendarPoints(0), '0 pt')
    assert.equal(formatCalendarPoints(1), '1 pt')
    assert.equal(formatCalendarPoints(3), '3 pts')
  })
})

describe('formatCalendarPersonalPrediction', () => {
  it('handles scored predictions with Home verdict language', () => {
    assert.equal(
      formatCalendarPersonalPrediction({
        homeScore: 1,
        awayScore: 1,
        points: 3,
      }),
      'Ton prono : 1–1 · Pleine lucarne · +3 pts',
    )
    assert.equal(
      formatCalendarPersonalPrediction({
        homeScore: 2,
        awayScore: 0,
        points: 1,
      }),
      'Ton prono : 2–0 · Bon résultat · +1 pt',
    )
    assert.equal(
      formatCalendarPersonalPrediction({
        homeScore: 0,
        awayScore: 1,
        points: 0,
      }),
      'Ton prono : 0–1 · À côté du score · 0 pt',
    )
  })

  it('handles missing prediction', () => {
    assert.equal(formatCalendarPersonalPrediction(null), 'Non pronostiqué')
    assert.equal(formatCalendarPersonalPrediction(undefined), 'Non pronostiqué')
  })

  it('omits points when the prediction is not scored yet', () => {
    assert.equal(
      formatCalendarPersonalPrediction({
        homeScore: 1,
        awayScore: 0,
        points: null,
      }),
      'Ton prono : 1–0',
    )
    assert.equal(
      formatCalendarPersonalPrediction({
        homeScore: 1,
        awayScore: 0,
      }),
      'Ton prono : 1–0',
    )
  })
})

describe('getCalendarPersonalPredictionView', () => {
  it('splits score, verdict and points for finished cards', () => {
    assert.deepEqual(
      getCalendarPersonalPredictionView({
        homeScore: 0,
        awayScore: 2,
        points: 0,
      }),
      {
        kind: 'scored',
        scoreLine: 'Ton prono : 0–2',
        verdict: 'À côté du score',
        pointsLabel: '0 pt',
      },
    )
  })
})

describe('formatDominantTendency', () => {
  it('returns null without data or on a tie', () => {
    assert.equal(formatDominantTendency(null), null)
    assert.equal(formatDominantTendency(undefined), null)
    assert.equal(
      formatDominantTendency({ victory: 40, draw: 40, defeat: 20 }),
      null,
    )
    assert.equal(
      formatDominantTendency({ victory: 0, draw: 0, defeat: 0 }),
      null,
    )
  })

  it('formats a unique dominant outcome', () => {
    assert.equal(
      formatDominantTendency({ victory: 20, draw: 60, defeat: 20 }),
      '60 % ont pronostiqué un nul',
    )
    assert.equal(
      formatDominantTendency({ victory: 55, draw: 20, defeat: 25 }),
      '55 % ont pronostiqué une victoire',
    )
    assert.equal(
      formatDominantTendency({ victory: 10, draw: 20, defeat: 70 }),
      '70 % ont pronostiqué une défaite',
    )
  })
})

describe('selectClosedGroupSummary', () => {
  it('formats one and many participants', () => {
    assert.deepEqual(
      selectClosedGroupSummary({
        participantCount: 1,
        mostPlayedScores: [],
      }),
      ['1 participant'],
    )
    assert.deepEqual(
      selectClosedGroupSummary({
        participantCount: 5,
        mostPlayedScores: [],
      }),
      ['5 participants'],
    )
  })

  it('formats most-played scores with a two-score cap', () => {
    assert.deepEqual(
      selectClosedGroupSummary({
        participantCount: 3,
        mostPlayedScores: ['1–1'],
      }),
      ['3 participants', 'Score le plus joué : 1–1'],
    )
    assert.deepEqual(
      selectClosedGroupSummary({
        participantCount: 3,
        mostPlayedScores: ['1–1', '0–0'],
      }),
      ['3 participants', 'Scores les plus joués : 1–1, 0–0'],
    )
    assert.deepEqual(
      selectClosedGroupSummary({
        participantCount: 3,
        mostPlayedScores: ['1–1', '0–0', '2–1'],
      }),
      ['3 participants', 'Scores les plus joués : 1–1, 0–0, …'],
    )
  })

  it('caps at three items and omits empty tendency', () => {
    const summary = selectClosedGroupSummary({
      participantCount: 5,
      mostPlayedScores: ['1–1'],
      percentages: { victory: 20, draw: 60, defeat: 20 },
    })
    assert.equal(summary.length, 3)
    assert.equal(summary[2], '60 % ont pronostiqué un nul')

    assert.deepEqual(
      selectClosedGroupSummary({
        participantCount: 2,
        mostPlayedScores: ['1–0'],
        percentages: { victory: 50, draw: 50, defeat: 0 },
      }),
      ['2 participants', 'Score le plus joué : 1–0'],
    )
  })

  it('returns an empty list when nothing useful is available', () => {
    assert.deepEqual(
      selectClosedGroupSummary({
        participantCount: 0,
        mostPlayedScores: [],
      }),
      [],
    )
  })
})

describe('MatchListItem closed summary wiring (K1)', () => {
  const item = read('src/components/MatchListItem.tsx')
  const calendar = read('src/pages/CalendarPage.tsx')

  it('uses compact personal prediction and group summary helpers', () => {
    assert.match(item, /getCalendarPersonalPredictionView/)
    assert.match(item, /selectClosedGroupSummary/)
    assert.match(item, /FinishedPersonalPrediction/)
    assert.doesNotMatch(item, /pointsResultLabel/)
    assert.doesNotMatch(item, /Sans prono/)
    assert.doesNotMatch(item, /Pronos uniques/)
    assert.doesNotMatch(item, /StatChip/)
    assert.doesNotMatch(item, /grid-cols-2 gap-2 text-xs sm:grid-cols-4/)
    assert.doesNotMatch(item, /label="Victoire"/)
  })

  it('uses long toggle labels with ARIA', () => {
    assert.match(item, /Afficher les détails/)
    assert.match(item, /Masquer les détails/)
    assert.match(item, /aria-expanded=\{detailsOpen\}/)
    assert.match(item, /aria-controls=\{detailsId\}/)
    assert.match(item, /role="alert"/)
    assert.match(item, /Réessayer/)
    assert.match(item, /hidden=\{!detailsOpen\}/)
  })

  it('keeps error and retry outside the hidden details panel', () => {
    const revealStart = item.indexOf('function RevealSection')
    const detailsMarker = item.indexOf('id={detailsId}', revealStart)
    const errorMarker = item.indexOf('<RevealError', revealStart)
    assert.ok(revealStart >= 0 && detailsMarker > revealStart)
    assert.ok(errorMarker >= 0 && errorMarker < detailsMarker)
  })

  it('does not change default-open wiring', () => {
    assert.match(calendar, /findLastFinishedMatch/)
    assert.match(calendar, /detailsOpenById/)
    assert.match(calendar, /detailsOpen=\{isDetailsOpen\(match\.id\)\}/)
  })

  it('structures the calendar as next / upcoming / finished sections', () => {
    assert.match(calendar, /Prochain match/)
    assert.match(calendar, /À venir/)
    assert.match(calendar, /Terminés/)
    assert.match(calendar, /nextItems/)
    assert.match(calendar, /upcomingItems/)
    assert.match(calendar, /finishedItems/)
    assert.doesNotMatch(calendar, /<form/)
    assert.doesNotMatch(calendar, /type="number"/)
  })
})

describe('selectParticipantBadge', () => {
  it('prioritises Score exact over Meilleur prono', () => {
    assert.equal(
      selectParticipantBadge({ exactScore: true, bestPrediction: true }),
      'Score exact',
    )
    assert.equal(
      selectParticipantBadge({ exactScore: true, bestPrediction: false }),
      'Score exact',
    )
    assert.equal(
      selectParticipantBadge({ exactScore: false, bestPrediction: true }),
      'Meilleur prono',
    )
    assert.equal(
      selectParticipantBadge({ exactScore: false, bestPrediction: false }),
      null,
    )
  })
})

describe('formatParticipantPointsLabel', () => {
  it('formats scored points and skips unscored rows', () => {
    assert.equal(formatParticipantPointsLabel(0, true), '0 pt')
    assert.equal(formatParticipantPointsLabel(1, true), '+1 pt')
    assert.equal(formatParticipantPointsLabel(3, true), '+3 pts')
    assert.equal(formatParticipantPointsLabel(null, true), null)
    assert.equal(formatParticipantPointsLabel(3, false), null)
  })
})

describe('formatParticipantPredictionScore', () => {
  it('formats scores without treating 0–0 as missing', () => {
    assert.equal(
      formatParticipantPredictionScore({ homeScore: 0, awayScore: 0 }),
      '0–0',
    )
    assert.equal(
      formatParticipantPredictionScore({ homeScore: 1, awayScore: 2 }),
      '1–2',
    )
    assert.equal(
      formatParticipantPredictionScore({ homeScore: null, awayScore: 1 }),
      'Aucun pronostic',
    )
  })
})

describe('MatchListItem open details wiring (K2)', () => {
  const item = read('src/components/MatchListItem.tsx')
  const revealStart = item.indexOf('function RevealSection')
  const revealBody = item.slice(revealStart)
  const detailsStart = revealBody.indexOf('id={detailsId}')
  const detailsEnd = revealBody.lastIndexOf('</section>')
  const panel = revealBody.slice(detailsStart, detailsEnd)

  it('keeps predictions primary with trophies nested and ranking secondary', () => {
    assert.ok(detailsStart >= 0 && detailsEnd > detailsStart)
    assert.match(panel, /Pronostics du groupe/)
    assert.match(panel, /Trophées obtenus/)
    assert.match(panel, /Classement du match/)
    assert.match(panel, /Voir le classement du match/)
    assert.match(panel, /aria-labelledby=\{`group-predictions-\$\{match\.id\}`\}/)
    assert.match(panel, /aria-labelledby=\{`match-ranking-\$\{match\.id\}`\}/)
    assert.match(panel, /selectParticipantBadge/)
    assert.match(panel, /formatParticipantPointsLabel/)
    assert.match(panel, /formatCalendarPoints\(row\.points\)/)
    assert.match(panel, /\{row\.rank\}\./)
    assert.match(panel, /grid-cols-\[minmax\(0,1fr\)_auto_auto\]/)
    assert.doesNotMatch(panel, /participant\.outcome/)
    assert.doesNotMatch(panel, /Nouveaux trophees/)
    assert.doesNotMatch(panel, /border-green bg-success-soft/)
    assert.doesNotMatch(panel, /#\{row\.rank\}/)
    assert.doesNotMatch(panel, /match-reveal-trophies/)
  })

  it('keeps trophies under predictions and ranking after as a collapsed block', () => {
    const predictionsSection = panel.indexOf('group-predictions-')
    const trophiesHeading = panel.indexOf('Trophées obtenus')
    const rankingToggle = panel.indexOf('Voir le classement du match')
    const rankingSection = panel.indexOf('match-ranking-')
    assert.ok(predictionsSection >= 0)
    assert.ok(trophiesHeading > predictionsSection)
    assert.ok(rankingToggle > trophiesHeading)
    assert.ok(rankingSection > rankingToggle)
  })

  it('collapses match ranking behind a local rankingOpen toggle', () => {
    assert.match(revealBody, /const \[rankingOpen, setRankingOpen\] = useState\(false\)/)
    assert.match(panel, /aria-expanded=\{rankingOpen\}/)
    assert.match(panel, /aria-controls=\{rankingId\}/)
    assert.match(panel, /hidden=\{!rankingOpen\}/)
    assert.match(panel, /Masquer le classement du match/)
  })

  it('preserves K1 closed summary helpers', () => {
    assert.match(item, /getCalendarPersonalPredictionView/)
    assert.match(item, /selectClosedGroupSummary/)
    assert.match(item, /Afficher les détails/)
    assert.doesNotMatch(item, /Sans prono/)
    assert.doesNotMatch(item, /StatChip/)
  })
})

describe('MatchListItem visual hierarchy (K3)', () => {
  const item = read('src/components/MatchListItem.tsx')
  const css = read('src/index.css')

  it('puts finished open details on a light surface under the green summary', () => {
    assert.match(item, /match-reveal-details/)
    assert.match(item, /panelTitleClass = isFinishedShell \? 'text-ink'/)
    assert.match(item, /panelMutedClass = isFinishedShell \? 'text-muted'/)
    assert.match(css, /\.match-reveal-details/)
    assert.doesNotMatch(item, /match-reveal-trophies/)
    assert.doesNotMatch(css, /\.match-reveal-trophies/)
    assert.doesNotMatch(item, /border-yellow\/60 bg-yellow\/15/)
  })

  it('keeps the toggle in the green summary chrome', () => {
    const revealStart = item.indexOf('function RevealSection')
    const detailsId = item.indexOf('id={detailsId}', revealStart)
    const toggle = item.indexOf('Afficher les détails', revealStart)
    assert.ok(toggle >= 0 && detailsId > toggle)
  })
})

describe('MatchListItem group teaser visibility (future cards)', () => {
  const item = read('src/components/MatchListItem.tsx')
  const revealStart = item.indexOf('function RevealSection')
  const revealBody = item.slice(revealStart)
  const beforeRevealEnd = revealBody.indexOf('function RevealError')
  const beforeRevealBlock = revealBody.slice(0, beforeRevealEnd)

  it('keeps unconfirmed status copy without group teaser or reveal phrase', () => {
    assert.doesNotMatch(
      item,
      /Horaire à confirmer — les pronostics ouvriront bientôt\./,
    )
    assert.match(
      revealBody,
      /match\.status === 'to_predict' \|\| match\.status === 'kickoff_unconfirmed'[\s\S]*return null/,
    )
    const teaserBranch = beforeRevealBlock.slice(
      beforeRevealBlock.indexOf('if (isBeforeReveal)'),
    )
    assert.doesNotMatch(teaserBranch, /kickoff_unconfirmed/)
  })

  it('shows the group wait teaser only for predicted matches', () => {
    assert.match(
      beforeRevealBlock,
      /const isBeforeReveal = match\.status === 'predicted'/,
    )
    assert.match(beforeRevealBlock, /Les pronos du groupe/)
    assert.match(
      beforeRevealBlock,
      /Les pronostics des autres seront révélés automatiquement au coup/,
    )
    assert.doesNotMatch(
      beforeRevealBlock,
      /isBeforeReveal[\s\S]*kickoff_unconfirmed/,
    )
  })

  it('keeps finished K1–K3 group summary wiring outside the future teaser', () => {
    assert.match(item, /selectClosedGroupSummary/)
    assert.match(item, /Afficher les détails/)
    assert.match(item, /Pronostics du groupe/)
    assert.match(item, /Classement du match/)
    assert.match(item, /Trophées obtenus/)
    assert.match(item, /Voir le classement du match/)
    assert.ok(item.indexOf('Les pronos du groupe') !== item.lastIndexOf('Les pronos du groupe'))
  })
})
