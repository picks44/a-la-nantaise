import {
  isIosLikeDevice,
  isStandaloneDisplay,
  shouldShowIosInstallHelp,
} from './pwa'

export type PushUiState =
  | 'unsupported'
  | 'insecure_context'
  | 'misconfigured'
  | 'ios_install_required'
  | 'default'
  | 'denied'
  | 'granted_inactive'
  | 'active'
  | 'pending'
  | 'error'

export function urlBase64ToUint8Array(base64String: string): Uint8Array {
  const padding = '='.repeat((4 - (base64String.length % 4)) % 4)
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/')
  const raw = atob(base64)
  const output = new Uint8Array(raw.length)
  for (let i = 0; i < raw.length; i++) {
    output[i] = raw.charCodeAt(i)
  }
  return output
}

export function getVapidPublicKey(): string | null {
  const key = import.meta.env.VITE_VAPID_PUBLIC_KEY
  if (typeof key !== 'string' || key.trim().length < 20) return null
  return key.trim()
}

/**
 * Web Push support without relying on `window.PushManager` (absent on Safari).
 * Requires ServiceWorkerRegistration.prototype.pushManager.
 */
export function isWebPushSupported(): boolean {
  if (typeof window === 'undefined') return false
  if (!window.isSecureContext) return false
  if (!('serviceWorker' in navigator)) return false
  if (!('Notification' in window)) return false
  if (typeof ServiceWorkerRegistration === 'undefined') return false
  return 'pushManager' in ServiceWorkerRegistration.prototype
}

export function resolvePushGateState(): PushUiState {
  if (typeof window === 'undefined') return 'unsupported'

  if (shouldShowIosInstallHelp()) return 'ios_install_required'
  if (isIosLikeDevice() && !isStandaloneDisplay()) return 'ios_install_required'

  if (!window.isSecureContext) return 'insecure_context'

  if (!isWebPushSupported()) return 'unsupported'

  if (!getVapidPublicKey()) return 'misconfigured'

  const permission = Notification.permission
  if (permission === 'denied') return 'denied'
  if (permission === 'granted') return 'granted_inactive'
  return 'default'
}

export async function getExistingPushSubscription(): Promise<PushSubscription | null> {
  if (!isWebPushSupported()) return null
  const registration = await navigator.serviceWorker.ready
  return registration.pushManager.getSubscription()
}

export async function subscribeToPush(): Promise<PushSubscription> {
  if (!window.isSecureContext) {
    throw new Error('PUSH_UNSUPPORTED')
  }
  if (!isWebPushSupported()) {
    throw new Error('PUSH_UNSUPPORTED')
  }

  const vapidKey = getVapidPublicKey()
  if (!vapidKey) {
    throw new Error('PUSH_MISCONFIGURED')
  }

  const permission = await Notification.requestPermission()
  if (permission !== 'granted') {
    throw new Error('PUSH_PERMISSION_DENIED')
  }

  const registration = await navigator.serviceWorker.ready
  const existing = await registration.pushManager.getSubscription()
  if (existing) return existing

  return registration.pushManager.subscribe({
    userVisibleOnly: true,
    applicationServerKey: urlBase64ToUint8Array(vapidKey) as BufferSource,
  })
}

export function serializationFromSubscription(subscription: PushSubscription): {
  endpoint: string
  p256dh: string
  auth: string
  expirationTime: string | null
} {
  const json = subscription.toJSON()
  const endpoint = json.endpoint
  const p256dh = json.keys?.p256dh
  const auth = json.keys?.auth

  if (!endpoint || !p256dh || !auth) {
    throw new Error('PUSH_SUBSCRIPTION_INVALID')
  }

  return {
    endpoint,
    p256dh,
    auth,
    expirationTime:
      typeof json.expirationTime === 'number'
        ? new Date(json.expirationTime).toISOString()
        : null,
  }
}

export async function unsubscribeLocalPush(): Promise<boolean> {
  const subscription = await getExistingPushSubscription()
  if (!subscription) return false
  return subscription.unsubscribe()
}

/**
 * Best-effort remote deactivation using a session token from an ending session.
 * Never throws; never logs endpoint, keys, or tokens. Does not unsubscribe locally.
 */
export async function bestEffortDeactivateRemotePush(
  sessionToken: string | null | undefined,
  deactivate: (token: string, endpoint: string) => Promise<unknown>,
): Promise<void> {
  if (!sessionToken) return
  try {
    if (!isWebPushSupported()) return
    const subscription = await getExistingPushSubscription()
    if (!subscription) return
    await deactivate(sessionToken, subscription.endpoint)
  } catch {
    // Expected when the session is already invalid server-side.
  }
}
