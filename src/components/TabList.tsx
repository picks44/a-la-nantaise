import type { ReactNode } from 'react'

/**
 * Onglets segmentés partagés (Classement, Calendrier…).
 * Classes `.ranking-tablist` / `.ranking-tab` conservées pour le scroll mobile.
 */
export function TabList<T extends string>({
  label,
  value,
  onChange,
  order,
  children,
}: {
  label: string
  value: T
  onChange: (next: T) => void
  order: readonly T[]
  children: ReactNode
}) {
  return (
    <div
      role="tablist"
      aria-label={label}
      className="ranking-tablist flex rounded-[var(--radius-sm)] border border-ink bg-surface p-1"
      onKeyDown={(event) => {
        if (event.key !== 'ArrowRight' && event.key !== 'ArrowLeft') return
        event.preventDefault()
        const index = order.indexOf(value)
        if (index < 0) return
        const next =
          event.key === 'ArrowRight'
            ? order[(index + 1) % order.length]
            : order[(index - 1 + order.length) % order.length]
        onChange(next)
      }}
    >
      {children}
    </div>
  )
}

export function TabButton({
  selected,
  onSelect,
  id,
  controls,
  children,
  fill = false,
}: {
  selected: boolean
  onSelect: () => void
  id: string
  controls: string
  children: string
  /** Calendrier (2 tabs) : largeur égale aussi en mobile. Classement : laisser false. */
  fill?: boolean
}) {
  return (
    <button
      type="button"
      role="tab"
      id={id}
      aria-selected={selected}
      aria-controls={controls}
      tabIndex={selected ? 0 : -1}
      className={[
        'ranking-tab min-h-10 whitespace-nowrap rounded-[var(--radius-sm)] px-2 text-xs font-extrabold tracking-[0.08em] uppercase transition-[color,background-color] duration-150 ease-out sm:min-h-11 sm:px-2',
        fill ? 'min-w-0 flex-1' : 'shrink-0 sm:min-w-0 sm:flex-1',
        selected
          ? 'bg-green-dark text-yellow'
          : 'text-ink/65 hover:bg-canvas hover:text-ink',
      ].join(' ')}
      onClick={onSelect}
    >
      {children}
    </button>
  )
}
