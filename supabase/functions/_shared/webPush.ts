/**
 * Envoi Web Push (RFC 8291 aes128gcm) via @negrel/webpush.
 * Inclut contrôles SSRF avant tout fetch vers l’endpoint.
 */

import * as webpush from '@negrel/webpush'
import type { ReminderClaim } from './pushReminderPlanner.ts'
import {
  buildNotificationPayload,
  webPushTopic,
} from './pushReminderPlanner.ts'

const ALLOWED_HOST_SUFFIXES = [
  '.googleapis.com',
  '.mozilla.com',
  '.mozilla.org',
  '.push.apple.com',
  'push.apple.com',
] as const

const ALLOWED_HOSTS = new Set([
  'fcm.googleapis.com',
  'updates.push.services.mozilla.com',
  'push.services.mozilla.com',
  'web.push.apple.com',
])

/** Topic court et stable pour le smoke test ciblé. */
export const SMOKE_TEST_TOPIC = 'push-smoke-test'

export type PushSendResult =
  | { ok: true; status: number }
  | { ok: false; status: number | null; expired: boolean; retryable: boolean }

export interface PushSubscriptionMaterial {
  endpoint: string
  p256dh: string
  auth: string
  content_encoding: string
}

function isPrivateOrLocalHostname(hostname: string): boolean {
  const host = hostname.toLowerCase().replace(/\.$/, '')
  if (
    host === 'localhost' ||
    host === 'localhost.localdomain' ||
    host.endsWith('.localhost')
  ) {
    return true
  }
  if (host === '::1' || host === '[::1]') return true

  const ipv4 = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(host)
  if (ipv4) {
    const parts = ipv4.slice(1).map(Number)
    if (parts.some((n) => n > 255)) return true
    const [a, b] = parts
    if (a === 10 || a === 127 || a === 0) return true
    if (a === 192 && b === 168) return true
    if (a === 172 && b >= 16 && b <= 31) return true
    if (a === 169 && b === 254) return true
  }

  return false
}

export function assertAllowedPushEndpoint(endpoint: string): void {
  let url: URL
  try {
    url = new URL(endpoint)
  } catch {
    throw new Error('INVALID_PUSH_ENDPOINT')
  }

  if (url.protocol !== 'https:') {
    throw new Error('INVALID_PUSH_ENDPOINT')
  }

  if (url.username || url.password) {
    throw new Error('INVALID_PUSH_ENDPOINT')
  }

  const host = url.hostname.toLowerCase()
  if (isPrivateOrLocalHostname(host)) {
    throw new Error('INVALID_PUSH_ENDPOINT')
  }

  const allowed =
    ALLOWED_HOSTS.has(host) ||
    ALLOWED_HOST_SUFFIXES.some(
      (suffix) => host === suffix.slice(1) || host.endsWith(suffix),
    )

  if (!allowed) {
    throw new Error('INVALID_PUSH_ENDPOINT')
  }
}

export interface WebPushSender {
  sendPayload(
    subscription: PushSubscriptionMaterial,
    payload: unknown,
    options?: { topic?: string },
  ): Promise<PushSendResult>
  sendReminder(claim: ReminderClaim): Promise<PushSendResult>
}

export async function createWebPushSender(env: {
  vapidKeysJson: string
  subject: string
}): Promise<WebPushSender> {
  const exported = JSON.parse(env.vapidKeysJson) as webpush.ExportedVapidKeys
  const vapidKeys = await webpush.importVapidKeys(exported, {
    extractable: false,
  })

  const appServer = await webpush.ApplicationServer.new({
    contactInformation: env.subject,
    vapidKeys,
  })

  async function sendPayload(
    subscription: PushSubscriptionMaterial,
    payload: unknown,
    options?: { topic?: string },
  ): Promise<PushSendResult> {
    try {
      assertAllowedPushEndpoint(subscription.endpoint)
    } catch {
      return { ok: false, status: null, expired: false, retryable: false }
    }

    if (subscription.content_encoding !== 'aes128gcm') {
      return { ok: false, status: null, expired: false, retryable: false }
    }

    const subscriber = appServer.subscribe({
      endpoint: subscription.endpoint,
      keys: {
        p256dh: subscription.p256dh,
        auth: subscription.auth,
      },
    })

    try {
      await subscriber.pushTextMessage(JSON.stringify(payload), {
        ttl: 60 * 60 * 12,
        urgency: webpush.Urgency.Normal,
        ...(options?.topic ? { topic: options.topic } : {}),
      })
      return { ok: true, status: 201 }
    } catch (error) {
      if (error instanceof webpush.PushMessageError) {
        const status = error.response.status
        const expired = status === 404 || status === 410
        const retryable = status === 429 || status >= 500
        return { ok: false, status, expired, retryable }
      }
      // Timeout / réseau ambigu : pas de retry automatique
      return { ok: false, status: null, expired: false, retryable: false }
    }
  }

  return {
    sendPayload,
    async sendReminder(claim: ReminderClaim): Promise<PushSendResult> {
      return sendPayload(
        {
          endpoint: claim.endpoint,
          p256dh: claim.p256dh,
          auth: claim.auth,
          content_encoding: claim.content_encoding,
        },
        buildNotificationPayload(claim),
        { topic: webPushTopic(claim) },
      )
    },
  }
}

/** Hash court non sensible pour logs (jamais l’endpoint complet). */
export async function shortEndpointFingerprint(
  endpoint: string,
): Promise<string> {
  const data = new TextEncoder().encode(endpoint)
  const digest = await crypto.subtle.digest('SHA-256', data)
  const bytes = new Uint8Array(digest)
  return Array.from(bytes.slice(0, 4))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('')
}
