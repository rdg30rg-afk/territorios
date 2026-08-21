import { Navigate, Outlet } from 'react-router-dom'
import { useAuth } from '../context/useAuth'
import type { ModuleDefinition } from '../data/modules'

export function ModuleGuard({
  moduleKey,
}: {
  moduleKey: ModuleDefinition['key']
}) {
  const { canAccessModule, profile } = useAuth()

  if (moduleKey === 'dashboard') {
    return <Outlet />
  }

  if (profile?.role === 'admin' || canAccessModule(moduleKey)) {
    return <Outlet />
  }

  return <Navigate to="/" replace />
}
