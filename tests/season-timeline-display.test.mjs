import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { describe, it } from 'node:test'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { formatRankOrdinal } from '../src/lib/rankingDisplay.ts'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')

function read(relativePath) {
  return readFileSync(join(root, relativePath), 'utf8')
}

/**
 * Miroirs des helpers exportés par RankingPage (contrats vérifiés via source).
 * Évite d’importer le module .tsx React dans Node strip-types.
 */
function formatTimelinePoints(points) {
  if (points <= 1) return `${points} pt`
  return `${points} pts`
}

function formatTimelineRoundLine(input) {
  const rankLabel =
    input.rank == null ? '—' : `${formatRankOrdinal(input.rank)} place`
  return `J${input.roundNumber} · ${formatTimelinePoints(input.roundPoints)} · ${rankLabel}`
}

function isTimelineMilestone(input) {
  return input.isBestRound || input.isBestRank || input.trophyCount > 0
}

function buildRoundAnnotations(input) {
  const annotations = []
  if (input.isBestRound) annotations.push('Meilleure journée')
  if (input.isBestRank) annotations.push('Meilleure position')
  for (const name of input.trophyNames) annotations.push(name)
  return annotations
}

describe('season timeline helpers (contract)', () => {
  const page = read('src/pages/RankingPage.tsx')

  it('exports the expected helper signatures in RankingPage', () => {
    assert.match(page, /export function formatTimelinePoints\(points: number\)/)
    assert.match(page, /export function formatTimelineRoundLine/)
    assert.match(page, /export function isTimelineMilestone/)
    assert.match(page, /export function buildRoundAnnotations/)
    assert.match(page, /formatRankOrdinal/)
    assert.match(page, /if \(points <= 1\) return `\$\{points\} pt`/)
  })

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
        trophyNames: ['Champion de la journée', 'Premier score exact'],
      }),
      [
        'Meilleure journée',
        'Meilleure position',
        'Champion de la journée',
        'Premier score exact',
      ],
    )
    assert.deepEqual(
      buildRoundAnnotations({
        isBestRound: false,
        isBestRank: false,
        trophyNames: [],
      }),
      [],
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
    assert.equal(
      isTimelineMilestone({
        isBestRound: false,
        isBestRank: false,
        trophyCount: 2,
      }),
      true,
    )
  })
})

describe('SeasonTimelinePanel wiring', () => {
  const page = read('src/pages/RankingPage.tsx')
  const css = read('src/index.css')

  it('keeps a compact narrative timeline without gap or badge stacks', () => {
    const panelStart = page.indexOf('function SeasonTimelinePanel')
    const panelEnd = page.indexOf('function ParticipationList')
    assert.ok(panelStart >= 0 && panelEnd > panelStart)
    const panel = page.slice(panelStart, panelEnd)

    assert.match(panel, /formatTimelineRoundLine/)
    assert.match(panel, /buildRoundAnnotations/)
    assert.match(panel, /isTimelineMilestone/)
    assert.match(panel, /season-timeline/)
    assert.match(panel, /aria-hidden="true"/)
    assert.match(panel, /Autres moments de la saison/)
    assert.doesNotMatch(panel, /formatGapToPreviousHuman/)
    assert.doesNotMatch(panel, /gapToPrevious/)
    assert.doesNotMatch(panel, /badge-text/)
    assert.doesNotMatch(panel, /Journée \{round\.roundNumber\}/)
  })

  it('shows the empty-state editorial copy', () => {
    assert.match(
      page,
      /Ton parcours commencera après la première journée terminée\./,
    )
  })

  it('styles a decorative axis without heavy separators', () => {
    assert.match(css, /\.season-timeline::before/)
    assert.match(css, /\.season-timeline-item--milestone/)
    assert.doesNotMatch(
      css,
      /\.season-timeline-item \+ \.season-timeline-item \{[\s\S]*border-t/,
    )
  })

  it('compacts the summary on mobile without changing its three metrics', () => {
    const panelStart = page.indexOf('function SeasonTimelinePanel')
    const panelEnd = page.indexOf('function ParticipationList')
    const panel = page.slice(panelStart, panelEnd)
    assert.match(panel, /Journées terminées/)
    assert.match(panel, /Meilleure journée/)
    assert.match(panel, /Meilleure position/)
    assert.match(panel, /min-\[360px\]:grid-cols-2/)
    assert.match(panel, /sm:grid-cols-3/)
    assert.doesNotMatch(panel, /whitespace-nowrap/)
  })
})

describe('Ranking tabs mobile overflow', () => {
  const page = read('src/pages/RankingPage.tsx')
  const css = read('src/index.css')
  const appShell = read('src/components/AppShell.tsx')

  it('scrolls tabs internally on mobile and restores equal flex on sm+', () => {
    assert.match(page, /ranking-tablist/)
    assert.match(page, /ranking-tab /)
    assert.match(page, /shrink-0/)
    assert.match(page, /sm:flex-1/)
    assert.match(page, /sm:min-w-0/)
    assert.match(page, /tab-parcours/)
    assert.match(page, /Parcours/)
    assert.match(page, /scrollIntoView/)
    assert.match(css, /\.ranking-tablist/)
    assert.match(css, /overflow-x-auto/)
    assert.match(css, /scrollbar-width:\s*none/)
    assert.doesNotMatch(page, /min-w-\[\d/)
    assert.doesNotMatch(css, /overflow-x:\s*hidden/)
  })

  it('keeps the shell from expanding past the viewport', () => {
    assert.match(appShell, /min-w-0 max-w-5xl/)
    assert.doesNotMatch(appShell, /100vw/)
  })
})
