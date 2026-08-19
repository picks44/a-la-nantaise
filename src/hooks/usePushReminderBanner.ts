import { useCallback, useEffect, useRef, useState } from 'react'
import { useLocation } from 'react-router-dom'
import { useSession } from '../context/useSession'
import { useOnlineStatus } from './useOnlineStatus'
import { usePwaUpdate } from './usePwaUpdate'
import {
  resolvePushActivationState,
  type PushActivationState,
} from '../lib/push'
import {
  dismissPushReminderBanner,
  readPushReminderBannerDismissed,
  shouldShowPushReminderBanner,
} from '../lib/pushReminderBanner'

export function usePushReminderBanner() {
  const { phase, sessionToken, playerId } = useSession()
  const { pathname } = useLocation()
  const { visible: pwaUpdateVisible } = usePwaUpdate()
  const isOnline = useOnlineStatus()
  const [activationState, setActivationState] =
    useState<PushActivationState | null>(null)
  const [checking, setChecking] = useState(true)
  const [dismissed, setDismissed] = useState(() =>
    readPushReminderBannerDismissed(),
  )
  const requestIdRef = useRef(0)

  const refresh = useCallback(async () => {
    if (phase !== 'ready' || !sessionToken || !playerId) {
      setActivationState(null)
      setChecking(false)
      return
    }

    const requestId = ++requestIdRef.current
    setChecking(true)

    try {
      const next = await resolvePushActivationState(sessionToken, playerId)
      if (requestId !== requestIdRef.current) return
      setActivationState(next)
    } catch {
      if (requestId !== requestIdRef.current) return
      setActivationState('hidden')
    } finally {
      if (requestId === requestIdRef.current) {
        setChecking(false)
      }
    }
  }, [phase, sessionToken, playerId])

  useEffect(() => {
    void refresh()
  }, [phase, sessionToken, playerId, pathname, refresh])

  useEffect(() => {
    function onVisibilityChange() {
      if (document.visibilityState === 'visible') {
        void refresh()
      }
    }

    document.addEventListener('visibilitychange', onVisibilityChange)
    return () => {
      document.removeEventListener('visibilitychange', onVisibilityChange)
    }
  }, [refresh])

  const dismiss = useCallback(() => {
    dismissPushReminderBanner()
    setDismissed(true)
  }, [])

  const visible =
    !checking &&
    shouldShowPushReminderBanner({
      phase,
      pathname,
      dismissed: dismissed || readPushReminderBannerDismissed(),
      pwaUpdateVisible,
      isOnline,
      activationState,
    })

  return { visible, dismiss, checking }
}
