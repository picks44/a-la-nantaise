import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import { formatPoints } from '../src/lib/formatPoints.ts'
import { formatCalendarPoints } from '../src/lib/calendarDisplay.ts'
import { formatRecapRoundPoints } from '../src/lib/recapMessages.ts'
import { UNKNOWN_USER_MESSAGE } from '../src/lib/errors.ts'

describe('formatPoints', () => {
  it('formats unsigned 0, 1 and many', () => {
    assert.equal(formatPoints(0), '0 pt')
    assert.equal(formatPoints(1), '1 pt')
    assert.equal(formatPoints(3), '3 pts')
  })

  it('formats signed positives with a leading plus', () => {
    assert.equal(formatPoints(3, { signed: true }), '+3 pts')
    assert.equal(formatPoints(1, { signed: true }), '+1 pt')
    assert.equal(formatPoints(0, { signed: true }), '0 pt')
  })

  it('keeps calendar and recap wrappers aligned', () => {
    assert.equal(formatCalendarPoints(2), formatPoints(2))
    assert.equal(formatRecapRoundPoints(1), formatPoints(1))
  })
})

describe('UNKNOWN_USER_MESSAGE', () => {
  it('exposes the shared fallback copy', () => {
    assert.equal(
      UNKNOWN_USER_MESSAGE,
      'Une erreur est survenue. Réessaie dans quelques instants.',
    )
  })
})
