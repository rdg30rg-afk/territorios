import { Navigate, Outlet } from 'react-router-dom'
import { useAuth } from '../context/useAuth'
import type { ModuleDefinition } from '../data/modules'

export function ModuleGuard({
  moduleKey,
}: {
  moduleKey: ModuleDefinition['key']
}) {
  const { canAccessModule } = useAuth()

  if (moduleKey === 'dashboard') {
    return <Outlet />
  }

  if (canAccessModule(moduleKey)) {
    return <Outlet />
  }

  return <Navigate to="/predicacion" replace />
}
