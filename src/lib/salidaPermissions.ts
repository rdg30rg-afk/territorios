type Profile = { access_status: string; role: string; driver_id: string | null } | null
export function canReportSalida(
  profile: Profile,
  _driverId: string | null | undefined,
  capability?: boolean,
) {
  return profile?.access_status === 'active' && (capability ?? (profile.role === 'admin' || Boolean(profile.driver_id)))
}
