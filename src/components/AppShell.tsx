import { Outlet } from 'react-router-dom'
import { BottomNav, Header } from './Layout'
import { useSession } from '../context/useSession'
import { AccessPage } from '../pages/AccessPage'

export function AppShell() {
  const { phase } = useSession()

  if (phase === 'loading') {
    return (
      <div className="flex min-h-dvh items-center justify-center bg-canvas px-4">
        <p className="text-sm font-black tracking-[0.14em] text-ink uppercase">
          Chargement…
        </p>
      </div>
    )
  }

  if (
    phase === 'needs_code' ||
    phase === 'needs_player' ||
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
