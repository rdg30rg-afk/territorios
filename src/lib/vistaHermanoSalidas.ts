/**
 * Lógica pura de la vista del hermano (Predicación): tamaños de letra, textos
 * de las tarjetas y qué salidas le quedaron sin informar al conductor.
 * Vive aparte de la página para poder probarla sin navegador ni React.
 */

// ------------------------------------------------------------ tamaño del texto
export type NombreTamanio = 'normal' | 'grande' | 'muy-grande'

/** Tres tamaños: lo normal, lo grande y lo muy grande. */
export const TAMANIOS_TEXTO = [1, 1.25, 1.5] as const

/** Lo guardado en el teléfono, llevado al tamaño más cercano (también lo de versiones viejas: 1,15 y 1,3). */
export function tamanioGuardado(crudo: string | null | undefined): number {
  const n = Number(crudo)
  if (!Number.isFinite(n) || n < 1) return 1
  if (n < 1.12) return 1
  if (n < 1.38) return 1.25
  return 1.5
}

export function siguienteTamanio(paso: number): number {
  if (paso >= 1.5) return 1
  if (paso >= 1.25) return 1.5
  return 1.25
}

export function nombreDeTamanio(paso: number): NombreTamanio {
  return paso >= 1.5 ? 'muy-grande' : paso >= 1.25 ? 'grande' : 'normal'
}

/** El botón dice siempre lo mismo («Letra») y, abajo, cómo está ahora. */
export function botonDeTamanio(paso: number): { texto: string; nivel: string; etiqueta: string } {
  const nombre = nombreDeTamanio(paso)
  if (nombre === 'normal') return { texto: 'Letra', nivel: 'Normal', etiqueta: 'Tamaño de la letra: normal. Tocá para agrandarla' }
  if (nombre === 'grande') return { texto: 'Letra', nivel: 'Grande', etiqueta: 'Tamaño de la letra: grande. Tocá para agrandarla más' }
  return { texto: 'Letra', nivel: 'Muy grande', etiqueta: 'Tamaño de la letra: muy grande. Tocá para volver al normal' }
}

// ---------------------------------------------------------------------- fechas
const DIAS_CORTOS = ['domingo', 'lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado']
const MESES_CORTOS = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic']

/** «viernes 13 de nov» a partir de «2026-11-13». Si no es una fecha, la devuelve igual. */
export function fechaConDiaCorta(iso: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso)
  if (!m) return iso
  const f = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]))
  if (Number.isNaN(f.getTime())) return iso
  return `${DIAS_CORTOS[f.getDay()]} ${f.getDate()} de ${MESES_CORTOS[f.getMonth()]}`
}

// ---------------------------------------------------------------------- horas
const dos = (n: number) => String(n).padStart(2, '0')

/** Hora en formato de 24 h («22:25»), sin a. m. / p. m. */
export function hora24(valor: string | number | Date, conSegundos = false): string {
  const fecha = valor instanceof Date ? valor : new Date(valor)
  if (Number.isNaN(fecha.getTime())) return ''
  const base = `${dos(fecha.getHours())}:${dos(fecha.getMinutes())}`
  return conSegundos ? `${base}:${dos(fecha.getSeconds())}` : base
}

// --------------------------------------------------------------------- textos
/** «Te falta 1 manzana» / «Te faltan 3 manzanas». */
export function textoFaltan(n: number): string {
  return n === 1 ? 'Te falta 1 manzana' : `Te faltan ${n} manzanas`
}

/** El rótulo de la cifra grande: «Te falta» / «Te faltan». */
export function rotuloFaltan(n: number): string {
  return n === 1 ? 'Te falta' : 'Te faltan'
}

/** «La salida de hoy» solo si es de hoy; una de mañana o de otro día no se llama de hoy. */
export function rotuloDeLaSalida(fecha: string, hoy: string, manana: string): string {
  if (fecha === hoy) return 'La salida de hoy'
  if (fecha === manana) return 'La salida de mañana'
  return 'La próxima salida'
}

type ConTipo = { tipo?: string }

/**
 * Lo que dice el resumen cuando hoy solo hay salidas con tipo (ninguna común).
 * Antes decía siempre «Hoy es predicación telefónica», también cuando eran de grupos.
 */
export function resumenDeSoloTipos(deHoy: readonly ConTipo[]): string {
  const hay = (t: string) => deHoy.some((s) => s.tipo === t)
  const partes: string[] = []
  if (hay('telefonica')) partes.push('predicación telefónica')
  if (hay('grupos')) partes.push('salidas de grupos')
  if (hay('asamblea') || hay('especial')) partes.push('una actividad especial')
  if (!partes.length) return 'Hoy no hay salida común.'
  if (partes.length === 1 && partes[0] === 'predicación telefónica') return 'Hoy es predicación telefónica.'
  return `Hoy hay ${partes.join(' y ')}.`
}

