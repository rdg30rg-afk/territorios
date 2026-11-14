import { useContext, useMemo } from 'react'
import { hasModuleAccess } from '../lib/access'
import { modoSimulacion, verComo } from '../lib/simulacion'
import { AuthContext, type AuthContextValue } from './AuthTypes'

export function useAuth(): AuthContextValue {
  const context = useContext(AuthContext)

  if (!context) {
    throw new Error('useAuth must be used within AuthProvider')
  }

  // En modo simulación la pantalla se arma con el personaje de la pestaña
  // (`?como=`). Fuera de ese modo se devuelve el contexto tal cual.
  // El perfil simulado conserva su identidad mientras no cambie el real: hay
  // efectos que dependen de `profile` y se reiniciarían en cada render.
  const vista = useMemo(
    () => (modoSimulacion ? verComo(context.profile, context.contexto) : null),
    [context.profile, context.contexto],
  )
  if (!vista) return context

  return {
    ...context,
    profile: vista.profile,
    contexto: vista.contexto,
    canAccessModule: (moduleKey) =>
      hasModuleAccess(vista.profile, context.moduleAccess, moduleKey, vista.contexto),
  }
}
