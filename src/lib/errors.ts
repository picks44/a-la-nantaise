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
  'INVALID_ACCESS_CODE_LENGTH',
  'ACCESS_CODE_NOT_CONFIGURED',
  'INVALID_ADMIN_CODE',
  'ADMIN_CODE_NOT_CONFIGURED',
  'INVALID_CREDENTIALS',
  'INVALID_SESSION',
  'INVALID_PIN_FORMAT',
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
  'SYNC_CONFLICT',
  'SYNC_FAILED',
  'INVALID_SYNC_PLAN',
  'INVALID_FEED_SHAPE',
  'INVALID_FEED_COUNT',
  'DUPLICATE_ROUND',
  'MISSING_ROUND',
  'INVALID_FIXTURE_DATE',
  'INVALID_FIXTURE_SCORE',
  'FEED_HTTP_ERROR',
  'FEED_TIMEOUT',
  'FEED_TOO_LARGE',
  'FEED_NOT_JSON',
  'INVALID_PUSH_ENDPOINT',
  'INVALID_PUSH_KEYS',
  'PUSH_DEVICE_LIMIT',
  'PUSH_UNSUPPORTED',
  'PUSH_MISCONFIGURED',
  'PUSH_PERMISSION_DENIED',
  'PUSH_SUBSCRIPTION_INVALID',
] as const

export function getErrorCode(error: unknown): string | null {
  if (error instanceof ApiError) return error.code

  const message =
    error instanceof Error
      ? error.message
      : typeof error === 'string'
        ? error
        : ''

  for (const code of KNOWN_CODES) {
    if (message.includes(code)) return code
  }

  return null
}

export function toUserMessage(error: unknown): string {
  const code = getErrorCode(error)

  switch (code) {
    case 'INVALID_ACCESS_CODE':
      return 'Code d’accès incorrect.'
    case 'INVALID_ACCESS_CODE_LENGTH':
      return 'Le code d’accès doit contenir entre 4 et 64 caractères.'
    case 'ACCESS_CODE_NOT_CONFIGURED':
      return 'Le code commun n’est pas encore configuré côté Supabase.'
    case 'INVALID_ADMIN_CODE':
      return 'Code administrateur incorrect.'
    case 'ADMIN_CODE_NOT_CONFIGURED':
      return 'Le code administrateur n’est pas encore configuré côté Supabase.'
    case 'INVALID_CREDENTIALS':
      return 'Connexion impossible, réessaie plus tard.'
    case 'INVALID_SESSION':
      return 'Session expirée. Reconnecte-toi avec ton PIN.'
    case 'INVALID_PIN_FORMAT':
      return 'Le PIN doit contenir 4 ou 6 chiffres.'
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
    case 'SYNC_CONFLICT':
      return 'Conflit de rapprochement : plusieurs matchs correspondent à la même rencontre.'
    case 'SYNC_FAILED':
      return 'La synchronisation a échoué. Réessaie dans un instant.'
    case 'INVALID_SYNC_PLAN':
      return 'Plan de synchronisation invalide.'
    case 'INVALID_FEED_SHAPE':
      return 'Le calendrier reçu n’a pas le format attendu.'
    case 'INVALID_FEED_COUNT':
      return 'Le flux ne contient pas exactement 34 matchs.'
    case 'DUPLICATE_ROUND':
      return 'Le flux contient des journées dupliquées.'
    case 'MISSING_ROUND':
      return 'Le flux ne couvre pas toutes les journées 1 à 34.'
    case 'INVALID_FIXTURE_DATE':
      return 'Une date de match du flux est invalide.'
    case 'INVALID_FIXTURE_SCORE':
      return 'Un score du flux est invalide.'
    case 'FEED_HTTP_ERROR':
      return 'Impossible de télécharger le calendrier Fixture Download.'
    case 'FEED_TIMEOUT':
      return 'Délai dépassé lors du téléchargement du calendrier.'
    case 'FEED_TOO_LARGE':
      return 'La réponse du calendrier est trop volumineuse.'
    case 'FEED_NOT_JSON':
      return 'La réponse du calendrier n’est pas un JSON valide.'
    case 'INVALID_PUSH_ENDPOINT':
      return 'Endpoint de notification invalide.'
    case 'INVALID_PUSH_KEYS':
      return 'Clés d’abonnement push invalides.'
    case 'PUSH_DEVICE_LIMIT':
      return 'Trop d’appareils actifs pour les rappels.'
    case 'PUSH_UNSUPPORTED':
      return 'Les notifications push ne sont pas disponibles sur ce navigateur.'
    case 'PUSH_MISCONFIGURED':
      return 'Les rappels ne sont pas encore configurés sur ce déploiement.'
    case 'PUSH_PERMISSION_DENIED':
      return 'Permission de notification refusée.'
    case 'PUSH_SUBSCRIPTION_INVALID':
      return 'Abonnement push incomplet. Réessaie.'
    default:
      if (error instanceof Error && error.message) return error.message
      return 'Une erreur est survenue. Réessaie dans un instant.'
  }
}
