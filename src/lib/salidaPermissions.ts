type Profile = { access_status: string; role: string; driver_id: string | null } | null
export function canReportSalida(
  profile: Profile,
  _driverId: string | null | undefined,
  capability?: boolean,
) {
  return profile?.access_status === 'active' && Boolean(
    capability || profile.role === 'admin' || profile.driver_id,
  )
}

export function canMarkSalidaNotHeld(
  profile: Profile,
  driverId: string | null | undefined,
  adminCapability?: boolean,
) {
  if (profile?.access_status !== 'active') return false
  return Boolean(
    adminCapability ||
    profile.role === 'admin' ||
    (profile.driver_id && driverId && profile.driver_id === driverId),
  )
}
