import type { ReactNode } from 'react'

/**
 * En-tête de page applicative partagé (Classement, Calendrier, Paramètres…).
 * Accent vert latéral + titre + sous-titre orienté usage.
 */
export function PageHeader({
  title,
  description,
  actions,
}: {
  title: string
  description: string
  /** Actions alignées à droite (ex. ancre Calendrier). */
  actions?: ReactNode
}) {
  return (
    <header
      className={[
        'flex gap-3',
        actions
          ? 'flex-wrap items-end justify-between'
          : 'items-start',
      ].join(' ')}
    >
      <div className="flex min-w-0 items-start gap-3">
        <span
          aria-hidden="true"
          className="mt-0.5 h-10 w-1.5 shrink-0 bg-green"
        />
        <div className="min-w-0">
          <h1 className="title-display">{title}</h1>
          <p className="mt-0.5 text-sm text-muted">{description}</p>
        </div>
      </div>
      {actions ? <div className="shrink-0">{actions}</div> : null}
    </header>
  )
}
