import type { AccessContext, ModuleKey, Profile, SystemRole } from '../context/AuthTypes'

// El rol y los módulos nunca sustituyen la aprobación de la cuenta.
export function hasActiveAccess(profile: Pick<Profile, 'access_status'> | null) {
  return profile?.access_status === 'active'
}

export function isSystemRole(value: unknown): value is SystemRole {
  return value === 'miembro' || value === 'admin_territorios' || value === 'superadmin'
}

/**
 * Resuelve el nivel efectivo durante la transición de `role` a `system_role`.
 * Un valor explícito, incluso `miembro`, siempre gana al rol histórico.
 */
export function effectiveSystemRole(
  profile: Pick<Profile, 'role' | 'system_role'> | null,
): SystemRole {
  if (isSystemRole(profile?.system_role)) return profile.system_role
  if (profile?.system_role !== null && profile?.system_role !== undefined) {
    return 'miembro'
  }
  return profile?.role === 'admin' ? 'admin_territorios' : 'miembro'
}

export function isAdministrativeProfile(profile: Profile | null) {
  const role = effectiveSystemRole(profile)
  return role === 'admin_territorios' || role === 'superadmin'
}

export function canOpenAdminPanel(
  profile: Profile | null,
  contexto?: Pick<AccessContext, 'puede_abrir_panel'> | null,
) {
  if (!hasActiveAccess(profile)) return false
  if (typeof contexto?.puede_abrir_panel === 'boolean') {
    return contexto.puede_abrir_panel
  }
  return isAdministrativeProfile(profile)
}

export function canManageAdministrators(
  profile: Profile | null,
  contexto?: Pick<AccessContext, 'puede_administrar_admins' | 'puede_abrir_panel'> | null,
) {
  if (!canOpenAdminPanel(profile, contexto)) return false
  if (typeof contexto?.puede_administrar_admins === 'boolean') {
    return contexto.puede_administrar_admins
  }
  return effectiveSystemRole(profile) === 'superadmin'
}

export function hasModuleAccess(
  profile: Profile | null,
  modules: ModuleKey[],
  module: ModuleKey,
  contexto?: Pick<AccessContext, 'puede_abrir_panel'> | null,
) {
  // `modules` se conserva sólo para compatibilidad con callers antiguos. La
  // ACL histórica no es una frontera de seguridad y no concede panel a un
  // miembro, aunque tenga filas asignadas.
  void modules
  void module
  return canOpenAdminPanel(profile, contexto)
}

const routes: Record<string, ModuleKey> = {
  '/mapas': 'mapas', '/conductores': 'conductores', '/grupos': 'grupos',
  '/salidas': 'salidas', '/salidas-grupo': 'salidas_grupo',
  '/territorio-personal': 'territorio_personal',
}

export function accessLanding(profile: Profile | null, _modules: ModuleKey[], requested?: string) {
  const fallback = canOpenAdminPanel(profile) ? '/' : '/predicacion'
  if (!requested || !hasActiveAccess(profile)) return fallback
  if (requested === '/predicacion') return requested
  if (requested === '/' || requested === '/importacion') {
    return canOpenAdminPanel(profile) ? requested : fallback
  }
  return routes[requested] && canOpenAdminPanel(profile) ? requested : fallback
}
