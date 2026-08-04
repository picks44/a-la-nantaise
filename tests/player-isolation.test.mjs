import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { describe, it } from 'node:test'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')

function read(relativePath) {
  return readFileSync(join(root, relativePath), 'utf8')
}

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

  get length() {
    return this.#store.size
  }

  key(index) {
    return Array.from(this.#store.keys())[index] ?? null
  }
}

class FakeCacheStorage {
  #caches = new Map()

  constructor(initial) {
    for (const [name, urls] of Object.entries(initial)) {
      this.#caches.set(name, new Set(urls))
    }
  }

  async keys() {
    return Array.from(this.#caches.keys())
  }

  async open(name) {
    const urls = this.#caches.get(name) ?? new Set()
    this.#caches.set(name, urls)
    return {
      keys: async () => Array.from(urls).map((url) => ({ url })),
      delete: async (request) => urls.delete(request.url),
    }
  }

  remaining(name) {
    return Array.from(this.#caches.get(name) ?? [])
  }
}

describe('session.ts exposes the localStorage keys and clearPlayerClientState helper', () => {
  it('exports save/clear helpers for access code and session token', () => {
    const source = read('src/lib/session.ts')
    assert.match(source, /const ACCESS_CODE_KEY = 'aln_access_code'/)
    assert.match(source, /const SESSION_TOKEN_KEY = 'aln_session_token'/)
    assert.match(source, /export function readLocalSession/)
    assert.match(source, /export function saveAccessCode/)
    assert.match(source, /export function saveSessionToken/)
    assert.match(source, /export function clearSessionToken/)
    assert.match(source, /export function clearAccessCode/)
    assert.match(source, /export function clearLocalSession/)
    assert.match(source, /export async function clearPlayerClientState/)
  })

  it('clearPlayerClientState wipes local draft predictions and only Supabase cache entries', () => {
    const source = read('src/lib/session.ts')
    assert.match(source, /const DRAFT_KEY_PREFIX = 'aln_draft_'/)
    assert.match(source, /const SUPABASE_CACHE_URL_MARKER = 'supabase\.co'/)
    assert.match(source, /clearSessionToken\(\)/)
    assert.match(
      source,
      /key\?\.startsWith\(DRAFT_KEY_PREFIX\)/,
    )
    assert.match(source, /request\.url\.includes\(SUPABASE_CACHE_URL_MARKER\)/)
  })
})

describe('clearPlayerClientState (runtime behavior)', () => {
  async function loadClearPlayerClientState() {
    globalThis.localStorage = new MemoryStorage()
    const module = await import('../src/lib/session.ts')
    return module
  }

  it('removes the session token, legacy player id, and every draft-prefixed key', async () => {
    const { clearPlayerClientState, saveSessionToken, saveAccessCode } =
      await loadClearPlayerClientState()

    saveAccessCode('groupe-test')
    saveSessionToken('session-token-abc')
    localStorage.setItem('aln_player_id', 'legacy-player-id')
    localStorage.setItem('aln_draft_match-1', '{"home":1,"away":2}')
    localStorage.setItem('aln_draft_match-2', '{"home":0,"away":0}')
    localStorage.setItem('unrelated_app_setting', 'keep-me')

    delete globalThis.caches
    await clearPlayerClientState()

    assert.equal(localStorage.getItem('aln_session_token'), null)
    assert.equal(localStorage.getItem('aln_player_id'), null)
    assert.equal(localStorage.getItem('aln_draft_match-1'), null)
    assert.equal(localStorage.getItem('aln_draft_match-2'), null)
    // Access code (group membership) and unrelated keys survive a player-only clear.
    assert.equal(localStorage.getItem('aln_access_code'), 'groupe-test')
    assert.equal(localStorage.getItem('unrelated_app_setting'), 'keep-me')
  })

  it('only purges Cache Storage entries pointing at supabase.co, leaving other caches intact', async () => {
    const { clearPlayerClientState } = await loadClearPlayerClientState()

    globalThis.caches = new FakeCacheStorage({
      'workbox-precache-v1': [
        'https://app.example.com/index.html',
        'https://app.example.com/assets/app.js',
      ],
      'supabase-runtime-cache': [
        'https://abcd1234.supabase.co/rest/v1/matches',
        'https://abcd1234.supabase.co/rest/v1/predictions',
      ],
    })

    await clearPlayerClientState()

    assert.deepEqual(globalThis.caches.remaining('workbox-precache-v1'), [
      'https://app.example.com/index.html',
      'https://app.example.com/assets/app.js',
    ])
    assert.deepEqual(globalThis.caches.remaining('supabase-runtime-cache'), [])

    delete globalThis.caches
    delete globalThis.localStorage
  })
})

describe('SessionProvider wires logout and leaveGroup to clearPlayerClientState', () => {
  const source = read('src/context/SessionProvider.tsx')

  it('imports clearPlayerClientState from lib/session', () => {
    assert.match(source, /clearPlayerClientState,?\n?\s*(?:clearSessionToken|readLocalSession|saveAccessCode|saveSessionToken)/)
    assert.match(source, /from '\.\.\/lib\/session'/)
  })

  it('logout() calls clearPlayerClientState after best-effort server logout', () => {
    const logoutFn = source.match(/const logout = useCallback\(async \(\) => \{[\s\S]*?\n {2}\}, \[[^\]]*\]\)/)?.[0]
    assert.ok(logoutFn, 'logout callback not found')
    assert.match(logoutFn, /await clearPlayerClientState\(\)/)
  })

  it('leaveGroup() also calls clearPlayerClientState so a group switch cannot leak drafts', () => {
    const leaveGroupFn = source.match(
      /const leaveGroup = useCallback\(async \(\) => \{[\s\S]*?\n {2}\}, \[[^\]]*\]\)/,
    )?.[0]
    assert.ok(leaveGroupFn, 'leaveGroup callback not found')
    assert.match(leaveGroupFn, /await clearPlayerClientState\(\)/)
  })
})
