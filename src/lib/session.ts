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
