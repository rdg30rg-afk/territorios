/**
 * Mapa sin señal, parte 1: qué teselas guardar y cómo traerlas.
 *
 * Todo lo de acá es lógica pura (nada de `import.meta`, React ni el DOM) para
 * poder probarla en Node. La plantilla de URL la arma `fondoMapa.ts`; este
 * archivo la recibe como parámetro.
 *
 * Cómo se guarda: el hermano hace `fetch` de cada URL y el service worker
 * (caché CacheFirst `teselas-mapa`) se queda con la respuesta. Después, el
 * mismo Leaflet pide esas URLs y salen de la caché sin red. Por eso las URLs
 * se arman EXACTAMENTE como las arma Leaflet: mismo `{s}`, mismo `{r}`.
 */

import type { IconoNombre } from './iconos.ts'

export type Recuadro = { sur: number; oeste: number; norte: number; este: number }
export type Tesela = { z: number; x: number; y: number }

/** Nombre de la caché del service worker. Lo acordó la otra tarea: no cambiarlo. */
export const NOMBRE_CACHE_TESELAS = 'teselas-mapa'

export const ZOOM_PRECARGA_MIN = 15
export const ZOOM_PRECARGA_MAX = 18
/** Unas 400 teselas: con pantalla retina son varios megas, por eso hay tope y se respeta el ahorro de datos. */
export const TOPE_TESELAS = 400
/**
 * Sin clave de MapTiler el fondo es openstreetmap.org, cuya política de uso
 * desaconseja las descargas en bloque. Se guarda menos.
 */
export const TOPE_TESELAS_OSM = 120
/** Cuánto se agranda el recuadro del territorio, en fracción de su tamaño. */
export const MARGEN_DEL_RECUADRO = 0.1
const VIGENCIA_PRECARGA_MS = 7 * 24 * 60 * 60 * 1000
const LATITUD_MAXIMA = 85.0511287798
// Un territorio no mide menos de esto (unos 110 m). Evita un recuadro de cero.
const LADO_MINIMO_GRADOS = 0.001
const SUBDOMINIOS = 'abc'

const limitar = (n: number, min: number, max: number) => Math.min(max, Math.max(min, n))

export function xDeTesela(lng: number, z: number) {
  const n = 2 ** z
  return limitar(Math.floor(((lng + 180) / 360) * n), 0, n - 1)
}

export function yDeTesela(lat: number, z: number) {
  const n = 2 ** z
  const rad = (limitar(lat, -LATITUD_MAXIMA, LATITUD_MAXIMA) * Math.PI) / 180
  const y = (1 - Math.log(Math.tan(rad) + 1 / Math.cos(rad)) / Math.PI) / 2
  return limitar(Math.floor(y * n), 0, n - 1)
}

/** Recuadro que contiene los puntos `[lat, lng]`, agrandado por `margen`. */
export function recuadroDePuntos(
  puntos: ReadonlyArray<readonly [number, number]>,
  margen = MARGEN_DEL_RECUADRO,
): Recuadro | null {
  let sur = Infinity
  let norte = -Infinity
  let oeste = Infinity
  let este = -Infinity
  for (const [lat, lng] of puntos) {
    if (!Number.isFinite(lat) || !Number.isFinite(lng) || Math.abs(lat) > 90 || Math.abs(lng) > 180) continue
    if (lat < sur) sur = lat
    if (lat > norte) norte = lat
    if (lng < oeste) oeste = lng
    if (lng > este) este = lng
  }
  if (!Number.isFinite(sur)) return null
  const alto = Math.max(norte - sur, LADO_MINIMO_GRADOS)
  const ancho = Math.max(este - oeste, LADO_MINIMO_GRADOS)
  const cLat = (norte + sur) / 2
  const cLng = (este + oeste) / 2
  return {
    sur: limitar(cLat - (alto / 2) * (1 + 2 * margen), -90, 90),
    norte: limitar(cLat + (alto / 2) * (1 + 2 * margen), -90, 90),
    oeste: limitar(cLng - (ancho / 2) * (1 + 2 * margen), -180, 180),
    este: limitar(cLng + (ancho / 2) * (1 + 2 * margen), -180, 180),
  }
}

type ManzanaConForma = { geometry_geojson: { coordinates: number[][][] } | null }

