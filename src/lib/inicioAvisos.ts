/**
 * Lo que el Inicio del administrador cuenta: salidas de hoy y de ayer,
 * territorios personales terminados y salidas a medio armar.
 * Sin Supabase ni React: se puede probar solo.
 */

/** 64.8 -> «64,8 %», 100 -> «100 %». */
export function formatearPorcentaje(valor: number): string {
  const redondeado = Math.round(valor * 10) / 10
  return `${String(redondeado).replace('.', ',')} %`
}

const DIA = 86_400_000

/** La app es de San Juan, Argentina (UTC−3 todo el año, sin horario de verano).
 *  El «día» se cuenta ahí, sin importar en qué zona esté el navegador: si no,
 *  a las 23:46 del viernes un servidor o un navegador en UTC ya vive en sábado. */
export const ZONA_ARGENTINA = 'America/Argentina/San_Juan'
const DESFASE_ARGENTINA = 3 * 3_600_000

/** Medianoche argentina del día de `fecha` (como instante absoluto). */
export function inicioDelDia(fecha: Date): Date {
  const corrida = new Date(fecha.getTime() - DESFASE_ARGENTINA)
  return new Date(Date.UTC(corrida.getUTCFullYear(), corrida.getUTCMonth(), corrida.getUTCDate()) + DESFASE_ARGENTINA)
}

/** «10:00» en hora argentina. */
export function horaArgentina(fecha: Date): string {
  return fecha.toLocaleTimeString('es-AR', { hour: '2-digit', minute: '2-digit', hour12: false, timeZone: ZONA_ARGENTINA })
}

/** «hoy», «ayer», «mañana», «hace 3 días» (por día de calendario, no por horas). */
export function haceCuanto(iso: string | null | undefined, ahora = new Date()): string {
  if (!iso) return 'sin fecha'
  const fecha = new Date(iso)
  if (Number.isNaN(fecha.getTime())) return 'sin fecha'
  const dias = Math.round((inicioDelDia(ahora).getTime() - inicioDelDia(fecha).getTime()) / DIA)
  if (dias === 0) return 'hoy'
  if (dias === -1) return 'mañana'
  if (dias < 0) return `en ${-dias} días`
  if (dias === 1) return 'ayer'
  return `hace ${dias} días`
}

// ---------------------------------------------------------------------
// Salidas a medio armar (pendientes)
// ---------------------------------------------------------------------

export type SalidaProxima = {
  tipo: string | null
  territory_id: string | null
  meeting_point_id: string | null
  meeting_point_name: string | null
}

/** Las salidas de teléfono, de grupos o de asamblea no llevan punto ni territorio. */
const SIN_PUNTO_NI_TERRITORIO = new Set(['telefonica', 'grupos', 'asamblea'])

export function contarSalidasIncompletas(filas: ReadonlyArray<SalidaProxima>) {
  let sinPunto = 0
  let sinTerritorio = 0
  for (const fila of filas) {
    if (fila.tipo && SIN_PUNTO_NI_TERRITORIO.has(fila.tipo)) continue
    if (!fila.meeting_point_id && !fila.meeting_point_name?.trim()) sinPunto += 1
    if (!fila.territory_id && !fila.tipo) sinTerritorio += 1
  }
  return { sinPunto, sinTerritorio }
}

// ---------------------------------------------------------------------
// Salidas de hoy y de ayer
// ---------------------------------------------------------------------

export type SalidaReciente = {
  id: string
  title: string
  scheduled_for: string
  tipo: string | null
}

export type ResultadoReciente = {
  salida_id: string
  estado: string
  motivo: string | null
  informado_por: string | null
}

const ESTADOS: Record<string, string> = {
  realizada: 'Realizada',
  parcial: 'Parcial',
  no_realizada: 'No se hizo',
  cancelada: 'Cancelada',
  sin_dato: 'Sin datos',
}

const MOTIVOS: Record<string, string> = {
  acceso: 'no se pudo entrar',
  edificio: 'edificio',
  consorcio: 'consorcio',
  clima: 'clima',
  feriado: 'feriado',
  sin_conductor: 'sin conductor',
  sin_publicadores: 'sin publicadores',
  otro: 'otro motivo',
}

export type FilaDeSalida = {
  id: string
  titulo: string
  cuando: string
  informada: boolean
  /** Ya pasó la hora y nadie informó: es la única que ofrece «Informar ahora». */
  puedeInformar: boolean
  texto: string
}

