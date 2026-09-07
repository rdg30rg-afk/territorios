type Profile = { access_status: string; role: string; driver_id: string | null } | null
export function canReportSalida(profile: Profile, driverId: string | null | undefined) {
  return profile?.access_status === 'active' && (profile.role === 'admin'
    || Boolean(profile.driver_id && driverId && profile.driver_id === driverId))
}
