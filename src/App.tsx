import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom'
import { AppShell } from './components/AppShell'
import { SessionProvider } from './context/SessionProvider'
import { CalendarPage } from './pages/CalendarPage'
import { HomePage } from './pages/HomePage'
import { RankingPage } from './pages/RankingPage'
import { SettingsPage } from './pages/SettingsPage'

export default function App() {
  return (
    <SessionProvider>
      <BrowserRouter>
        <Routes>
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
