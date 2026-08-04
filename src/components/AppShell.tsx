import { Outlet } from 'react-router-dom'
import { BrandMark } from './BrandMark'
import { BottomNav, Header } from './Layout'
import { useSession } from '../context/useSession'
import { AccessPage } from '../pages/AccessPage'

export function AppShell() {
  const { phase } = useSession()

  if (phase === 'loading') {
    return (
      <div className="flex min-h-dvh flex-col items-center justify-center gap-4 bg-canvas px-4">
        <BrandMark size="lg" decorative={false} className="rounded-[var(--radius-md)]" />
        <p className="text-sm font-black tracking-[0.14em] text-ink uppercase">
          Chargement…
        </p>
      </div>
    )
  }

  if (
    phase === 'needs_code' ||
    phase === 'needs_player' ||
    phase === 'needs_pin' ||
    phase === 'needs_pin_change' ||
    phase === 'misconfigured'
  ) {
    return <AccessPage />
  }

  return (
    <div className="flex min-h-dvh flex-col">
      <Header />
      <main className="mx-auto w-full max-w-5xl flex-1 px-4 py-4 pb-24 sm:px-6 md:py-6 md:pb-8">
        <Outlet />
      </main>
      <BottomNav />
    </div>
  )
}
