import { OFFLINE_USER_MESSAGE } from '../lib/pwa'
import { useOnlineStatus } from '../hooks/useOnlineStatus'

export function PwaOfflineBanner() {
  const online = useOnlineStatus()
  if (online) return null

  return (
    <div
      role="status"
      aria-live="polite"
      className="border-b border-ink bg-ink px-4 py-2.5 text-center text-sm font-semibold text-yellow"
    >
      {OFFLINE_USER_MESSAGE}
    </div>
  )
}
