import type { CoverageState } from './coverageSummary.ts'

// Lo que el panel muestra de un territorio elegido: manzana por manzana, con
// cada cuadra, su estado y quién y cuándo la marcó. Sin red: recibe lo que ya
// armó `buildCoverageHeatmap`.
export type CuadraDetalle = {
  id: string; orden: number | null; state: CoverageState
  informedAt: string | null; informedBy: string | null; origen: string | null; nota: string | null
}
export type ManzanaDetalle = {
  id: string; label: string; total: number; recorridas: number; cuadras: CuadraDetalle[]
}
type LadoEntrada = {
  id: string; manzana_id: string; state: CoverageState; orden?: number | null; blockLabel?: string | null
  informedAt: string | null; informedBy?: string | null; origen?: string | null; nota?: string | null
}

/** «a» -> «A»: las manzanas se rotulan con letra mayúscula. Un rótulo más
 *  largo («Sin rótulo», «12 bis») se deja como viene. */
export function rotuloManzana(label: string | null | undefined): string {
  const limpio = (label ?? '').trim()
  return /^\p{L}$/u.test(limpio) ? limpio.toLocaleUpperCase('es') : limpio
}

export function agruparPorManzana(sides: LadoEntrada[]): ManzanaDetalle[] {
  const grupos = new Map<string, ManzanaDetalle>()
  for (const side of sides) {
    let grupo = grupos.get(side.manzana_id)
    if (!grupo) {
      grupo = { id: side.manzana_id, label: rotuloManzana(side.blockLabel) || 'Sin rótulo', total: 0, recorridas: 0, cuadras: [] }
      grupos.set(side.manzana_id, grupo)
    }
    grupo.total++
    if (side.state === 'recorrido') grupo.recorridas++
    grupo.cuadras.push({
      id: side.id, orden: side.orden ?? null, state: side.state, informedAt: side.informedAt,
      informedBy: side.informedBy ?? null, origen: side.origen ?? null, nota: side.nota ?? null,
    })
  }
  const lista = [...grupos.values()]
  for (const g of lista) g.cuadras.sort((a, b) => (a.orden ?? 1e9) - (b.orden ?? 1e9) || a.id.localeCompare(b.id))
  return lista.sort((a, b) => a.label.localeCompare(b.label, 'es', { numeric: true }))
}

type EventoEntrada = { territory_id?: string; informado_at: string; informado_por?: string | null }
/** La marca más reciente de cada territorio, y la más reciente de cada persona en él. */
export function ultimasMarcas(events: EventoEntrada[]) {
  const porTerritorio = new Map<string, { at: string; by: string | null }>()
  const porPersona = new Map<string, string>()
  for (const e of events) {
    if (!e.territory_id) continue
    const t = Date.parse(e.informado_at)
    if (!Number.isFinite(t)) continue
    const previo = porTerritorio.get(e.territory_id)
    if (!previo || t > Date.parse(previo.at)) porTerritorio.set(e.territory_id, { at: e.informado_at, by: e.informado_por ?? null })
    if (e.informado_por) {
      const clave = `${e.territory_id}|${e.informado_por}`
      const prior = porPersona.get(clave)
      if (!prior || t > Date.parse(prior)) porPersona.set(clave, e.informado_at)
    }
  }
  return { porTerritorio, porPersona }
}

/** «hace 3 días», «hoy», «ayer». */
export function haceCuanto(iso: string | null, ahora = Date.now()) {
  if (!iso) return 'sin fecha'
  const t = Date.parse(iso)
  if (!Number.isFinite(t)) return 'sin fecha'
  const dias = Math.floor((ahora - t) / 86400000)
  if (dias <= 0) return 'hoy'
  if (dias === 1) return 'ayer'
  return `hace ${dias} días`
}
