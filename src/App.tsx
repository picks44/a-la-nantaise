import { lazy, Suspense } from 'react'
import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom'
import { AppShell } from './components/AppShell'
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
        <Routes>
          <Route
            path="admin"
            element={
              <Suspense
                fallback={
                  <div className="flex min-h-dvh items-center justify-center bg-canvas px-4">
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
