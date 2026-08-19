import { OFFLINE_USER_MESSAGE } from '../lib/pwa'
import { useOnlineStatus } from '../hooks/useOnlineStatus'
import { usePwaUpdate } from '../hooks/usePwaUpdate'

export function PwaOfflineBanner() {
  const { visible: updateVisible } = usePwaUpdate()
  const online = useOnlineStatus()
  if (updateVisible) return null
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
