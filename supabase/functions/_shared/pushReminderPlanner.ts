/** Fenêtres et textes de rappels push (UTC côté serveur, affichage Europe/Paris). */

export type ReminderType = '24h' | '2h' | 'results_available'

export interface ReminderClaim {
  delivery_id: string
  reminder_id: string
  subscription_id: string
  match_id: string
  player_id: string
  reminder_type: ReminderType
  home_team: string
  away_team: string
  kickoff_at: string
  endpoint: string
  p256dh: string
  auth: string
  content_encoding: string
}

const PARIS_TIME = new Intl.DateTimeFormat('fr-FR', {
  timeZone: 'Europe/Paris',
  hour: '2-digit',
  minute: '2-digit',
  hour12: false,
})

export function formatKickoffTimeParis(kickoffAtIso: string): string {
  return PARIS_TIME.format(new Date(kickoffAtIso))
}

export function buildNotificationPayload(claim: ReminderClaim): {
  title: string
  body: string
  matchId: string
  reminderType: ReminderType
  url: string
  tag: string
} {
  const url = `/calendrier?match=${claim.match_id}`
  const tag = `aln-${claim.reminder_type}-${claim.match_id}`

  if (claim.reminder_type === 'results_available') {
    return {
      title: 'Résultats disponibles',
      body: `${claim.home_team} - ${claim.away_team} est terminé. Le classement et les pronos du groupe sont à jour.`,
      matchId: claim.match_id,
      reminderType: 'results_available',
      url,
      tag: `aln-results-${claim.match_id}`,
    }
  }

  if (claim.reminder_type === '24h') {
    const time = formatKickoffTimeParis(claim.kickoff_at)
    return {
      title: 'À la Nantaise',
      body: `${claim.home_team} – ${claim.away_team} demain à ${time}. Ton prono n’est pas encore enregistré.`,
      matchId: claim.match_id,
      reminderType: '24h',
      url,
      tag,
    }
  }

  return {
    title: 'À la Nantaise',
    body: 'Coup d’envoi dans 2 h. Dernière chance pour enregistrer ton prono.',
    matchId: claim.match_id,
    reminderType: '2h',
    url,
    tag,
  }
}

/** Topic Web Push déterministe (ASCII court). */
export function webPushTopic(claim: ReminderClaim): string {
  const compact = `${claim.reminder_type}-${claim.match_id.replace(/-/g, '').slice(0, 16)}`
  return compact.slice(0, 32)
}
