import type { ModuleKey, Profile } from '../context/AuthTypes'

// El rol y los módulos nunca sustituyen la aprobación de la cuenta.
export function hasActiveAccess(profile: Pick<Profile, 'access_status'> | null) {
  return profile?.access_status === 'active'
}

export function hasModuleAccess(profile: Profile | null, modules: ModuleKey[], module: ModuleKey) {
  return hasActiveAccess(profile) && (profile?.role === 'admin' || modules.includes(module))
}

const routes: Record<string, ModuleKey> = {
  '/mapas': 'mapas', '/conductores': 'conductores', '/grupos': 'grupos',
  '/salidas': 'salidas', '/salidas-grupo': 'salidas_grupo',
  '/territorio-personal': 'territorio_personal',
}

export function accessLanding(profile: Profile | null, modules: ModuleKey[], requested?: string) {
  const fallback = hasActiveAccess(profile) && (profile?.role === 'admin' || modules.length > 0)
    ? '/' : '/predicacion'
  if (!requested || !hasActiveAccess(profile)) return fallback
  if (requested === '/predicacion') return requested
  if (requested === '/' || requested === '/importacion') {
    return requested === '/' ? fallback : profile?.role === 'admin' ? requested : fallback
  }
  return routes[requested] && hasModuleAccess(profile, modules, routes[requested]) ? requested : fallback
}
