import { Download, Share } from 'lucide-react'
import { usePwaInstall } from '../hooks/usePwaInstall'

export function PwaInstallSection() {
  const {
    canNativeInstall,
    showIosHelp,
    installed,
    busy,
    message,
    install,
  } = usePwaInstall()

  if (installed) return null
  if (!canNativeInstall && !showIosHelp) return null

  return (
    <section aria-labelledby="pwa-install-title" className="panel p-4">
      <h2
        id="pwa-install-title"
        className="text-sm font-black tracking-[0.08em] uppercase"
      >
        Application
      </h2>
      <p className="mt-1 text-sm text-muted">
        Installe À la Nantaise sur ton écran d’accueil pour un accès plus rapide.
      </p>

      {canNativeInstall ? (
        <button
          type="button"
          className="btn-ink mt-4"
          disabled={busy}
          onClick={() => void install()}
        >
          <Download aria-hidden="true" className="mr-2 inline size-4" />
          {busy ? 'Installation…' : 'Installer l’application'}
        </button>
      ) : null}

      {showIosHelp ? (
        <p className="mt-4 text-sm text-ink">
          <Share aria-hidden="true" className="mr-1.5 inline size-4 align-text-bottom" />
          Sur iPhone ou iPad : ouvre le menu{' '}
          <strong>Partager</strong> puis choisis{' '}
          <strong>Sur l’écran d’accueil</strong>.
        </p>
      ) : null}

      {message ? (
        <p role="status" aria-live="polite" className="mt-3 text-sm text-muted">
          {message}
        </p>
      ) : null}
    </section>
  )
}
