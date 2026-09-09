/** Destinos explícitos; nunca convertir el centro de cámara en un encuentro. */

export type ModoLlegar = 'driving' | 'transit'

export type PuntoParaLlegar = {
  codigo: string | null
  nombre: string
  lat: number | null
  lng: number | null
}

const CIUDAD = 'San Juan, Argentina'

export function partirEsquina(nombre: string): { a: string; b: string } | null {
  const limpio = nombre.replace(/\s+/g, ' ').trim()
  const corte = limpio.match(/^(.*?)\s+y\s+(.*)$/i)
  if (!corte) return null
  const a = corte[1].trim()
  const b = corte[2].trim()
  return a && b ? { a, b } : null
}

export function textoDestino(lugar: string): string {
  const limpio = lugar.replace(/\s+/g, ' ').trim()
  if (!limpio) return ''
  return /san juan/i.test(limpio) ? limpio : `${limpio}, ${CIUDAD}`
}

function coordenadas(lat: number, lng: number): { lat: number; lng: number } | null {
  return Number.isFinite(lat) && Number.isFinite(lng) && Math.abs(lat) <= 90 && Math.abs(lng) <= 180
    ? { lat, lng }
    : null
}

const clave = (valor: string | null | undefined) =>
  (valor ?? '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/\s+/g, ' ').trim().toLowerCase()

/**
 * Recupera el GPS confirmado del catálogo. El código exacto tiene prioridad;
 * el nombre exacto normalizado cubre filas antiguas sin código. Nunca
 * geocodifica texto ni usa el centro del mapa como destino.
 */
export function coordenadasDePuntoCatalogado(
  salida: { codigo?: string | null; lugar?: string | null; lat?: number | null; lng?: number | null },
  puntos: PuntoParaLlegar[],
): { lat: number; lng: number } | null {
  if (salida.lat != null && salida.lng != null) return coordenadas(salida.lat, salida.lng)
  const codigo = clave(salida.codigo)
  const lugar = clave(salida.lugar)
  const punto = (codigo ? puntos.find((item) => clave(item.codigo) === codigo) : undefined)
    ?? (lugar ? puntos.find((item) => clave(item.nombre) === lugar) : undefined)
  return punto?.lat != null && punto.lng != null ? coordenadas(punto.lat, punto.lng) : null
}

/** Solo destinos numéricos explícitos; @lat,lng y ll son cámara, no un pin. */
export function coordsDeMapsUrl(
  url: string,
): { lat: number; lng: number } | null {
  let parsed: URL
  try { parsed = new URL(url) } catch { return null }
  if (parsed.protocol !== 'https:' || !['google.com', 'www.google.com', 'maps.google.com', 'google.com.ar', 'www.google.com.ar', 'maps.google.com.ar'].includes(parsed.hostname)) return null
  for (const key of ['destination', 'daddr', 'query', 'q']) {
    const value = parsed.searchParams.get(key)
    if (!value) continue
    const pair = value.match(/^\s*(-?\d+(?:\.\d+)?)\s*,\s*(-?\d+(?:\.\d+)?)\s*$/)
    return pair ? coordenadas(Number(pair[1]), Number(pair[2])) : null
  }
  return null
}

export function sePuedeLlegar(s: {
  tipo?: string | null
  lat?: number | null
  lng?: number | null
}): boolean {
  if (s.tipo === 'telefonica' || s.tipo === 'grupos') return false
  if (s.lat == null || s.lng == null) return false
  return Boolean(urlComoLlegar({ modo: 'driving', lat: s.lat, lng: s.lng }))
}

export function urlComoLlegar(opts: {
  modo: ModoLlegar
  lugar?: string
  lat?: number
  lng?: number
}): string | null {
  const punto = opts.lat != null && opts.lng != null ? coordenadas(opts.lat, opts.lng) : null
  if (!punto) return null
  const destino = `${punto.lat},${punto.lng}`
  const params = new URLSearchParams({
    api: '1',
    destination: destino,
    travelmode: opts.modo,
  })
  return `https://www.google.com/maps/dir/?${params.toString()}`
}
