const CANONICAL_APP_ORIGIN = 'https://congregacion.estracom.com.ar'
const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]'])

/**
 * Keeps confirmation links on the real Territorios site. A user can open the
 * app through a preview, an old Hostinger alias, or an HTTP variant; those
 * origins must not become the destination embedded in a signup email.
 */
export function confirmationOrigin(origin: string): string {
  try {
    const parsed = new URL(origin)
    if (parsed.hostname === 'congregacion.estracom.com.ar') {
      return CANONICAL_APP_ORIGIN
    }
    if (LOCAL_HOSTS.has(parsed.hostname) && (parsed.protocol === 'http:' || parsed.protocol === 'https:')) {
      return parsed.origin
    }
  } catch {
    // Fall through to the canonical production origin for malformed input.
  }
  return CANONICAL_APP_ORIGIN
}

export function confirmationRedirectUrl(origin: string): string {
  const url = new URL('/login', confirmationOrigin(origin))
  url.searchParams.set('confirmado', '1')
  return url.toString()
}
