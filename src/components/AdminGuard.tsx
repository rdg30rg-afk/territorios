import { Navigate, Outlet, useLocation } from 'react-router-dom'
import { useAuth } from '../context/useAuth'
import { canOpenAdminPanel } from '../lib/access'

/**
 * El shell administrativo es una frontera de navegación, no sólo una lista
 * de enlaces. Los módulos históricos nunca pueden habilitarlo por sí solos.
 */
export function AdminGuard() {
  const { profile, contexto } = useAuth()
  const location = useLocation()

  if (canOpenAdminPanel(profile, contexto)) {
    return <Outlet />
  }

  return <Navigate to="/predicacion" replace state={{ from: location }} />
}
