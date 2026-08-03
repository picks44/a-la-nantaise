/* Push / notificationclick handlers for the generated Workbox SW.
 * Loaded via workbox.importScripts — no fetch handlers, no Supabase access.
 */
/* eslint-disable no-restricted-globals */

function isUuid(value) {
  return (
    typeof value === 'string' &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
      value,
    )
  )
}

function safeMatchUrl(matchId) {
  if (!isUuid(matchId)) return '/calendrier'
  return `/calendrier?match=${matchId}`
}

function parsePayload(event) {
  if (!event.data) {
    return {
      title: 'À la Nantaise',
      body: 'Tu as un rappel de pronostic.',
      url: '/calendrier',
      tag: 'aln-reminder',
    }
  }

  let raw
  try {
    raw = event.data.json()
  } catch {
    try {
      raw = JSON.parse(event.data.text())
    } catch {
      return null
    }
  }

  if (!raw || typeof raw !== 'object') return null

  const title =
    typeof raw.title === 'string' && raw.title.trim()
      ? raw.title.trim().slice(0, 80)
      : 'À la Nantaise'
  const body =
    typeof raw.body === 'string' && raw.body.trim()
      ? raw.body.trim().slice(0, 180)
      : 'Tu as un rappel de pronostic.'

  let url = '/calendrier'
  if (typeof raw.url === 'string' && raw.url.startsWith('/calendrier')) {
    const allowed = /^\/calendrier(\?match=[0-9a-f-]{36})?$/i
    if (allowed.test(raw.url)) url = raw.url
  } else if (isUuid(raw.matchId)) {
    url = safeMatchUrl(raw.matchId)
  }

  const tag =
    typeof raw.tag === 'string' && raw.tag.trim()
      ? raw.tag.trim().slice(0, 64)
      : isUuid(raw.matchId)
        ? `aln-reminder-${raw.matchId}`
        : 'aln-reminder'

  return { title, body, url, tag }
}

self.addEventListener('push', (event) => {
  const payload = parsePayload(event)
  if (!payload) return

  event.waitUntil(
    self.registration.showNotification(payload.title, {
      body: payload.body,
      icon: '/icons/icon-192.png',
      badge: '/icons/icon-192.png',
      tag: payload.tag,
      renotify: false,
      data: { url: payload.url },
    }),
  )
})

self.addEventListener('notificationclick', (event) => {
  event.notification.close()

  const rawUrl =
    event.notification &&
    event.notification.data &&
    typeof event.notification.data.url === 'string'
      ? event.notification.data.url
      : '/calendrier'

  const path = rawUrl.startsWith('/calendrier') ? rawUrl : '/calendrier'
  const targetUrl = new URL(path, self.location.origin).href

  event.waitUntil(
    (async () => {
      const clientsList = await self.clients.matchAll({
        type: 'window',
        includeUncontrolled: true,
      })

      for (const client of clientsList) {
        if ('focus' in client) {
          await client.focus()
          if ('navigate' in client) {
            try {
              await client.navigate(targetUrl)
            } catch {
              // Some browsers disallow navigate; openWindow fallback below.
            }
          }
          return
        }
      }

      if (self.clients.openWindow) {
        await self.clients.openWindow(targetUrl)
      }
    })(),
  )
})
