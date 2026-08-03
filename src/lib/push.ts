import {
  isIosLikeDevice,
  isStandaloneDisplay,
  shouldShowIosInstallHelp,
} from './pwa'

export type PushUiState =
  | 'unsupported'
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

export function isWebPushSupported(): boolean {
  if (typeof window === 'undefined') return false
  return (
    'serviceWorker' in navigator &&
    'PushManager' in window &&
    'Notification' in window
  )
}

export function resolvePushGateState(): PushUiState {
  if (shouldShowIosInstallHelp()) return 'ios_install_required'
  if (isIosLikeDevice() && !isStandaloneDisplay()) return 'ios_install_required'
  if (!isWebPushSupported()) return 'unsupported'
  if (!getVapidPublicKey()) return 'unsupported'

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
    applicationServerKey: urlBase64ToUint8Array(
      vapidKey,
    ) as BufferSource,
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
