import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { describe, it } from 'node:test'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')

function read(relativePath) {
  return readFileSync(join(root, relativePath), 'utf8')
}

describe('Home full recap CTA', () => {
  const home = read('src/pages/HomePage.tsx')

  it('always deep-links Voir le résumé complet to calendrier finished match', () => {
    const lastBlock = home.slice(home.indexOf('function LastMatchBlock'))
    assert.match(lastBlock, /Voir le résumé complet/)
    assert.match(lastBlock, /to=\{`\/calendrier\?match=\$\{match\.id\}`\}/)
    assert.doesNotMatch(lastBlock, /classement#recap/)
    assert.doesNotMatch(lastBlock, /showFullRecapCta/)
    assert.doesNotMatch(home, /recap\.roundNumber === lastMatch\.matchday/)
    assert.doesNotMatch(home, /to="\/classement#recap"/)
  })

  it('does not keep group-reveal CTA inside LastMatchBlock', () => {
    const lastBlock = home.slice(home.indexOf('function LastMatchBlock'))
    assert.doesNotMatch(lastBlock, /Voir les pronos du groupe/)
  })
})

describe('Ranking #recap deep-link', () => {
  const ranking = read('src/pages/RankingPage.tsx')
  const card = read('src/components/RoundRecapCard.tsx')

  it('exposes id="recap" on RoundRecapCard', () => {
    assert.match(card, /id="recap"/)
  })

  it('scrolls to #recap once after successful recap load', () => {
    assert.match(ranking, /scrolledToRecapRef/)
    assert.match(ranking, /window\.location\.hash !== '#recap'/)
    assert.match(ranking, /getElementById\('recap'\)/)
    assert.match(ranking, /scrolledToRecapRef\.current = true/)
    assert.match(ranking, /recapView\.status !== 'success'/)
    assert.match(ranking, /\[recapView\.status\]/)
    assert.match(ranking, /useState<RankingTab>\('general'\)/)
    assert.doesNotMatch(ranking, /searchParams\.get\('round'\)/)
    assert.doesNotMatch(ranking, /searchParams\.get\('match'\)/)
  })
})

describe('Calendar prediction CTA copies', () => {
  const item = read('src/components/MatchListItem.tsx')

  it('uses Modifier mon prono for predicted open matches', () => {
    assert.match(item, /Modifier mon prono/)
    assert.match(item, /aria-label="Modifier mon prono sur l’accueil"/)
    assert.doesNotMatch(item, /Voir mon prono/)
  })

  it('uses Pronostiquer for to_predict open matches', () => {
    assert.match(item, /aria-label="Pronostiquer"/)
    assert.match(
      item,
      /shouldLinkToPrediction \? \([\s\S]*Pronostiquer/,
    )
  })

  it('does not offer edit CTAs for locked or finished shells', () => {
    assert.match(
      item,
      /canShowModifier[\s\S]*status === 'predicted' && isPredictionTarget/,
    )
    assert.doesNotMatch(
      item,
      /status === 'locked'[\s\S]{0,80}Modifier mon prono/,
    )
    assert.doesNotMatch(
      item,
      /status === 'finished'[\s\S]{0,80}Modifier mon prono/,
    )
  })
})
