import { Navigate, Outlet, useLocation } from 'react-router-dom'
import { useSession } from '../lib/session'

/** Mock auth gate: no session → username prompt, then back to where they were going (e.g. an invite link). */
export function RequireSession() {
  const { session } = useSession()
  const loc = useLocation()
  if (!session) return <Navigate to={`/start?next=${encodeURIComponent(loc.pathname + loc.search)}`} replace />
  return <Outlet />
}
