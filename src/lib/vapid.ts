/**
 * Checks the VAPID public key without leaking it (length + placeholder check
 * only). Never log or render the actual key value.
 */
export function isVapidPublicKeyConfigured(): boolean {
  const key = import.meta.env.VITE_VAPID_PUBLIC_KEY
  return typeof key === 'string' && key.trim().length > 20 && !key.includes('YOUR_')
}
