import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import {
  celebrationStorageKey,
  getCelebrationFlag,
  getCelebrationNumber,
  setCelebrationFlag,
  setCelebrationNumber,
} from '../src/lib/celebrations.ts'

class MemoryStorage {
  #store = new Map()

  getItem(key) {
    return this.#store.has(key) ? this.#store.get(key) : null
  }

  setItem(key, value) {
    this.#store.set(key, String(value))
  }

  removeItem(key) {
    this.#store.delete(key)
  }
}

describe('celebrations localStorage helper', () => {
  it('uses the expected localStorage key format', () => {
    const key = celebrationStorageKey({
      groupId: 'group-1',
      playerId: 'player-2',
      seasonId: 'season-3',
      eventType: 'trophy_confetti',
      eventId: 'batch-4',
    })

    assert.equal(
      key,
      'aln:celebration:group-1:player-2:season-3:trophy_confetti:batch-4',
    )
  })

  it('reads/writes boolean celebration flags', () => {
    globalThis.localStorage = new MemoryStorage()
    const key = celebrationStorageKey({
      groupId: 'g',
      playerId: 'p',
      seasonId: 's',
      eventType: 't',
      eventId: 'e',
    })

    assert.equal(getCelebrationFlag(key), false)
    setCelebrationFlag(key)
    assert.equal(getCelebrationFlag(key), true)

    delete globalThis.localStorage
  })

  it('reads/writes numeric celebration values', () => {
    globalThis.localStorage = new MemoryStorage()
    const key = celebrationStorageKey({
      groupId: 'g',
      playerId: 'p',
      seasonId: 's',
      eventType: 'record_personal_best_prediction_streak',
      eventId: 'bestPredictionStreak',
    })

    assert.equal(getCelebrationNumber(key), null)
    setCelebrationNumber(key, 12)
    assert.equal(getCelebrationNumber(key), 12)

    setCelebrationNumber(key, 12.5)
    assert.equal(getCelebrationNumber(key), 12.5)

    // Invalid value => null
    localStorage.setItem(key, 'not-a-number')
    assert.equal(getCelebrationNumber(key), null)

    delete globalThis.localStorage
  })
})

