import {
  useEffect,
  useId,
  useRef,
  type KeyboardEvent,
  type ReactNode,
} from 'react'

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
  const titleId = useId()
  const descriptionId = useId()
  const dialogRef = useRef<HTMLDivElement>(null)
  const previouslyFocused = useRef<HTMLElement | null>(null)

  useEffect(() => {
    previouslyFocused.current =
      document.activeElement instanceof HTMLElement
        ? document.activeElement
        : null

    const dialog = dialogRef.current
    const focusables = getFocusableElements(dialog)
    const initial = focusables[0] ?? dialog
    initial?.focus()

    return () => {
      previouslyFocused.current?.focus()
    }
  }, [])

  function handleKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    if (event.key === 'Escape') {
      event.preventDefault()
      if (!pending) onCancel()
      return
    }

    if (event.key !== 'Tab') return

    const focusables = getFocusableElements(dialogRef.current)
    if (focusables.length === 0) {
      event.preventDefault()
      dialogRef.current?.focus()
      return
    }

    const first = focusables[0]
    const last = focusables[focusables.length - 1]
    const active = document.activeElement

    if (event.shiftKey && active === first) {
      event.preventDefault()
      last.focus()
    } else if (!event.shiftKey && active === last) {
      event.preventDefault()
      first.focus()
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center bg-ink/55 p-4 sm:items-center"
      role="presentation"
      onClick={() => {
        if (!pending) onCancel()
      }}
    >
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={descriptionId}
        tabIndex={-1}
        className="w-full max-w-md border border-ink bg-surface p-5 shadow-none outline-none"
        onClick={(event) => event.stopPropagation()}
        onKeyDown={handleKeyDown}
      >
        <h2
          id={titleId}
          className="text-sm font-black tracking-[0.06em] uppercase"
        >
          {title}
        </h2>
        <div id={descriptionId} className="mt-3 text-sm text-muted">
          {children}
        </div>
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
            className="btn-secondary"
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

function getFocusableElements(
  root: HTMLElement | null,
): HTMLElement[] {
  if (!root) return []
  return Array.from(
    root.querySelectorAll<HTMLElement>(
      'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
    ),
  ).filter((element) => !element.hasAttribute('disabled'))
}
