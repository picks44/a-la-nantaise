const ACCESS_CODE_KEY = 'aln_access_code'
const SESSION_TOKEN_KEY = 'aln_session_token'
/** @deprecated Cleared on read; kept only to wipe legacy installs. */
const LEGACY_PLAYER_ID_KEY = 'aln_player_id'

export interface LocalSession {
  accessCode: string | null
  sessionToken: string | null
}

export function readLocalSession(): LocalSession {
  // Never treat a bare playerId as identity.
  localStorage.removeItem(LEGACY_PLAYER_ID_KEY)

  return {
    accessCode: localStorage.getItem(ACCESS_CODE_KEY),
    sessionToken: localStorage.getItem(SESSION_TOKEN_KEY),
  }
}

export function saveAccessCode(accessCode: string): void {
  localStorage.setItem(ACCESS_CODE_KEY, accessCode)
}

export function saveSessionToken(sessionToken: string): void {
  localStorage.setItem(SESSION_TOKEN_KEY, sessionToken)
}

export function clearSessionToken(): void {
  localStorage.removeItem(SESSION_TOKEN_KEY)
}

export function clearAccessCode(): void {
  localStorage.removeItem(ACCESS_CODE_KEY)
}

export function clearLocalSession(): void {
  localStorage.removeItem(ACCESS_CODE_KEY)
  localStorage.removeItem(SESSION_TOKEN_KEY)
  localStorage.removeItem(LEGACY_PLAYER_ID_KEY)
}

const DRAFT_KEY_PREFIX = 'aln_draft_'
const SUPABASE_CACHE_URL_MARKER = 'supabase.co'

/**
 * Nettoyage best-effort de l’état client joueur : jeton de session, ancien
 * identifiant, brouillons de pronostics locaux, et entrées de Cache Storage
 * pointant vers Supabase (sans vider les caches d’assets non liés).
 */
export async function clearPlayerClientState(): Promise<void> {
  clearSessionToken()
  localStorage.removeItem(LEGACY_PLAYER_ID_KEY)

  for (let i = localStorage.length - 1; i >= 0; i -= 1) {
    const key = localStorage.key(i)
    if (key?.startsWith(DRAFT_KEY_PREFIX)) {
      localStorage.removeItem(key)
    }
  }

  if (typeof caches === 'undefined') return

  try {
    const cacheNames = await caches.keys()
    await Promise.all(
      cacheNames.map(async (cacheName) => {
        try {
          const cache = await caches.open(cacheName)
          const requests = await cache.keys()
          await Promise.all(
            requests
              .filter((request) => request.url.includes(SUPABASE_CACHE_URL_MARKER))
              .map((request) => cache.delete(request)),
          )
        } catch {
          // Best-effort : ignore les caches inaccessibles.
        }
      }),
    )
  } catch {
    // Best-effort : Cache Storage indisponible (navigation privée, etc.).
  }
}
