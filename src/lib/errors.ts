export class ApiError extends Error {
  readonly code: string

  constructor(code: string, message: string) {
    super(message)
    this.name = 'ApiError'
    this.code = code
  }
}

const KNOWN_CODES = [
  'INVALID_ACCESS_CODE',
  'ACCESS_CODE_NOT_CONFIGURED',
  'INVALID_PLAYER',
  'INVALID_INPUT',
  'INVALID_SCORE',
  'MATCH_NOT_FOUND',
  'MATCH_NOT_OPENABLE',
  'MATCH_LOCKED',
  'MATCH_NOT_FINISHED',
] as const

export function getErrorCode(error: unknown): string | null {
  const message =
    error instanceof Error
      ? error.message
      : typeof error === 'string'
        ? error
        : ''

  for (const code of KNOWN_CODES) {
    if (message.includes(code)) return code
  }

  if (error instanceof ApiError) return error.code
  return null
}

export function toUserMessage(error: unknown): string {
  const code = getErrorCode(error)

  switch (code) {
    case 'INVALID_ACCESS_CODE':
      return 'Code d’accès incorrect.'
    case 'ACCESS_CODE_NOT_CONFIGURED':
      return 'Le code commun n’est pas encore configuré côté Supabase.'
    case 'INVALID_PLAYER':
      return 'Ce joueur est introuvable ou inactif.'
    case 'INVALID_SCORE':
      return 'Les scores doivent être des entiers entre 0 et 15.'
    case 'MATCH_LOCKED':
      return 'Le match vient de commencer : les pronostics sont verrouillés.'
    case 'MATCH_NOT_OPENABLE':
      return 'Ce match n’accepte plus de pronostic.'
    case 'MATCH_NOT_FOUND':
      return 'Match introuvable.'
    case 'MATCH_NOT_FINISHED':
      return 'Le match doit être terminé pour calculer les points.'
    default:
      if (error instanceof Error && error.message) return error.message
      return 'Une erreur est survenue. Réessaie dans un instant.'
  }
}
