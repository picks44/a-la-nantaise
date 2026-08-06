import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, it } from 'node:test'

import {
  createGenerationToken,
  createRefreshCoalescer,
  runCalendarDataLoad,
} from '../src/lib/calendarRefresh.ts'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const calendarPage = readFileSync(
  join(root, 'src/pages/CalendarPage.tsx'),
  'utf8',
)

describe('createGenerationToken', () => {
  it('ignores stale generations after a newer one starts', () => {
    const token = createGenerationToken()
    const first = token.next()
    const second = token.next()
    assert.equal(token.isCurrent(first), false)
    assert.equal(token.isCurrent(second), true)
    token.bump()
    assert.equal(token.isCurrent(second), false)
  })
})

describe('createRefreshCoalescer', () => {
  it('coalesces rapid requests into a single flush', async () => {
    let flushes = 0
    const coalescer = createRefreshCoalescer({
      delayMs: 20,
      onFlush: () => {
        flushes += 1
      },
    })

    coalescer.request()
    coalescer.request()
    coalescer.request()
    assert.equal(flushes, 0)

    await new Promise((resolve) => setTimeout(resolve, 40))
    assert.equal(flushes, 1)
    coalescer.dispose()
  })
})

describe('runCalendarDataLoad', () => {
  it('uses full loading on initial mode and applies success', async () => {
    const events = []
    const result = await runCalendarDataLoad({
      mode: 'initial',
      hasExistingData: false,
      generation: 1,
      isCurrent: () => true,
      load: async () => ({ ok: true }),
      onFullLoading: () => events.push('full'),
      onSoftStart: () => events.push('soft'),
      onSuccess: (bundle) => events.push(`success:${bundle.ok}`),
      onError: () => events.push('error'),
      onSettled: () => events.push('settled'),
    })

    assert.equal(result, 'applied')
    assert.deepEqual(events, ['full', 'success:true', 'settled'])
  })

  it('keeps soft mode without full loading when data exists', async () => {
    const events = []
    const result = await runCalendarDataLoad({
      mode: 'soft',
      hasExistingData: true,
      generation: 2,
      isCurrent: () => true,
      load: async () => ({ ok: true }),
      onFullLoading: () => events.push('full'),
      onSoftStart: () => events.push('soft'),
      onSuccess: () => events.push('success'),
      onError: () => events.push('error'),
      onSettled: () => events.push('settled'),
    })

    assert.equal(result, 'applied')
    assert.deepEqual(events, ['soft', 'success', 'settled'])
  })

  it('drops stale responses after a newer generation', async () => {
    let current = 1
    const events = []
    const result = await runCalendarDataLoad({
      mode: 'soft',
      hasExistingData: true,
      generation: 1,
      isCurrent: (generation) => generation === current,
      load: async () => {
        current = 2
        return { ok: true }
      },
      onFullLoading: () => events.push('full'),
      onSoftStart: () => events.push('soft'),
      onSuccess: () => events.push('success'),
      onError: () => events.push('error'),
      onSettled: () => events.push('settled'),
    })

    assert.equal(result, 'stale')
    assert.deepEqual(events, ['soft'])
  })
})

describe('CalendarPage refresh wiring (A2a)', () => {
  it('uses coalesced soft refresh with generation helpers', () => {
    assert.match(calendarPage, /createRefreshCoalescer/)
    assert.match(calendarPage, /createGenerationToken/)
    assert.match(calendarPage, /runCalendarDataLoad/)
    assert.match(calendarPage, /loadCalendarData\('soft'\)/)
    assert.match(calendarPage, /showInitialLoading/)
    assert.match(calendarPage, /reloadRevealsAfterData/)
  })

  it('does not blank the list on focus by resetting reveals before fetch', () => {
    // Reveal reset must happen after data lands, inside reloadRevealsAfterData.
    const refreshEffect = calendarPage.slice(
      calendarPage.indexOf('createRefreshCoalescer'),
      calendarPage.indexOf('const revealableMatchIds'),
    )
    assert.doesNotMatch(refreshEffect, /resetInFlight/)
    assert.doesNotMatch(refreshEffect, /setLoading\(true\)/)
  })
})
