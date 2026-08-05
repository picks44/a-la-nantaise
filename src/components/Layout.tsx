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
      ? 'text-green-dark after:absolute after:right-0 after:bottom-0 after:left-0 after:h-0.5 after:bg-green'
      : 'text-ink/65 hover:text-ink',
  ].join(' ')
}

function mobileNavClass({ isActive }: { isActive: boolean }): string {
  return [
    'flex min-h-11 flex-1 flex-col items-center justify-center gap-0.5 px-2 py-2 text-[10px] font-bold tracking-[0.08em] uppercase transition-[color] duration-150 ease-out',
    isActive ? 'text-yellow' : 'text-white/65 hover:text-white',
  ].join(' ')
}

export function Header() {
  const { activePlayer } = useSession()

  return (
    <header className="sticky top-0 z-40 border-b border-ink bg-yellow pt-[env(safe-area-inset-top)]">
      <div className="mx-auto flex max-w-5xl items-center justify-between gap-2 px-3 py-2 sm:gap-3 sm:px-6 sm:py-2.5">
        <div className="flex min-w-0 items-center gap-2 sm:gap-3">
          <Link
            to="/"
            className="inline-flex size-11 shrink-0 items-center justify-center rounded-[var(--radius-sm)] p-0.5"
            aria-label="À la Nantaise — accueil"
          >
            <BrandMark size="sm" className="rounded-[var(--radius-sm)]" />
          </Link>
          <div className="min-w-0">
            <Link
              to="/"
              className="block truncate text-base font-black tracking-tight text-ink uppercase sm:text-xl"
            >
              À la Nantaise
            </Link>
            <p className="hidden truncate text-[10px] font-bold tracking-[0.12em] text-green-dark uppercase min-[400px]:block">
              Pronos 26/27
              <span className="mx-1.5 text-ink/30">·</span>
              <span className="tracking-normal text-ink/70 normal-case">
                {activePlayer?.pseudo ?? '—'}
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
            className="inline-flex size-11 items-center justify-center border border-ink/25 text-ink transition-[color,background-color,border-color] duration-150 ease-out hover:border-ink hover:bg-green-dark hover:text-yellow"
            aria-label="Paramètres d’accès"
            title="Paramètres d’accès"
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
      <div className="mx-auto flex max-w-lg">
        {navItems.map(({ to, label, icon: Icon, end }) => (
          <NavLink key={to} to={to} end={end} className={mobileNavClass}>
            <Icon aria-hidden="true" className="size-5" strokeWidth={2.25} />
            <span>{label}</span>
          </NavLink>
        ))}
      </div>
    </nav>
  )
}
