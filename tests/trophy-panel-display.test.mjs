import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  formatLockedTrophyProgress,
  formatTrophyAwardMeta,
  hasLockedTrophyProgress,
} from '../src/lib/trophyDisplay.ts'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const rankingPage = readFileSync(join(root, 'src/pages/RankingPage.tsx'), 'utf8')
const trophyPanelFile = readFileSync(
  join(root, 'src/components/TrophyPanel.tsx'),
  'utf8',
)

function trophyPanelSource() {
  const start = trophyPanelFile.indexOf('export function TrophyPanel')
  const end = trophyPanelFile.indexOf('function HeroStat')
  assert.ok(start >= 0 && end > start, 'TrophyPanel block not found')
  return trophyPanelFile.slice(start, end)
}

function earnedCardSource() {
  const start = trophyPanelFile.indexOf('function EarnedTrophyCard')
  const end = trophyPanelFile.indexOf('function LockedTrophyCard')
  assert.ok(start >= 0 && end > start, 'EarnedTrophyCard block not found')
  return trophyPanelFile.slice(start, end)
}

function lockedCardSource() {
  const start = trophyPanelFile.indexOf('function LockedTrophyCard')
  const end = trophyPanelFile.indexOf('const TROPHY_ICONS')
  assert.ok(start >= 0 && end > start, 'LockedTrophyCard block not found')
  return trophyPanelFile.slice(start, end)
}

describe('trophy panel structure (T1)', () => {
  it('keeps panel labelled by the trophies tab', () => {
    assert.match(rankingPage, /aria-labelledby="tab-trophies"/)
    assert.match(rankingPage, /id="tab-trophies"/)
    assert.match(rankingPage, /from '\.\.\/components\/TrophyPanel'/)
  })

  it('does not render a redundant Trophées & séries heading under the tab', () => {
    const panel = trophyPanelSource()
    assert.doesNotMatch(panel, /<h2[^>]*>\s*Trophées & séries\s*<\/h2>/)
  })

  it('keeps useful section headings without a season badge', () => {
    const panel = trophyPanelSource()
    assert.doesNotMatch(panel, /\{season\.name\}/)
    assert.doesNotMatch(trophyPanelFile, /season: Season/)
    assert.match(panel, />Débloqués</)
    assert.match(panel, />Encore à débloquer</)
    assert.doesNotMatch(panel, />Objectifs</)
  })

  it('keeps a compact cold-start empty state with incentive copy', () => {
    const panel = trophyPanelSource()
    assert.match(panel, /La chasse commence ici/)
    assert.match(panel, /Première\s+participation/)
    assert.match(panel, /lancer tes séries/)
    assert.match(panel, /isColdStart/)
  })

  it('renders the three summary metrics without a global sur N progress', () => {
    const panel = trophyPanelSource()
    assert.match(panel, /label="Série actuelle"/)
    assert.match(panel, /label="Record"/)
    assert.match(panel, /label="Trophées obtenus"/)
    assert.match(panel, /currentPredictionStreak/)
    assert.match(panel, /bestPredictionStreak/)
    assert.match(panel, /trophiesCount/)
    assert.doesNotMatch(panel, /sur \d+/)
    assert.doesNotMatch(trophyPanelFile, /trophée(?:s)? sur/)
  })

  it('wires celebration anti-replay and significant confetti only', () => {
    assert.match(trophyPanelFile, /SIGNIFICANT_CONFETTI_TROPHY_KEYS/)
    assert.match(trophyPanelFile, /first_participation/)
    assert.match(trophyPanelFile, /first_exact_score/)
    assert.match(trophyPanelFile, /celebrationStorageKey/)
    assert.match(trophyPanelFile, /ConfettiBurst/)
    assert.match(trophyPanelFile, /prefersReducedMotion|prefers-reduced-motion/)
  })
})

describe('formatTrophyAwardMeta', () => {
  it('formats date, round, and match context', () => {
    const meta = formatTrophyAwardMeta({
      awardedAt: '2026-08-08T12:00:00.000Z',
      sourceRoundNumber: 1,
      sourceMatchLabel: 'NAN-GFC',
    })
    assert.match(meta, /2026/)
    assert.match(meta, /J1/)
    assert.match(meta, /NAN-GFC/)
  })

  it('omits missing round and match', () => {
    const meta = formatTrophyAwardMeta({
      awardedAt: '2026-08-08T12:00:00.000Z',
      sourceRoundNumber: null,
      sourceMatchLabel: null,
    })
    assert.match(meta, /2026/)
    assert.doesNotMatch(meta, / · /)
  })

  it('omits invalid dates', () => {
    const meta = formatTrophyAwardMeta({
      awardedAt: 'not-a-date',
      sourceRoundNumber: 2,
      sourceMatchLabel: null,
    })
    assert.equal(meta, 'J2')
  })
})

describe('earned trophy cards (T2)', () => {
  it('uses formatTrophyAwardMeta without a redundant unlocked badge', () => {
    const earned = earnedCardSource()
    assert.match(earned, /formatTrophyAwardMeta/)
    assert.doesNotMatch(earned, /Journée \$\{/)
    assert.doesNotMatch(earned, />Débloqué</)
    assert.doesNotMatch(earned, /badge.*Débloqué/)
  })
})

describe('locked trophy progress helpers', () => {
  it('detects numeric progress only when target is positive', () => {
    assert.equal(
      hasLockedTrophyProgress({ progressCurrent: 0, progressTarget: 3 }),
      true,
    )
    assert.equal(
      hasLockedTrophyProgress({ progressCurrent: 2, progressTarget: 3 }),
      true,
    )
    assert.equal(
      hasLockedTrophyProgress({ progressCurrent: 3, progressTarget: 3 }),
      true,
    )
    assert.equal(
      hasLockedTrophyProgress({ progressCurrent: null, progressTarget: null }),
      false,
    )
    assert.equal(
      hasLockedTrophyProgress({ progressCurrent: 0, progressTarget: 0 }),
      false,
    )
  })

  it('formats compact progress values', () => {
    assert.equal(formatLockedTrophyProgress(0, 3), '0 / 3')
    assert.equal(formatLockedTrophyProgress(2, 5), '2 / 5')
  })
})

describe('locked trophy cards (T3)', () => {
  it('shows compact progress without redundant labels', () => {
    const locked = lockedCardSource()
    assert.match(locked, /formatLockedTrophyProgress/)
    assert.match(locked, /hasLockedTrophyProgress/)
    assert.match(locked, /role="progressbar"/)
    assert.match(locked, /aria-valuenow=/)
    assert.match(locked, /aria-valuemin=\{0\}/)
    assert.match(locked, /aria-valuemax=/)
    assert.doesNotMatch(locked, /<span>Progression<\/span>/)
    assert.doesNotMatch(locked, /Se débloque en match/)
    assert.doesNotMatch(locked, /Verrouillé/)
    assert.match(locked, /verrouillé/)
  })

  it('keeps earned and locked card components available', () => {
    assert.match(trophyPanelFile, /function EarnedTrophyCard/)
    assert.match(trophyPanelFile, /function LockedTrophyCard/)
    assert.match(trophyPanelFile, /overview\.earnedTrophies/)
    assert.match(trophyPanelFile, /overview\.lockedTrophies/)
  })
})
