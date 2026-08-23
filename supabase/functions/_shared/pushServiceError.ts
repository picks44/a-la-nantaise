/**
 * Analyse sûre des réponses d’erreur Web Push (Apple / FCM / Mozilla).
 * Ne jamais y passer endpoint, p256dh, auth, JWT ou clés.
 */

export type PushServiceProvider = 'apple' | 'fcm' | 'mozilla' | 'other'

/** RFC 8030 Topic : 1–32 caractères URL/filename-safe Base64 (sans padding `=`). */
const APPLE_TOPIC_RE = /^[A-Za-z0-9_-]{1,32}$/

const APPLE_REASON_RE = /^[A-Za-z][A-Za-z0-9_]{0,63}$/

export function pushProviderFromEndpoint(endpoint: string): PushServiceProvider {
  let host: string
  try {
    host = new URL(endpoint).hostname.toLowerCase()
  } catch {
    return 'other'
  }

  if (host === 'web.push.apple.com' || host.endsWith('.push.apple.com')) {
    return 'apple'
  }
  if (host === 'fcm.googleapis.com' || host.endsWith('.googleapis.com')) {
    return 'fcm'
  }
  if (host.endsWith('.mozilla.com') || host.endsWith('.mozilla.org')) {
    return 'mozilla'
  }
  return 'other'
}

export function isAppleSafeWebPushTopic(topic: string): boolean {
  return APPLE_TOPIC_RE.test(topic)
}

/**
 * Extrait `reason` d’un JSON Apple `{ "reason": "BadWebPushRequest" }`.
 * Ignore tout texte qui ressemble à une URL, une clé ou un JWT.
 */
export function extractPushServiceReason(bodyText: string): string | null {
  const trimmed = bodyText.trim()
  if (!trimmed || trimmed.length > 2048) return null

  let parsed: unknown
  try {
    parsed = JSON.parse(trimmed)
  } catch {
    return null
  }

  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    return null
  }

  const reason = (parsed as { reason?: unknown }).reason
  if (typeof reason !== 'string') return null
  if (!APPLE_REASON_RE.test(reason)) return null
  return reason
}

export async function readPushServiceReason(
  response: Response,
): Promise<string | null> {
  try {
    const text = await response.text()
    return extractPushServiceReason(text)
  } catch {
    return null
  }
}

export function logPushServiceError(entry: {
  provider: PushServiceProvider
  status: number
  reason: string | null
}): void {
  console.error(
    JSON.stringify({
      msg: 'push_service_error',
      provider: entry.provider,
      status: entry.status,
      reason: entry.reason,
    }),
  )
}