/** «Mañana · 09:30» o «sábado 14 de noviembre · 09:30»: la hora sola no dice qué día. */
export function cuandoDeLaSalida(diaTexto: string, hora: string): string {
  return hora ? `${diaTexto} · ${hora}` : diaTexto
}

// ----------------------------------------------------------- salidas del conductor
type SalidaMinima = { id?: string; driverId?: string; fecha: string; hora?: string; tipo?: string }

/** Cuántos días para atrás se buscan salidas que quedaron sin informar. */
export const DIAS_PARA_INFORMAR = 7

/** Medianoche de hace `dias` días. */
export function desdeHaceDias(base: Date, dias: number): Date {
  const d = new Date(base)
  d.setHours(0, 0, 0, 0)
  d.setDate(d.getDate() - dias)
  return d
}

/**
 * Salidas pasadas que le tocaron a este conductor y todavía no tienen informe.
 * `informadas` son los ids con resultado. Las más recientes primero.
 */
export function salidasSinInformar<T extends SalidaMinima>(
  pasadas: readonly T[],
  informadas: ReadonlySet<string>,
  driverId: string | null | undefined,
  hoy: string,
): T[] {
  if (!driverId) return []
  return pasadas
    .filter((s) => s.id && s.driverId === driverId && s.fecha < hoy && !informadas.has(s.id))
    .sort((a, b) => (b.fecha + (b.hora ?? '')).localeCompare(a.fecha + (a.hora ?? '')))
}

export type ResultadoDeSalida = { salida_id: string; estado: string; informado_por: string | null }

const ESTADO_INFORMADO: Record<string, string> = {
  realizada: 'Informada',
  parcial: 'Informada (a medias)',
  no_realizada: 'Se informó que no se hizo',
  cancelada: 'Se informó que se canceló',
}

/** «Informada por Marta» / «Todavía sin informar». `null` si no se sabe (no se pudo leer). */
export function estadoDeInforme(
  salidaId: string | undefined,
  resultados: ReadonlyMap<string, ResultadoDeSalida>,
  nombres: Readonly<Record<string, string>>,
  seSabe: boolean,
): { informada: boolean; texto: string } | null {
  if (!salidaId || !seSabe) return null
  const r = resultados.get(salidaId)
  if (!r || r.estado === 'sin_dato') return { informada: false, texto: 'Todavía sin informar' }
  const base = ESTADO_INFORMADO[r.estado] ?? 'Informada'
  const quien = r.informado_por ? nombres[r.informado_por] : undefined
  return { informada: true, texto: quien ? `${base} por ${quien}` : base }
}

/** «Conducís vos» si la salida es del conductor que mira; si no, quién conduce. */
export function quienConduce(
  salida: { driverId?: string; conductor?: string },
  miDriverId: string | null | undefined,
): { esMia: boolean; texto: string | null } {
  if (miDriverId && salida.driverId === miDriverId) return { esMia: true, texto: 'Conducís vos' }
  return { esMia: false, texto: salida.conductor ? `Conduce ${salida.conductor}` : null }
}

// ---------------------------------------------------------- pedido no aprobado
type ReservaMinima = { id: string; territory_id: string; status: string; assigned_to?: string | null }

/**
 * El aviso «Tu pedido del territorio N no fue aprobado» se muestra hasta que
 * se cierra, y desaparece solo si la persona ya tiene otro territorio.
 */
export function avisosDeRechazo<R extends ReservaMinima>(
  reservas: readonly R[],
  miId: string | undefined,
  cerrados: ReadonlySet<string>,
): R[] {
  const tieneOtro = reservas.some((r) => r.status === 'activa' && r.assigned_to === miId)
  if (tieneOtro) return []
  return reservas.filter((r) => r.status === 'rechazada' && !cerrados.has(r.id))
}

type Almacen = Pick<Storage, 'getItem' | 'setItem'>
const clave = (userId: string) => `vh-rechazos-cerrados:v1:${userId}`

export function leerRechazosCerrados(almacen: Almacen | null | undefined, userId: string | undefined): Set<string> {
  if (!almacen || !userId) return new Set()
  try {
    const crudo = almacen.getItem(clave(userId))
    const lista = crudo ? JSON.parse(crudo) : []
    return new Set(Array.isArray(lista) ? lista.filter((x): x is string => typeof x === 'string') : [])
  } catch {
    return new Set()
  }
}

/** Recuerda el cierre por pedido. Si no se puede guardar, igual se cierra en esta pantalla. */
export function cerrarRechazo(almacen: Almacen | null | undefined, userId: string | undefined, reservaId: string): Set<string> {
  const actuales = leerRechazosCerrados(almacen, userId)
  actuales.add(reservaId)
  try {
    if (almacen && userId) almacen.setItem(clave(userId), JSON.stringify([...actuales].slice(-100)))
  } catch { /* sin almacenamiento: se cierra igual hasta recargar */ }
  return actuales
}
