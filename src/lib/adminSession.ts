const ADMIN_CODE_KEY = 'aln_admin_code'

export function readAdminCode(): string | null {
  return sessionStorage.getItem(ADMIN_CODE_KEY)
}

export function saveAdminCode(code: string): void {
  sessionStorage.setItem(ADMIN_CODE_KEY, code)
}

export function clearAdminCode(): void {
  sessionStorage.removeItem(ADMIN_CODE_KEY)
}