/** El recuadro de las manzanas dibujadas. GeoJSON viene como `[lng, lat]`. */
export function recuadroDeManzanas(
  manzanas: ReadonlyArray<ManzanaConForma>,
  margen = MARGEN_DEL_RECUADRO,
): Recuadro | null {
  const puntos: Array<[number, number]> = []
  for (const mz of manzanas) {
    const anillo = mz.geometry_geojson?.coordinates?.[0]
    if (!Array.isArray(anillo)) continue
    for (const par of anillo) {
      if (Array.isArray(par) && par.length >= 2) puntos.push([par[1], par[0]])
    }
  }
  return recuadroDePuntos(puntos, margen)
}

type Rango = { x0: number; x1: number; y0: number; y1: number }

function rangoDelNivel(r: Recuadro, z: number): Rango {
  // El norte tiene la "y" más chica.
  return {
    x0: xDeTesela(Math.min(r.oeste, r.este), z),
    x1: xDeTesela(Math.max(r.oeste, r.este), z),
    y0: yDeTesela(Math.max(r.norte, r.sur), z),
    y1: yDeTesela(Math.min(r.norte, r.sur), z),
  }
}

const cuenta = (g: Rango) => (g.x1 - g.x0 + 1) * (g.y1 - g.y0 + 1)

/** Cuántas teselas cubren el recuadro en un zoom. No las arma. */
export function contarTeselas(r: Recuadro, z: number) {
  return cuenta(rangoDelNivel(r, z))
}

/** Todas las teselas de un zoom, fila por fila. */
export function teselasDelRecuadro(r: Recuadro, z: number): Tesela[] {
  const g = rangoDelNivel(r, z)
  const lista: Tesela[] = []
  for (let y = g.y0; y <= g.y1; y++) for (let x = g.x0; x <= g.x1; x++) lista.push({ z, x, y })
  return lista
}

// Cuando un zoom no entra entero, se toman las más cercanas al centro del
// territorio, en anillos. Así un recuadro enorme tampoco arma miles de
// teselas para después tirarlas.
function masCercanasAlCentro(z: number, g: Rango, cuantas: number): Tesela[] {
  const cx = Math.floor((g.x0 + g.x1) / 2)
  const cy = Math.floor((g.y0 + g.y1) / 2)
  const hasta = Math.max(g.x1 - g.x0, g.y1 - g.y0)
  const lista: Tesela[] = []
  for (let k = 0; k <= hasta && lista.length < cuantas; k++) {
    for (let dy = -k; dy <= k; dy++) {
      for (let dx = -k; dx <= k; dx++) {
        if (Math.max(Math.abs(dx), Math.abs(dy)) !== k) continue
        const x = cx + dx
        const y = cy + dy
        if (x < g.x0 || x > g.x1 || y < g.y0 || y > g.y1) continue
        lista.push({ z, x, y })
        if (lista.length >= cuantas) return lista
      }
    }
  }
  return lista
}

export type PlanDeTeselas = {
  teselas: Tesela[]
  /** Cuántas habría sin tope. */
  totalSinTope: number
  recortado: boolean
  porZoom: Array<{ z: number; total: number; incluidas: number }>
}

/**
 * Qué teselas guardar. Los zooms bajos van primero y completos: con el mapa
 * de la zona alcanza para ubicarse, y el detalle se suma mientras haya lugar.
 */
export function planificarTeselas(
  recuadro: Recuadro,
  opciones: { zoomMin?: number; zoomMax?: number; tope?: number } = {},
): PlanDeTeselas {
  const zoomMin = opciones.zoomMin ?? ZOOM_PRECARGA_MIN
  const zoomMax = opciones.zoomMax ?? ZOOM_PRECARGA_MAX
  const tope = Math.max(0, Math.floor(opciones.tope ?? TOPE_TESELAS))
  const teselas: Tesela[] = []
  const porZoom: PlanDeTeselas['porZoom'] = []
  let totalSinTope = 0
  for (let z = zoomMin; z <= zoomMax; z++) {
    const g = rangoDelNivel(recuadro, z)
    const total = cuenta(g)
    totalSinTope += total
    const lugar = tope - teselas.length
    let incluidas: Tesela[] = []
    if (lugar > 0) {
      incluidas = total <= lugar ? teselasDelRecuadro(recuadro, z) : masCercanasAlCentro(z, g, lugar)
    }
    teselas.push(...incluidas)
    porZoom.push({ z, total, incluidas: incluidas.length })
  }
  return { teselas, totalSinTope, recortado: teselas.length < totalSinTope, porZoom }
}

