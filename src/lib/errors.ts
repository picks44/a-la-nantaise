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
  'INVALID_ADMIN_CODE',
  'ADMIN_CODE_NOT_CONFIGURED',
  'INVALID_PLAYER',
  'INVALID_PLAYER_NAME',
  'DUPLICATE_PLAYER_NAME',
  'INVALID_INPUT',
  'INVALID_SCORE',
  'INVALID_ROUND',
  'INVALID_KICKOFF',
  'INVALID_STATUS',
  'INVALID_TEAM_NAME',
  'INVALID_NANTES_FIXTURE',
  'INCOMPLETE_RESULT',
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
    case 'INVALID_ADMIN_CODE':
      return 'Code administrateur incorrect.'
    case 'ADMIN_CODE_NOT_CONFIGURED':
      return 'Le code administrateur n’est pas encore configuré côté Supabase.'
    case 'INVALID_PLAYER':
      return 'Ce joueur est introuvable ou inactif.'
    case 'INVALID_PLAYER_NAME':
      return 'Le pseudo doit contenir entre 2 et 30 caractères.'
    case 'DUPLICATE_PLAYER_NAME':
      return 'Ce pseudo est déjà utilisé.'
    case 'INVALID_SCORE':
      return 'Les scores doivent être des entiers entre 0 et 15.'
    case 'INVALID_ROUND':
      return 'Le numéro de journée doit être entre 1 et 34.'
    case 'INVALID_KICKOFF':
      return 'La date et l’heure du coup d’envoi sont invalides.'
    case 'INVALID_STATUS':
      return 'Statut de match invalide.'
    case 'INVALID_TEAM_NAME':
      return 'Les noms d’équipes sont obligatoires.'
    case 'INVALID_NANTES_FIXTURE':
      return 'Exactement une des deux équipes doit être le FC Nantes.'
    case 'INCOMPLETE_RESULT':
      return 'Un match terminé doit avoir ses deux scores.'
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
