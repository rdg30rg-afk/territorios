export function confirmationRedirectUrl(origin: string): string {
  const url = new URL('/login', origin)
  url.searchParams.set('confirmado', '1')
  return url.toString()
}
