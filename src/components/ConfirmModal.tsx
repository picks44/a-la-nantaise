import type { ReactNode } from 'react'

interface ConfirmModalProps {
  title: string
  children: ReactNode
  confirmLabel: string
  cancelLabel?: string
  pending?: boolean
  onConfirm: () => void
  onCancel: () => void
}

export function ConfirmModal({
  title,
  children,
  confirmLabel,
  cancelLabel = 'Annuler',
  pending = false,
  onConfirm,
  onCancel,
}: ConfirmModalProps) {
  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center bg-ink/55 p-4 sm:items-center"
      role="presentation"
      onClick={onCancel}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="confirm-modal-title"
        className="w-full max-w-md border-2 border-ink bg-surface p-5 shadow-none"
        onClick={(event) => event.stopPropagation()}
      >
        <h2
          id="confirm-modal-title"
          className="text-sm font-black tracking-[0.08em] uppercase"
        >
          {title}
        </h2>
        <div className="mt-3 text-sm text-muted">{children}</div>
        <div className="mt-5 flex flex-col gap-2 sm:flex-row-reverse">
          <button
            type="button"
            className="btn-ink sm:w-auto"
            disabled={pending}
            onClick={onConfirm}
          >
            {pending ? 'Enregistrement…' : confirmLabel}
          </button>
          <button
            type="button"
            className="inline-flex w-full items-center justify-center rounded-[var(--radius-sm)] border-2 border-ink bg-canvas px-4 py-3 text-sm font-extrabold tracking-[0.06em] uppercase sm:w-auto"
            disabled={pending}
            onClick={onCancel}
          >
            {cancelLabel}
          </button>
        </div>
      </div>
    </div>
  )
}
