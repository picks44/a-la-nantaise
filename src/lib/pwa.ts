export const OFFLINE_USER_MESSAGE =
  'Connexion indisponible. Reconnecte-toi pour consulter les données et enregistrer un pronostic.'

type BeforeInstallPromptEvent = Event & {
  prompt: () => Promise<void>
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed'; platform: string }>
}

declare global {
  interface WindowEventMap {
    beforeinstallprompt: BeforeInstallPromptEvent
  }
}

export type { BeforeInstallPromptEvent }

/** Hint only — never treat as absolute connectivity proof. */
export function isBrowserOnline(): boolean {
  if (typeof navigator === 'undefined') return true
  return navigator.onLine
}

export function isStandaloneDisplay(): boolean {
  if (typeof window === 'undefined') return false
  const mediaStandalone = window.matchMedia('(display-mode: standalone)').matches
  const iosStandalone =
    'standalone' in navigator &&
    Boolean((navigator as Navigator & { standalone?: boolean }).standalone)
  return mediaStandalone || iosStandalone
}

/**
 * Heuristic iPhone / iPad detection for manual install instructions.
 * Includes iPadOS desktop-mode UA when possible.
 */
export function isIosLikeDevice(): boolean {
  if (typeof navigator === 'undefined') return false
  const ua = navigator.userAgent
  if (/iPhone|iPod/i.test(ua)) return true
  if (/iPad/i.test(ua)) return true
  // iPadOS 13+ may report as MacIntel with touch points.
  if (
    navigator.platform === 'MacIntel' &&
    typeof navigator.maxTouchPoints === 'number' &&
    navigator.maxTouchPoints > 1
  ) {
    return true
  }
  return false
}

export function shouldShowIosInstallHelp(): boolean {
  return isIosLikeDevice() && !isStandaloneDisplay()
}

export function shouldOfferNativeInstall(
  deferredPrompt: BeforeInstallPromptEvent | null,
): boolean {
  return Boolean(deferredPrompt) && !isStandaloneDisplay()
}
