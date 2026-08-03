import { useCallback, useEffect, useState } from 'react'
import {
  isStandaloneDisplay,
  shouldOfferNativeInstall,
  shouldShowIosInstallHelp,
  type BeforeInstallPromptEvent,
} from '../lib/pwa'

export function usePwaInstall() {
  const [deferredPrompt, setDeferredPrompt] =
    useState<BeforeInstallPromptEvent | null>(null)
  const [installed, setInstalled] = useState(() => isStandaloneDisplay())
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState<string | null>(null)

  useEffect(() => {
    function onBeforeInstall(event: BeforeInstallPromptEvent) {
      event.preventDefault()
      setDeferredPrompt(event)
    }

    function onInstalled() {
      setInstalled(true)
      setDeferredPrompt(null)
      setMessage(null)
    }

    window.addEventListener('beforeinstallprompt', onBeforeInstall)
    window.addEventListener('appinstalled', onInstalled)
    return () => {
      window.removeEventListener('beforeinstallprompt', onBeforeInstall)
      window.removeEventListener('appinstalled', onInstalled)
    }
  }, [])

  const canNativeInstall = shouldOfferNativeInstall(deferredPrompt) && !installed
  const showIosHelp = shouldShowIosInstallHelp() && !installed

  const install = useCallback(async () => {
    if (!deferredPrompt || busy) return
    setBusy(true)
    setMessage(null)
    try {
      await deferredPrompt.prompt()
      const choice = await deferredPrompt.userChoice
      if (choice.outcome === 'accepted') {
        setInstalled(true)
        setMessage(null)
      } else {
        setMessage('Installation annulée.')
      }
    } catch {
      setMessage('Impossible de lancer l’installation pour le moment.')
    } finally {
      setDeferredPrompt(null)
      setBusy(false)
    }
  }, [busy, deferredPrompt])

  return {
    canNativeInstall,
    showIosHelp,
    installed,
    busy,
    message,
    install,
  }
}
