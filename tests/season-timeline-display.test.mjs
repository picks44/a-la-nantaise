import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { describe, it } from 'node:test'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  buildRoundAnnotations,
  formatTimelinePoints,
  formatTimelineRoundLine,
  isTimelineMilestone,
} from '../src/lib/seasonTimeline.ts'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')

function read(relativePath) {
  return readFileSync(join(root, relativePath), 'utf8')
}

describe('season timeline helpers (contract)', () => {
  it('formats 1 pt and N pts', () => {
    assert.equal(formatTimelinePoints(0), '0 pt')
    assert.equal(formatTimelinePoints(1), '1 pt')
    assert.equal(formatTimelinePoints(2), '2 pts')
  })

  it('formats round lines with ordinals', () => {
    assert.equal(
      formatTimelineRoundLine({
        roundNumber: 2,
        roundPoints: 3,
        rank: 1,
      }),
      'J2 · 3 pts · 1re place',
    )
    assert.equal(
      formatTimelineRoundLine({
        roundNumber: 4,
        roundPoints: 1,
        rank: 3,
      }),
      'J4 · 1 pt · 3e place',
    )
  })

  it('builds annotations in priority order without dropping trophies', () => {
    assert.deepEqual(
      buildRoundAnnotations({
        isBestRound: true,
        isBestRank: true,
        trophyNames: ['Serial Winner', 'Sniper'],
      }),
      ['Meilleure journée', 'Meilleure position', 'Serial Winner', 'Sniper'],
    )
  })

  it('detects milestones', () => {
    assert.equal(
      isTimelineMilestone({
        isBestRound: false,
        isBestRank: false,
        trophyCount: 0,
      }),
      false,
    )
    assert.equal(
      isTimelineMilestone({
        isBestRound: true,
        isBestRank: false,
        trophyCount: 0,
      }),
      true,
    )
  })
})

describe('SeasonTimelinePanel wiring', () => {
  const panel = read('src/components/SeasonTimelinePanel.tsx')
  const page = read('src/pages/RankingPage.tsx')

  it('keeps a compact narrative timeline without gap or badge stacks', () => {
    assert.match(panel, /aria-label="Parcours de saison"/)
    assert.match(panel, /season-timeline/)
    assert.doesNotMatch(panel, /formatGapToPreviousHuman/)
    assert.match(page, /SeasonTimelinePanel/)
  })

  it('shows the empty-state editorial copy', () => {
    assert.match(
      page,
      /Ton parcours commencera après la première journée terminée/,
    )
  })

  it('keeps milestone markers for notable rounds', () => {
    assert.match(panel, /season-timeline-marker/)
    assert.match(panel, /season-timeline-item--milestone/)
  })

  it('keeps the three summary metrics', () => {
    assert.match(panel, /Journées terminées/)
    assert.match(panel, /Meilleure journée/)
    assert.match(panel, /Meilleure position/)
  })

  it('renders an em dash when bestRound or bestRank is null', () => {
    assert.match(panel, /timeline\.bestRound[\s\S]*\?[\s\S]*: '—'/)
    assert.match(panel, /timeline\.bestRank[\s\S]*\?[\s\S]*: '—'/)
  })

  it('lives outside RankingPage helper exports', () => {
    assert.doesNotMatch(page, /export function formatTimelinePoints/)
    assert.match(panel, /from '..\/lib\/seasonTimeline'/)
  })
})

describe('Ranking tabs mobile overflow', () => {
  const page = read('src/pages/RankingPage.tsx')
  const css = read('src/index.css')

  it('scrolls tabs internally on mobile via ranking-tablist', () => {
    assert.match(page, /ranking-tablist/)
    assert.match(css, /\.ranking-tablist/)
  })
})
