import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { describe, it } from 'node:test'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')

function read(relativePath) {
  return readFileSync(join(root, relativePath), 'utf8')
}

describe('PageHeader pattern', () => {
  it('exposes shared accent + title + description layout', () => {
    const header = read('src/components/PageHeader.tsx')
    assert.match(header, /export function PageHeader/)
    assert.match(header, /title-display/)
    assert.match(header, /w-1\.5 shrink-0 bg-green/)
    assert.match(header, /actions/)
  })

  it('wires Ranking, Calendar and Settings without inventing Access/Admin headers', () => {
    const ranking = read('src/pages/RankingPage.tsx')
    const calendar = read('src/pages/CalendarPage.tsx')
    const settings = read('src/pages/SettingsPage.tsx')

    assert.match(ranking, /<PageHeader/)
    assert.match(ranking, /La course du groupe, journée après journée\./)
    assert.match(calendar, /<PageHeader/)
    assert.match(
      calendar,
      /Les matchs à venir, tes pronostics et les résultats\./,
    )
    assert.doesNotMatch(calendar, /actions=\{/)
    assert.match(settings, /<PageHeader/)
    assert.match(settings, /Gère tes préférences et ton profil\./)

    assert.doesNotMatch(ranking, /<h1 className="title-display">/)
    assert.doesNotMatch(calendar, /<h1 className="title-display">/)
    assert.doesNotMatch(settings, /<h1 className="title-display">/)
  })
})
