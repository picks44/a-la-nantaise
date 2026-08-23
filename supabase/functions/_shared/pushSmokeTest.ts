/**
 * Variantes temporaires du smoke test Web Push.
 * Isolent payload vs Topic sans créer de reminder ni de delivery.
 */

import {
  buildNotificationPayload,
  type ReminderClaim,
  webPushTopic,
} from './pushReminderPlanner.ts'

export const SMOKE_TEST_PAYLOAD = {
  title: 'À la Nantaise',
  body: 'Test des rappels réussi. Les notifications sont bien activées.',
  icon: '/icons/icon-192.png',
  badge: '/icons/icon-192.png',
  tag: 'push-smoke-test',
  data: {
    url: '/parametres',
    type: 'smoke_test',
  },
} as const

export const SMOKE_TEST_VARIANT_IDS = [
  'default',
  'kickoff_full',
  'kickoff_no_topic',
  'smoke_kickoff_topic',
] as const

export type SmokeTestVariant = (typeof SMOKE_TEST_VARIANT_IDS)[number]

/** Données synthétiques fixes — jamais lues en base métier. */
export const SYNTHETIC_KICKOFF_CLAIM: ReminderClaim = {
  delivery_id: '00000000-0000-4000-8000-000000000001',
  reminder_id: '00000000-0000-4000-8000-000000000002',
  subscription_id: '00000000-0000-4000-8000-000000000003',
  match_id: '74e86cb8-d62f-480a-9f4e-ff6c33001074',
  player_id: '00000000-0000-4000-8000-000000000004',
  reminder_type: 'kickoff_5m',
  home_team: 'FC Nantes',
  away_team: 'AS Nancy Lorraine',
  kickoff_at: '2026-09-07T18:45:00+00:00',
  endpoint: 'https://web.push.apple.com/synthetic',
  p256dh: 'synthetic',
  auth: 'synthetic',
  content_encoding: 'aes128gcm',
}

export function isSmokeTestVariant(value: unknown): value is SmokeTestVariant {
  return (
    typeof value === 'string' &&
    (SMOKE_TEST_VARIANT_IDS as readonly string[]).includes(value)
  )
}

export function resolveSmokeTestSend(variant: SmokeTestVariant): {
  payload: unknown
  topic: string | undefined
} {
  const kickoffPayload = buildNotificationPayload(SYNTHETIC_KICKOFF_CLAIM)
  const kickoffTopic = webPushTopic(SYNTHETIC_KICKOFF_CLAIM)

  switch (variant) {
    case 'default':
      return { payload: SMOKE_TEST_PAYLOAD, topic: 'push-smoke-test' }
    case 'kickoff_full':
      return { payload: kickoffPayload, topic: kickoffTopic }
    case 'kickoff_no_topic':
      return { payload: kickoffPayload, topic: undefined }
    case 'smoke_kickoff_topic':
      return { payload: SMOKE_TEST_PAYLOAD, topic: kickoffTopic }
  }
}
