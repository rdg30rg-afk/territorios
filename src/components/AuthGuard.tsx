import { Navigate, Outlet, useLocation } from 'react-router-dom'
import { useAuth } from '../context/useAuth'

export function AuthGuard() {
  const { isConfigured, isLoading, isAuthenticated } = useAuth()
  const location = useLocation()

  if (!isConfigured) {
    return <Navigate to="/login" replace state={{ from: location }} />
  }

  if (isLoading) {
    return <div className="status-card">Cargando sesion segura...</div>
  }

  if (!isAuthenticated) {
    return <Navigate to="/login" replace state={{ from: location }} />
  }

  return <Outlet />
}
