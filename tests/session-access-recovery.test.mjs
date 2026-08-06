import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, it } from 'node:test'

import {
  isPlayerSessionExpiry,
  resolveAfterSessionInvalidation,
} from '../src/lib/sessionRecovery.ts'
import { toUserMessage } from '../src/lib/errors.ts'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const apiSource = readFileSync(join(root, 'src/lib/api.ts'), 'utf8')
const sessionSource = readFileSync(
  join(root, 'src/context/SessionProvider.tsx'),
  'utf8',
)

describe('isPlayerSessionExpiry', () => {
  it('recognises session expiry codes only', () => {
    assert.equal(isPlayerSessionExpiry('INVALID_SESSION'), true)
    assert.equal(isPlayerSessionExpiry('SESSION_EXPIRED'), true)
    assert.equal(isPlayerSessionExpiry('INVALID_ACCESS_CODE'), false)
  })
})

describe('resolveAfterSessionInvalidation', () => {
  it('keeps a valid access code and returns needs_player on session expiry', async () => {
    const result = await resolveAfterSessionInvalidation({
      code: 'SESSION_EXPIRED',
      accessCode: 'group-code',
      verifyAccessCode: async () => true,
      fetchActivePlayers: async () => [
        { id: 'p1', pseudo: 'Ada', isActive: true },
      ],
    })

    assert.equal(result.outcome, 'needs_player')
    if (result.outcome === 'needs_player') {
      assert.equal(result.accessCode, 'group-code')
      assert.equal(result.players.length, 1)
      assert.equal(result.message, toUserMessage(new Error('SESSION_EXPIRED')))
    }
  })

  it('clears everything when the access code itself is invalid', async () => {
    const result = await resolveAfterSessionInvalidation({
      code: 'INVALID_SESSION',
      accessCode: 'stale-code',
      verifyAccessCode: async () => false,
      fetchActivePlayers: async () => {
        throw new Error('should not be called')
      },
    })

    assert.deepEqual(result, {
      outcome: 'needs_code',
      message:
        'Le code d’accès du groupe a changé. Saisis le nouveau code pour continuer.',
      clearAll: true,
    })
  })

  it('clears everything when the invalidation is an access-code change', async () => {
    const result = await resolveAfterSessionInvalidation({
      code: 'INVALID_ACCESS_CODE',
      accessCode: 'group-code',
      verifyAccessCode: async () => true,
      fetchActivePlayers: async () => [],
    })

    assert.equal(result.outcome, 'needs_code')
    if (result.outcome === 'needs_code') {
      assert.equal(result.clearAll, true)
    }
  })

  it('keeps the access code when verification fails with a network error', async () => {
    const result = await resolveAfterSessionInvalidation({
      code: 'INVALID_SESSION',
      accessCode: 'group-code',
      verifyAccessCode: async () => {
        throw new Error('Failed to fetch')
      },
      fetchActivePlayers: async () => [],
    })

    assert.equal(result.outcome, 'needs_player_degraded')
    if (result.outcome === 'needs_player_degraded') {
      assert.equal(result.accessCode, 'group-code')
      assert.equal(
        result.message,
        'Connexion impossible. Vérifie ta connexion internet et réessaie.',
      )
    }
  })

  it('requires full re-entry when session expires without a stored access code', async () => {
    const result = await resolveAfterSessionInvalidation({
      code: 'INVALID_SESSION',
      accessCode: null,
      verifyAccessCode: async () => true,
      fetchActivePlayers: async () => [],
    })

    assert.equal(result.outcome, 'needs_code')
    if (result.outcome === 'needs_code') {
      assert.equal(result.clearAll, true)
      assert.equal(result.message, toUserMessage(new Error('INVALID_SESSION')))
    }
  })
})

describe('verifyAccessCode and SessionProvider wiring (A1b)', () => {
  it('does not map every verifyAccessCode failure to false', () => {
    const fn = apiSource.slice(
      apiSource.indexOf('export async function verifyAccessCode'),
      apiSource.indexOf('export async function fetchActivePlayers'),
    )
    assert.doesNotMatch(fn, /return false/)
    assert.match(fn, /return Boolean\(result\)/)
    assert.match(
      fn,
      /Configuration and transport failures must propagate/,
    )
  })

  it('notifies on SESSION_EXPIRED as well as INVALID_SESSION', () => {
    assert.match(apiSource, /code === 'SESSION_EXPIRED'/)
  })

  it('recovers expired sessions without always clearing the access code', () => {
    assert.match(sessionSource, /resolveAfterSessionInvalidation/)
    assert.match(sessionSource, /clearPlayerSessionOnly/)
    assert.match(sessionSource, /needs_player_degraded/)
    assert.doesNotMatch(
      sessionSource,
      /invalidatePlayerSession = useCallback\(\s*\(code: string\) => \{\s*const previousToken = sessionToken\s*void bestEffortDeactivateRemotePush\(\s*previousToken,\s*deactivatePushSubscription,\s*\)\s*clearAuthState\(\)/,
    )
  })
})
