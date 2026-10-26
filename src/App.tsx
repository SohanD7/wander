import { BrowserRouter, MemoryRouter, Navigate, Route, Routes } from 'react-router-dom'
import { ARTIFACT } from './lib/env'
import { TripLayout } from './components/trip/TripLayout'
import { AuthPage } from './features/auth/AuthPage'
import { Budget } from './features/budget/Budget'
import { Landing } from './features/landing/Landing'
import { Onboarding } from './features/onboarding/Onboarding'
import { Plan } from './features/plan/Plan'
import { TripSpace } from './features/space/TripSpace'
import { MyTrips } from './features/trips/MyTrips'
import { SessionProvider } from './lib/session'
import { RequireSession } from './routes/Guard'

// The hosted preview can't use real URLs, so it routes in memory.
const Router = ARTIFACT ? MemoryRouter : BrowserRouter

export default function App() {
  return (
    <SessionProvider>
      <Router>
        <Routes>
          <Route path="/" element={<Landing />} />
          <Route path="/start" element={<AuthPage />} />
          <Route element={<RequireSession />}>
            <Route path="/onboarding" element={<Onboarding />} />
            <Route path="/trips" element={<MyTrips />} />
            {/* Invite links are just /t/<id>: open one in a new tab, enter a name, and you're in the room. */}
            <Route path="/t/:tripId" element={<TripLayout />}>
              <Route index element={<TripSpace />} />
              <Route path="plan" element={<Plan />} />
              <Route path="budget" element={<Budget />} />
            </Route>
          </Route>
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </Router>
    </SessionProvider>
  )
}
