import { useCallback, useEffect, useRef, useState } from 'react'
import { useRegisterSW } from 'virtual:pwa-register/react'

export function usePwaUpdate() {
  const [dismissed, setDismissed] = useState(false)
  const reloadStarted = useRef(false)

  const {
    needRefresh: [needRefresh, setNeedRefresh],
    updateServiceWorker,
  } = useRegisterSW({
    onRegisteredSW(_swUrl, registration) {
      if (!registration) return
      window.setInterval(() => {
        if (document.visibilityState === 'visible') {
          void registration.update()
        }
      }, 60 * 60 * 1000)
    },
  })

  useEffect(() => {
    if (needRefresh) setDismissed(false)
  }, [needRefresh])

  const visible = needRefresh && !dismissed

  const applyUpdate = useCallback(() => {
    if (reloadStarted.current) return
    reloadStarted.current = true
    void updateServiceWorker(true)
  }, [updateServiceWorker])

  const dismiss = useCallback(() => {
    setDismissed(true)
    setNeedRefresh(false)
  }, [setNeedRefresh])

  return {
    visible,
    applyUpdate,
    dismiss,
  }
}
