import { Link, NavLink } from 'react-router-dom'
import { CalendarDays, Home, Settings, Trophy } from 'lucide-react'
import { BrandMark } from './BrandMark'
import { useSession } from '../context/useSession'

const navItems = [
  { to: '/', label: 'Accueil', icon: Home, end: true },
  { to: '/calendrier', label: 'Calendrier', icon: CalendarDays, end: false },
  { to: '/classement', label: 'Classement', icon: Trophy, end: false },
] as const

function desktopNavClass({ isActive }: { isActive: boolean }): string {
  return [
    'relative inline-flex min-h-11 items-center px-2 py-1 text-xs font-extrabold tracking-[0.1em] uppercase transition-[color] duration-150 ease-out',
    isActive
      ? 'text-ink after:absolute after:right-0 after:bottom-0 after:left-0 after:h-1 after:rounded-full after:bg-green'
      : 'text-ink/65 hover:text-ink',
  ].join(' ')
}

function mobileNavClass({ isActive }: { isActive: boolean }): string {
  return [
    'flex min-h-11 flex-1 flex-col items-center justify-center gap-0.5 mx-0.5 my-1 rounded-[var(--radius-sm)] px-2 py-1.5 text-[11px] font-bold tracking-[0.08em] uppercase transition-[color,background-color] duration-150 ease-out',
    isActive
      ? 'bg-white/12 text-yellow'
      : 'text-white/65 hover:bg-white/5 hover:text-white',
  ].join(' ')
}

export function Header() {
  const { activePlayer } = useSession()
  const pseudo = activePlayer?.pseudo ?? '—'

  return (
    <header className="sticky top-0 z-40 border-b border-ink bg-yellow pt-[env(safe-area-inset-top)]">
      <div className="mx-auto flex max-w-5xl items-center justify-between gap-2 px-4 py-2 sm:gap-3 sm:px-6 sm:py-2.5">
        <div className="flex min-w-0 items-center gap-3 sm:gap-3.5">
          <Link
            to="/"
            className="inline-flex size-11 shrink-0 items-center justify-center rounded-[var(--radius-sm)]"
            aria-label="À la Nantaise — accueil"
          >
            <BrandMark size="md" className="rounded-[var(--radius-sm)]" />
          </Link>
          <div className="min-w-0">
            <Link
              to="/"
              className="block truncate text-base font-black tracking-tight text-ink uppercase sm:text-xl"
            >
              À la Nantaise
            </Link>
            <p className="hidden truncate text-[10px] font-semibold tracking-[0.06em] text-ink/60 min-[400px]:block">
              <span className="normal-case">{pseudo}</span>
              <span className="mx-1.5 text-ink/25">·</span>
              <span className="tracking-[0.12em] text-green-dark/75 uppercase">
                Saison 26/27
              </span>
            </p>
          </div>
        </div>

        <div className="flex shrink-0 items-center gap-1 sm:gap-3">
          <nav
            className="hidden items-center gap-3 md:flex"
            aria-label="Navigation principale"
          >
            {navItems.map(({ to, label, end }) => (
              <NavLink key={to} to={to} end={end} className={desktopNavClass}>
                {label}
              </NavLink>
            ))}
          </nav>

          <Link
            to="/parametres"
            className="inline-flex size-11 items-center justify-center rounded-[var(--radius-sm)] text-ink/75 transition-[color,background-color] duration-150 ease-out hover:bg-ink/10 hover:text-ink"
            aria-label="Paramètres"
            title="Paramètres"
          >
            <Settings aria-hidden="true" className="size-5" strokeWidth={2.25} />
          </Link>
        </div>
      </div>
    </header>
  )
}

export function BottomNav() {
  return (
    <nav
      className="fixed inset-x-0 bottom-0 z-40 border-t border-white/10 bg-green-dark pb-[max(0.5rem,env(safe-area-inset-bottom))] md:hidden"
      aria-label="Navigation mobile"
    >
      {/* Conteneur shell ; zone d’actions compacte centrée (évite une barre vide). */}
      <div className="mx-auto w-full max-w-5xl">
        <div className="mx-auto flex max-w-lg px-1">
          {navItems.map(({ to, label, icon: Icon, end }) => (
            <NavLink key={to} to={to} end={end} className={mobileNavClass}>
              <Icon aria-hidden="true" className="size-5" strokeWidth={2.25} />
              <span>{label}</span>
            </NavLink>
          ))}
        </div>
      </div>
    </nav>
  )
}
