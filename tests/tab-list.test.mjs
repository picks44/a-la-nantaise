import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { describe, it } from 'node:test'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')

function read(relativePath) {
  return readFileSync(join(root, relativePath), 'utf8')
}

describe('TabList shared component', () => {
  const tabs = read('src/components/TabList.tsx')
  const ranking = read('src/pages/RankingPage.tsx')
  const calendar = read('src/pages/CalendarPage.tsx')

  it('exports TabList and TabButton with ranking-tab styles', () => {
    assert.match(tabs, /export function TabList/)
    assert.match(tabs, /export function TabButton/)
    assert.match(tabs, /ranking-tablist/)
    assert.match(tabs, /ranking-tab/)
    assert.match(tabs, /role="tablist"/)
    assert.match(tabs, /role="tab"/)
    assert.match(tabs, /ArrowRight/)
    assert.match(tabs, /ArrowLeft/)
    assert.match(tabs, /fill\?: boolean/)
    assert.match(tabs, /min-h-10/)
    assert.match(tabs, /sm:min-h-11/)
    assert.match(tabs, /fill \? 'min-w-0 flex-1'/)
  })

  it('is reused by Ranking and Calendar without local TabButton', () => {
    assert.match(ranking, /from '..\/components\/TabList'/)
    assert.match(calendar, /from '..\/components\/TabList'/)
    assert.doesNotMatch(ranking, /function TabButton/)
    assert.doesNotMatch(calendar, /function TabButton/)
  })

  it('gives Calendar equal-width tabs via fill; Ranking keeps scroll layout', () => {
    assert.match(calendar, /fill/)
    assert.match(calendar, /controls="panel-upcoming"[\s\S]*fill/)
    assert.match(calendar, /controls="panel-finished"[\s\S]*fill/)
    assert.doesNotMatch(ranking, /\bfill\b/)
  })
})
