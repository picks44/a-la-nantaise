import { lazy, Suspense } from 'react'
import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom'
import { AppShell } from './components/AppShell'
import { BrandMark } from './components/BrandMark'
import { PwaOfflineBanner } from './components/PwaOfflineBanner'
import { PwaUpdateBanner } from './components/PwaUpdateBanner'
import { SessionProvider } from './context/SessionProvider'
import { CalendarPage } from './pages/CalendarPage'
import { HomePage } from './pages/HomePage'
import { RankingPage } from './pages/RankingPage'
import { SettingsPage } from './pages/SettingsPage'

const AdminPage = lazy(async () => {
  const module = await import('./pages/AdminPage')
  return { default: module.AdminPage }
})

export default function App() {
  return (
    <SessionProvider>
      <BrowserRouter>
        <PwaUpdateBanner />
        <PwaOfflineBanner />
        <Routes>
          <Route
            path="admin"
            element={
              <Suspense
                fallback={
                  <div className="flex min-h-dvh flex-col items-center justify-center gap-4 bg-canvas px-4">
                    <BrandMark
                      size="lg"
                      decorative={false}
                      className="rounded-[var(--radius-md)]"
                    />
                    <p className="text-sm font-black tracking-[0.14em] text-ink uppercase">
                      Chargement…
                    </p>
                  </div>
                }
              >
                <AdminPage />
              </Suspense>
            }
          />
          <Route element={<AppShell />}>
            <Route index element={<HomePage />} />
            <Route path="calendrier" element={<CalendarPage />} />
            <Route path="classement" element={<RankingPage />} />
            <Route path="parametres" element={<SettingsPage />} />
            <Route path="*" element={<Navigate to="/" replace />} />
          </Route>
        </Routes>
      </BrowserRouter>
    </SessionProvider>
  )
}