export function armarFilasDeSalidas(
  salidas: ReadonlyArray<SalidaReciente>,
  resultados: ReadonlyArray<ResultadoReciente>,
  nombres: ReadonlyMap<string, string>,
  ahora = new Date(),
): FilaDeSalida[] {
  const porSalida = new Map(resultados.map((r) => [r.salida_id, r]))
  return [...salidas]
    .filter((s) => s.tipo !== 'grupos')
    .sort((a, b) => a.scheduled_for.localeCompare(b.scheduled_for))
    .map((s) => {
      const r = porSalida.get(s.id)
      const hora = new Date(s.scheduled_for)
      const empezo = hora.getTime() <= ahora.getTime()
      const dia = haceCuanto(s.scheduled_for, ahora)
      const cuando = `${dia.charAt(0).toUpperCase() + dia.slice(1)} ${horaArgentina(hora)}`
      if (r) {
        const quien = r.informado_por ? nombres.get(r.informado_por) : null
        const estado = ESTADOS[r.estado] ?? r.estado
        const motivo = r.motivo && MOTIVOS[r.motivo] ? ` (${MOTIVOS[r.motivo]})` : ''
        return {
          id: s.id,
          titulo: s.title,
          cuando,
          informada: true,
          puedeInformar: false,
          texto: `Informada${quien ? ` por ${quien}` : ''}: ${estado}${motivo}`,
        }
      }
      return {
        id: s.id,
        titulo: s.title,
        cuando,
        informada: false,
        puedeInformar: empezo,
        texto: empezo ? 'Sin informar' : 'Todavía no empezó',
      }
    })
}

// ---------------------------------------------------------------------
// Territorios personales terminados
// ---------------------------------------------------------------------

export type ReservaPersonal = {
  id: string
  territory_id: string
  status: string
  assigned_to: string | null
  reserved_at: string | null
  released_at: string | null
}

export type CoberturaDeTerritorio = {
  territory_id: string
  name: string
  pct_metros: number | string | null
  ultima_marca: string | null
  tiene_dato: boolean
}

export type TerritorioTerminado = {
  clave: string
  cuando: string | null
  texto: string
}

const DIAS_DE_MEMORIA = 14

function porcentaje(c: CoberturaDeTerritorio | undefined): number | null {
  if (!c || !c.tiene_dato || c.pct_metros === null || c.pct_metros === '') return null
  const n = Number(c.pct_metros)
  return Number.isFinite(n) && n >= 0 && n <= 100 ? n : null
}

/**
 * Cómo se sabe que un territorio personal quedó terminado:
 *  - Lo devolvió (la reserva pasa a «liberada» con fecha de devolución). Si
 *    además la cobertura está al 100 % se dice «terminó»; si no, «devolvió» y
 *    se muestra cuánto había recorrido, para no afirmar de más.
 *  - Sigue asignado pero la cobertura llegó al 100 % con marcas posteriores a
 *    la asignación: «terminó de recorrerlo», falta que lo devuelva.
 */
export function armarTerminados(
  reservas: ReadonlyArray<ReservaPersonal>,
  coberturas: ReadonlyMap<string, CoberturaDeTerritorio>,
  nombres: ReadonlyMap<string, string>,
  ahora = new Date(),
): TerritorioTerminado[] {
  const limite = ahora.getTime() - DIAS_DE_MEMORIA * DIA
  const filas: TerritorioTerminado[] = []
  for (const r of reservas) {
    if (!r.assigned_to) continue
    const cob = coberturas.get(r.territory_id)
    const territorio = cob?.name ?? '?'
    const quien = nombres.get(r.assigned_to) ?? 'Un hermano'
    const pct = porcentaje(cob)
    if (r.status === 'liberada' && r.released_at) {
      if (Date.parse(r.released_at) < limite) continue
      filas.push({
        clave: r.id,
        cuando: r.released_at,
        texto:
          pct === 100
            ? `${quien} terminó el territorio ${territorio} y lo devolvió`
            : `${quien} devolvió el territorio ${territorio}${pct === null ? '' : ` (recorrido ${formatearPorcentaje(pct)})`}`,
      })
    } else if (r.status === 'activa' && pct === 100 && cob?.ultima_marca) {
      const marca = Date.parse(cob.ultima_marca)
      const desde = r.reserved_at ? Date.parse(r.reserved_at) : 0
      if (marca < limite || marca < desde) continue
      filas.push({
        clave: r.id,
        cuando: cob.ultima_marca,
        texto: `${quien} terminó de recorrer el territorio ${territorio} y todavía no lo devolvió`,
      })
    }
  }
  return filas.sort((a, b) => (b.cuando ?? '').localeCompare(a.cuando ?? ''))
}
