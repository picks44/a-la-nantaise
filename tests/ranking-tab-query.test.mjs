import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { describe, it } from 'node:test'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { parseRankingTab } from '../src/lib/rankingDisplay.ts'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')

function read(relativePath) {
  return readFileSync(join(root, relativePath), 'utf8')
}

describe('parseRankingTab', () => {
  it('defaults missing and invalid values to general', () => {
    assert.equal(parseRankingTab(null), 'general')
    assert.equal(parseRankingTab(''), 'general')
    assert.equal(parseRankingTab('nope'), 'general')
    assert.equal(parseRankingTab('Trophies'), 'general')
  })

  it('accepts the four ranking tabs', () => {
    assert.equal(parseRankingTab('general'), 'general')
    assert.equal(parseRankingTab('participation'), 'participation')
    assert.equal(parseRankingTab('trophies'), 'trophies')
    assert.equal(parseRankingTab('parcours'), 'parcours')
  })
})

describe('ranking tab query wiring', () => {
  const ranking = read('src/pages/RankingPage.tsx')
  const card = read('src/components/RoundRecapCard.tsx')

  it('opens trophies from the recap CTA and keeps general as the empty URL', () => {
    assert.match(card, /to="\/classement\?tab=trophies"/)
    assert.match(ranking, /selectRankingTab/)
    assert.match(ranking, /setSearchParams\(\{\}, \{ replace: true \}\)/)
    assert.match(ranking, /setSearchParams\(\{ tab: next \}, \{ replace: true \}\)/)
  })
})
