import { usePwaUpdate } from '../hooks/usePwaUpdate'

export function PwaUpdateBanner() {
  const { visible, applyUpdate, dismiss } = usePwaUpdate()
  if (!visible) return null

  return (
    <div
      role="status"
      aria-live="polite"
      className="border-b border-ink bg-surface px-4 py-2.5"
    >
      <div className="mx-auto flex max-w-5xl flex-wrap items-center justify-between gap-2">
        <p className="text-sm font-semibold text-ink">
          Une nouvelle version de l’application est disponible.
        </p>
        <div className="flex items-center gap-2">
          <button
            type="button"
            className="btn-ink min-h-11 sm:min-w-0"
            onClick={applyUpdate}
          >
            Mettre à jour
          </button>
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
