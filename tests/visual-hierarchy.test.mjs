import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { describe, it } from 'node:test'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')

function read(relativePath) {
  return readFileSync(join(root, relativePath), 'utf8')
}

describe('visual hierarchy polish', () => {
  it('exposes semantic color tokens and button primitives', () => {
    const css = read('src/index.css')
    assert.match(css, /--color-surface-muted/)
    assert.match(css, /--color-success/)
    assert.match(css, /--color-warning/)
    assert.match(css, /--color-focus/)
    assert.match(css, /\.btn-secondary/)
    assert.match(css, /\.btn-danger/)
    assert.match(css, /\.btn-ghost/)
    assert.match(css, /\.badge/)
    assert.match(css, /outline: 2px solid var\(--color-focus\)/)
  })

  it('keeps calendar cards white by default and yellow only for next match', () => {
    const item = read('src/components/MatchListItem.tsx')
    assert.match(item, /isNext/)
    assert.match(item, /border-border bg-surface/)
    assert.match(item, /border-ink bg-yellow/)
    assert.doesNotMatch(
      item,
      /isOpen\s*\n\s*\? 'border-ink bg-yellow'/,
    )
  })

  it('does not paint every rank-1 row yellow in ranking views', () => {
    const ranking = read('src/pages/RankingPage.tsx')
    const podium = read('src/components/Podium.tsx')
    assert.match(ranking, /isFirstOccurrenceOfRank/)
    assert.match(podium, /isFirstOccurrenceOfRank/)
    assert.doesNotMatch(ranking, /isLeader \? 'bg-yellow'/)
    assert.doesNotMatch(podium, /isLeader \? 'bg-yellow'/)
    assert.match(ranking, /border-l-green/)
    assert.match(podium, /badge border-green bg-green/)
  })

  it('uses green for desktop active nav and sticky header', () => {
    const layout = read('src/components/Layout.tsx')
    assert.match(layout, /sticky top-0/)
    assert.match(layout, /after:bg-green/)
    assert.match(layout, /text-green-dark/)
    assert.match(layout, /min-h-11/)
  })

  it('compacts board score inputs and keeps font-size mobile-safe', () => {
    const score = read('src/components/ScoreInput.tsx')
    assert.match(score, /max-w-\[5\.5rem\]/)
    assert.match(score, /text-3xl/)
    assert.doesNotMatch(score, /sm:text-5xl/)
  })

  it('makes ConfirmModal keyboard-accessible', () => {
    const modal = read('src/components/ConfirmModal.tsx')
    assert.match(modal, /aria-describedby/)
    assert.match(modal, /Escape/)
    assert.match(modal, /getFocusableElements/)
    assert.match(modal, /previouslyFocused/)
    assert.match(modal, /stopPropagation/)
  })

  it('uses green success feedback on home and selection in settings', () => {
    const home = read('src/pages/HomePage.tsx')
    const settings = read('src/pages/SettingsPage.tsx')
    assert.match(home, /text-success/)
    assert.match(settings, /bg-success-soft/)
    assert.match(settings, /btn-danger/)
    assert.doesNotMatch(settings, /checked \? 'bg-yellow'/)
  })
})
