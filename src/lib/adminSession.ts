const ADMIN_SESSION_TOKEN_KEY = 'aln_admin_session_token'

export function readAdminSessionToken(): string | null {
  return sessionStorage.getItem(ADMIN_SESSION_TOKEN_KEY)
}

export function saveAdminSessionToken(token: string): void {
  sessionStorage.setItem(ADMIN_SESSION_TOKEN_KEY, token)
}

export function clearAdminSessionToken(): void {
  sessionStorage.removeItem(ADMIN_SESSION_TOKEN_KEY)
}
