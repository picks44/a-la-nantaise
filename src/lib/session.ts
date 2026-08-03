const ACCESS_CODE_KEY = 'aln_access_code'
const PLAYER_ID_KEY = 'aln_player_id'

export interface LocalSession {
  accessCode: string
  playerId: string | null
}

export function readLocalSession(): LocalSession | null {
  const accessCode = localStorage.getItem(ACCESS_CODE_KEY)
  if (!accessCode) return null

  return {
    accessCode,
    playerId: localStorage.getItem(PLAYER_ID_KEY),
  }
}

export function saveAccessCode(accessCode: string): void {
  localStorage.setItem(ACCESS_CODE_KEY, accessCode)
}

export function savePlayerId(playerId: string): void {
  localStorage.setItem(PLAYER_ID_KEY, playerId)
}

export function clearPlayerId(): void {
  localStorage.removeItem(PLAYER_ID_KEY)
}

export function clearLocalSession(): void {
  localStorage.removeItem(ACCESS_CODE_KEY)
  localStorage.removeItem(PLAYER_ID_KEY)
}