/**
 * La URL de una tesela, igual que `L.TileLayer#getTileUrl`: el subdominio sale
 * de `|x + y|` módulo 3 y `{r}` es `@2x` solo en pantallas retina.
 */
export function urlDeTesela(plantilla: string, t: Tesela, opciones: { retina?: boolean } = {}) {
  const sub = SUBDOMINIOS[Math.abs(t.x + t.y) % SUBDOMINIOS.length]
  return plantilla
    .replaceAll('{s}', sub)
    .replaceAll('{z}', String(t.z))
    .replaceAll('{x}', String(t.x))
    .replaceAll('{y}', String(t.y))
    .replaceAll('{r}', opciones.retina ? '@2x' : '')
}

/** Identifica "este recuadro, estos zooms, este fondo": si no cambia, no se vuelve a bajar. */
export function clavePrecarga(datos: {
  territorioId: string
  recuadro: Recuadro
  zoomMin: number
  zoomMax: number
  tope: number
  retina: boolean
  proveedor: string
}) {
  const r = datos.recuadro
  const redondo = (n: number) => n.toFixed(4)
  return [
    datos.territorioId, datos.proveedor, datos.retina ? 'r2' : 'r1',
    `z${datos.zoomMin}-${datos.zoomMax}`, `t${datos.tope}`,
    [r.sur, r.oeste, r.norte, r.este].map(redondo).join(','),
  ].join('|')
}

// ------------------------------------------------------------ descarga

export type Traer = (url: string, senal?: AbortSignal) => Promise<{ ok: boolean }>

export type ResultadoPrecarga = {
  total: number
  ok: number
  falladas: number
  sinIntentar: number
  cancelada: boolean
  /** Se cortó antes de terminar porque fallaban una tras otra (sin red, clave vencida). */
  cortada: boolean
}

/**
 * Trae las URLs de a pocas a la vez. Si fallan muchas seguidas se corta: no
 * tiene sentido pedir 400 teselas a una clave vencida o a un teléfono sin red.
 */
export async function precargarUrls(
  urls: readonly string[],
  opciones: {
    traer: Traer
    concurrencia?: number
    maxFallasSeguidas?: number
    senal?: AbortSignal
    alProgreso?: (hechas: number, total: number) => void
  },
): Promise<ResultadoPrecarga> {
  const { traer, senal, alProgreso } = opciones
  const total = urls.length
  const maxSeguidas = opciones.maxFallasSeguidas ?? 12
  let siguiente = 0
  let ok = 0
  let falladas = 0
  let seguidas = 0
  let cortada = false

  const trabajador = async () => {
    while (!senal?.aborted && !cortada) {
      const i = siguiente++
      if (i >= total) return
      try {
        const respuesta = await traer(urls[i], senal)
        if (respuesta.ok) { ok++; seguidas = 0 } else { falladas++; seguidas++ }
      } catch {
        if (senal?.aborted) return
        falladas++
        seguidas++
      }
      if (seguidas >= maxSeguidas) cortada = true
      alProgreso?.(ok + falladas, total)
    }
  }
  await Promise.all(
    Array.from({ length: Math.min(Math.max(1, opciones.concurrencia ?? 6), Math.max(total, 1)) }, trabajador),
  )
  return { total, ok, falladas, sinIntentar: total - ok - falladas, cancelada: Boolean(senal?.aborted), cortada }
}

/** Se acepta que falte alguna tesela suelta; más que eso, el mapa quedó con agujeros. */
export function esPrecargaCompleta(r: ResultadoPrecarga, umbral = 0.05) {
  return !r.cancelada && !r.cortada && r.total > 0 && r.sinIntentar === 0 && r.falladas / r.total <= umbral
}

// ------------------------------------------------------------ orquestación

export type EstadoPrecarga =
  | { fase: 'inactiva' }
  | { fase: 'guardando'; hechas: number; total: number }
  | { fase: 'lista' }
  | { fase: 'incompleta'; motivo: 'fallas' | 'sin-cache' }
  | { fase: 'ahorro-de-datos' }

export type RegistroPrecarga = { clave: string; terminadoEl: string }

