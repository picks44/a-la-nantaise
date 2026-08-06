import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { describe, it } from 'node:test'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  formatFutureMatchMeta,
  formatSavedPrediction,
} from '../src/lib/calendarDisplay.ts'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')

function read(relativePath) {
  return readFileSync(join(root, relativePath), 'utf8')
}

describe('formatFutureMatchMeta', () => {
  it('formats confirmed kickoff meta', () => {
    const label = formatFutureMatchMeta({
      matchday: 6,
      kickoffAt: '2026-08-22T18:45:00.000Z',
      status: 'to_predict',
      kickoffTimeConfirmed: true,
    })
    assert.match(label, /^J6 · /)
    assert.match(label, / · \d{2}:\d{2}$/)
  })

  it('formats unconfirmed kickoff without inventing a time', () => {
    assert.equal(
      formatFutureMatchMeta({
        matchday: 10,
        kickoffAt: '2026-09-01T00:00:00.000Z',
        status: 'kickoff_unconfirmed',
        kickoffTimeConfirmed: false,
      }),
      'J10 · Horaire à confirmer',
    )
  })

  it('formats postponed and cancelled with date only', () => {
    const postponed = formatFutureMatchMeta({
      matchday: 8,
      kickoffAt: '2026-08-30T18:00:00.000Z',
      status: 'postponed',
      kickoffTimeConfirmed: true,
    })
    assert.match(postponed, /^J8 · /)
    assert.doesNotMatch(postponed, / · \d{2}:\d{2}$/)
  })
})

describe('formatSavedPrediction', () => {
  it('formats a saved score and returns null when absent', () => {
    assert.equal(
      formatSavedPrediction({ homeScore: 1, awayScore: 0 }),
      'Ton prono : 1–0',
    )
    assert.equal(formatSavedPrediction(null), null)
    assert.equal(formatSavedPrediction(undefined), null)
  })
})

describe('MatchListItem future compact wiring (K4)', () => {
  const item = read('src/components/MatchListItem.tsx')
  const order = read('src/lib/matchOrder.ts')
  const calendar = read('src/pages/CalendarPage.tsx')

  const compactStart = item.indexOf('if (isCompactFuture)')
  const fullCardStart = item.indexOf(
    'Jaune fort réservé au prochain match',
    compactStart,
  )
  const compact = item.slice(compactStart, fullCardStart)

  it('uses an explicit compact branch for non-finished non-next matches', () => {
    assert.match(item, /const isCompactFuture = !isFinished && !isNext/)
    assert.match(compact, /future-match-row/)
    assert.match(compact, /formatFutureMatchMeta/)
    assert.match(compact, /formatSavedPrediction/)
    assert.match(compact, /statusLabel\(match\.status\)/)
    assert.match(compact, /id=\{`match-\$\{match\.id\}`\}/)
    assert.match(compact, /data-match-id=\{match\.id\}/)
    assert.match(compact, /scroll-mt-24/)
  })

  it('keeps next and finished on the full card path', () => {
    assert.match(item, /id="prochain-match"/)
    assert.match(item, /border-ink bg-yellow/)
    assert.match(item, /border-green-dark bg-green-dark/)
    assert.match(item, /formatCalendarPersonalPrediction/)
    assert.match(item, /match-reveal-details/)
  })

  it('omits group teaser, reveal copy, venue and actions from compact rows', () => {
    assert.doesNotMatch(compact, /Les pronos du groupe/)
    assert.doesNotMatch(compact, /reveles automatiquement/)
    assert.doesNotMatch(compact, /ouvriront bientôt/)
    assert.doesNotMatch(compact, /venueSecondaryLabel/)
    assert.doesNotMatch(compact, /La Beaujoire/)
    assert.doesNotMatch(compact, /<Link/)
    assert.doesNotMatch(compact, /Modifier/)
    assert.doesNotMatch(compact, /RevealSection/)
  })

  it('shows saved prediction only for predicted and locked compact rows', () => {
    assert.match(
      compact,
      /match\.status === 'predicted' \|\| match\.status === 'locked'/,
    )
    assert.match(compact, /formatSavedPrediction/)
  })

  it('does not change next-match selection or calendar wiring', () => {
    assert.match(order, /export function findNextOpenMatch/)
    assert.match(order, /kickoffTimeConfirmed === true/)
    assert.match(calendar, /findNextOpenMatch/)
    assert.match(calendar, /isNext=\{match\.id === nextOpenId\}/)
    assert.match(calendar, /isPredictionTarget=\{match\.id === nextOpenId\}/)
    assert.match(calendar, /findLastFinishedMatch/)
  })

  it('styles compact future rows in CSS', () => {
    const css = read('src/index.css')
    assert.match(css, /\.future-match-row/)
  })
})
