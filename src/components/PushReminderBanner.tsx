import { Link } from 'react-router-dom'
import { usePushReminderBanner } from '../hooks/usePushReminderBanner'

export function PushReminderBanner() {
  const { visible, dismiss } = usePushReminderBanner()
  if (!visible) return null

  return (
    <div
      role="status"
      aria-live="polite"
      className="border-b border-ink bg-surface px-4 py-2.5"
    >
      <div className="mx-auto flex max-w-5xl flex-wrap items-center justify-between gap-3">
        <div className="min-w-0">
          <p className="text-sm font-semibold text-ink">
            Active les rappels match
          </p>
          <p className="mt-0.5 text-sm text-muted">
            Reçois un rappel avant le coup d’envoi et quand les résultats sont
            disponibles.
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <Link to="/parametres" className="btn-ink min-h-11 sm:min-w-0">
            Activer
          </Link>
          <button
            type="button"
            className="inline-flex min-h-11 items-center justify-center rounded-[var(--radius-sm)] border border-border bg-canvas px-3 py-2 text-xs font-bold tracking-[0.06em] uppercase"
            onClick={dismiss}
          >
            Plus tard
          </button>
        </div>
      </div>
    </div>
  )
}