/** Tres teselas repartidas por la lista: alcanzan para saber si la caché las tiene. */
export function muestraDeUrls(urls: readonly string[]) {
  if (!urls.length) return []
  return [...new Set([urls[0], urls[Math.floor(urls.length / 2)], urls[urls.length - 1]])]
}

export type DependenciasDePrecarga = {
  traer: Traer
  estaEnCache: (url: string) => Promise<boolean>
  leerRegistro: () => Promise<RegistroPrecarga | null>
  guardarRegistro: (registro: RegistroPrecarga) => Promise<void>
  esperar?: (ms: number) => Promise<void>
  ahora?: () => number
}

/**
 * Corre la precarga completa y devuelve cómo terminó. "Lista" solo se dice si
 * las teselas están de verdad en la caché del service worker.
 */
export async function ejecutarPrecarga(args: {
  urls: readonly string[]
  clave: string
  enLinea: boolean
  ahorroDeDatos: boolean
  forzar?: boolean
  senal?: AbortSignal
  alEstado: (estado: EstadoPrecarga) => void
  concurrencia?: number
  deps: DependenciasDePrecarga
}): Promise<EstadoPrecarga> {
  const { urls, clave, deps, senal } = args
  const esperar = deps.esperar ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)))
  const ahora = deps.ahora ?? Date.now
  const emitir = (estado: EstadoPrecarga) => { args.alEstado(estado); return estado }
  if (!urls.length || !args.enLinea) return emitir({ fase: 'inactiva' })

  const muestra = muestraDeUrls(urls)
  if (!args.forzar) {
    const registro = await deps.leerRegistro()
    const vigente = registro?.clave === clave && ahora() - Date.parse(registro.terminadoEl) < VIGENCIA_PRECARGA_MS
    if (vigente) {
      const presentes = await Promise.all(muestra.map((u) => deps.estaEnCache(u)))
      if (presentes.every(Boolean)) return emitir({ fase: 'lista' })
    }
  }
  if (args.ahorroDeDatos && !args.forzar) return emitir({ fase: 'ahorro-de-datos' })

  emitir({ fase: 'guardando', hechas: 0, total: urls.length })
  const resultado = await precargarUrls(urls, {
    traer: deps.traer,
    senal,
    concurrencia: args.concurrencia,
    alProgreso: (hechas, total) => args.alEstado({ fase: 'guardando', hechas, total }),
  })
  if (resultado.cancelada) return { fase: 'inactiva' }

  // El service worker guarda la respuesta un instante después de entregarla.
  await esperar(400)
  const presentes = await Promise.all(muestra.map((u) => deps.estaEnCache(u)))
  if (!presentes.some(Boolean)) return emitir({ fase: 'incompleta', motivo: 'sin-cache' })
  if (!esPrecargaCompleta(resultado)) return emitir({ fase: 'incompleta', motivo: 'fallas' })
  await deps.guardarRegistro({ clave, terminadoEl: new Date(ahora()).toISOString() })
  return emitir({ fase: 'lista' })
}

// ------------------------------------------------------------ textos

export type VistaPrecarga = {
  texto: string
  icono: IconoNombre
  /** Botón para actuar (siempre con icono y palabra). */
  accion?: { etiqueta: string; icono: IconoNombre }
}

/**
 * Lo que se le dice al hermano de cada estado. Cada uno lleva su icono y sus
 * palabras: el color de la tarjeta acompaña, no informa solo.
 */
export function describirPrecarga(estado: EstadoPrecarga): VistaPrecarga | null {
  switch (estado.fase) {
    case 'inactiva':
      return null
    case 'guardando':
      return {
        texto: `Guardando el mapa para usar sin señal · ${estado.hechas} de ${estado.total}`,
        icono: 'descargar',
      }
    case 'lista':
      return { texto: 'Listo para usar sin señal', icono: 'completo' }
    case 'incompleta':
      return {
        texto: 'No se pudo guardar todo el mapa para usar sin señal',
        icono: 'error',
        accion: { etiqueta: 'Reintentar', icono: 'rehacer' },
      }
    case 'ahorro-de-datos':
      return {
        texto: 'Ahorro de datos activado: no guardamos el mapa para usar sin señal',
        icono: 'pendiente',
        accion: { etiqueta: 'Guardarlo igual', icono: 'descargar' },
      }
  }
}
