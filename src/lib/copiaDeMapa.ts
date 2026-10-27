/**
 * Mapa sin señal, parte 2: la copia del territorio que queda en el teléfono.
 *
 * Qué se guarda: las manzanas, los lados y el último estado de cada lado tal
 * como los trajo Supabase, con la fecha. Las marcas que el hermano hizo sin
 * señal NO van acá: ya viven en la cola de `useCoverageOutbox`, y por eso el
 * mapa que se muestra desde la copia lleva su avance pendiente encima.
 *
 * Todo es texto (JSON) para que el mismo código sirva con IndexedDB y con
 * localStorage. Leer valida la forma: una copia rota o de otra cuenta se
 * descarta en vez de romper el dibujo.
 */

export const VERSION_COPIA = 1

export type CopiaDeMapa<M = unknown, L = unknown> = {
  version: typeof VERSION_COPIA
  userId: string
  territorioId: string
  territorioNombre: string
  guardadoEl: string
  manzanas: M[]
  lados: L[]
  estados: Record<string, string>
}

export type AsignacionesGuardadas<R = unknown, T = unknown> = {
  version: typeof VERSION_COPIA
  userId: string
  guardadoEl: string
  reservas: R[]
  territorios: T[]
}

const esObjeto = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v)

const esTexto = (v: unknown): v is string => typeof v === 'string' && v.length > 0

const esFechaISO = (v: unknown): v is string => typeof v === 'string' && !Number.isNaN(Date.parse(v))

function tieneCoordenadas(v: unknown) {
  return esObjeto(v) && Array.isArray(v.coordinates)
}

function esManzanaGuardada(v: unknown) {
  return esObjeto(v)
    && esTexto(v.id)
    && typeof v.label === 'string'
    && (v.geometry_geojson === null || tieneCoordenadas(v.geometry_geojson))
}

function esLadoGuardado(v: unknown) {
  return esObjeto(v)
    && esTexto(v.id)
    && esTexto(v.manzana_id)
    && typeof v.orden === 'number'
    && tieneCoordenadas(v.geometry_geojson)
}

export function serializarCopia(copia: CopiaDeMapa): string {
  return JSON.stringify(copia)
}

export function serializarAsignaciones(copia: AsignacionesGuardadas): string {
  return JSON.stringify(copia)
}

function parsear(texto: string | null): unknown {
  if (!texto) return null
  try { return JSON.parse(texto) } catch { return null }
}

/**
 * Devuelve la copia solo si es de esta cuenta y de este territorio y tiene
 * la forma esperada. Cualquier otra cosa es `null`.
 */
export function leerCopia<M = unknown, L = unknown>(
  texto: string | null,
  esperado: { userId: string; territorioId: string },
): CopiaDeMapa<M, L> | null {
  const dato = parsear(texto)
  if (!esObjeto(dato)) return null
  if (dato.version !== VERSION_COPIA) return null
  if (dato.userId !== esperado.userId || dato.territorioId !== esperado.territorioId) return null
  if (!esFechaISO(dato.guardadoEl) || typeof dato.territorioNombre !== 'string') return null
  if (!Array.isArray(dato.manzanas) || !dato.manzanas.every(esManzanaGuardada)) return null
  if (!Array.isArray(dato.lados) || !dato.lados.every(esLadoGuardado)) return null
  if (!esObjeto(dato.estados) || !Object.values(dato.estados).every((e) => typeof e === 'string')) return null
  return dato as unknown as CopiaDeMapa<M, L>
}

function esReservaGuardada(v: unknown) {
  return esObjeto(v) && esTexto(v.id) && esTexto(v.territory_id) && typeof v.status === 'string'
}

function esTerritorioGuardado(v: unknown) {
  return esObjeto(v) && esTexto(v.id) && typeof v.name === 'string'
}

export function leerAsignaciones<R = unknown, T = unknown>(
  texto: string | null,
  esperado: { userId: string },
): AsignacionesGuardadas<R, T> | null {
  const dato = parsear(texto)
  if (!esObjeto(dato)) return null
  if (dato.version !== VERSION_COPIA || dato.userId !== esperado.userId) return null
  if (!esFechaISO(dato.guardadoEl)) return null
  if (!Array.isArray(dato.reservas) || !dato.reservas.every(esReservaGuardada)) return null
  if (!Array.isArray(dato.territorios) || !dato.territorios.every(esTerritorioGuardado)) return null
  return dato as unknown as AsignacionesGuardadas<R, T>
}

// ------------------------------------------------------------ textos

const MESES = [
  'enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio',
  'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre',
]

/** "27 de octubre a las 14:05", en la hora del teléfono. */
export function formatearGuardadoEl(iso: string) {
  const f = new Date(iso)
  if (Number.isNaN(f.getTime())) return 'una fecha que no pudimos leer'
  const hh = String(f.getHours()).padStart(2, '0')
  const mm = String(f.getMinutes()).padStart(2, '0')
  return `${f.getDate()} de ${MESES[f.getMonth()]} a las ${hh}:${mm}`
}

export type CausaDeCopia = 'red' | 'otra'

/**
 * ¿La consulta falló por falta de señal? `navigator.onLine` solo sabe si hay
 * una interfaz de red, no si hay internet: con una barra de señal puede decir
 * "en línea" y la consulta igual se corta. Por eso también se mira el mensaje.
 */
export function pareceFaltaDeRed(falla: unknown, enLinea: boolean) {
  if (!enLinea) return true
  const mensaje = falla instanceof Error
    ? falla.message
    : esObjeto(falla) && typeof falla.message === 'string' ? falla.message : String(falla ?? '')
  return /failed to fetch|networkerror|network request failed|load failed|fetch failed|timeout|timed out|tardó demasiado|abort/i
    .test(mensaje)
}

/** El aviso de arriba del mapa cuando se muestra la copia y no lo de la base. */
export function mensajeDeCopia(guardadoEl: string, causa: CausaDeCopia) {
  const cuando = formatearGuardadoEl(guardadoEl)
  return causa === 'red'
    ? `Sin señal · mostrando lo guardado el ${cuando}`
    : `No pudimos actualizar · mostrando lo guardado el ${cuando}`
}
