/**
 * Marcas que el servidor rechazó, dichas como las diría una persona (H2).
 * «Manzana B, cuadra 2», no «Cuadra 043de5fc».
 */
import type { CoverageQueuedEvent } from './coverageOutbox.ts'

type ManzanaLite = { id: string; label: string }
type LadoLite = { id: string; manzana_id: string; orden: number }

const ESTADO: Record<string, string> = {
  recorrido: 'recorrida',
  no_accesible: 'no accesible',
  revisitar: 'para revisitar',
  sin_dato: 'sin dato',
}

export function describirCuadra(
  evento: Pick<CoverageQueuedEvent, 'lado_id' | 'manzana_id' | 'estado'>,
  manzanas: readonly ManzanaLite[],
  lados: readonly LadoLite[],
): string {
  const manzana = manzanas.find((m) => m.id === evento.manzana_id)
  const lado = lados.find((l) => l.id === evento.lado_id)
  const donde = manzana
    ? `Manzana ${manzana.label.trim().toUpperCase() || 'sin rótulo'}${lado ? `, cuadra ${lado.orden + 1}` : ''}`
    : 'Una cuadra de otro territorio'
  return `${donde} (${ESTADO[evento.estado] ?? evento.estado})`
}

/** El motivo del servidor suele venir en inglés o con códigos: se traduce lo conocido. */
export function motivoHumano(error: string | null | undefined): string {
  const texto = (error ?? '').toLowerCase()
  if (/reserva|reservation|assigned|asignad|permission|permiso|not allowed|42501/.test(texto)) return 'Ya no tenés este territorio asignado.'
  if (/geometr|versi[oó]n|version|vigente|retirad/.test(texto)) return 'El dibujo del territorio cambió después de marcar.'
  if (/identificador|uuid/.test(texto)) return 'El servidor no confirmó la marca.'
  return 'El servidor no la aceptó.'
}

export type GrupoRechazado = { clave: string; titulo: string; ids: string[] }

/** Agrupa por manzana para que ocho marcas no sean ocho renglones. */
export function agruparRechazadas(
  eventos: readonly CoverageQueuedEvent[],
  manzanas: readonly ManzanaLite[],
): GrupoRechazado[] {
  const grupos = new Map<string, GrupoRechazado>()
  for (const e of eventos) {
    const manzana = manzanas.find((m) => m.id === e.manzana_id)
    const clave = manzana ? e.manzana_id : 'otro'
    const titulo = manzana ? `Manzana ${manzana.label.trim().toUpperCase() || 'sin rótulo'}` : 'Otro territorio'
    const g = grupos.get(clave) ?? { clave, titulo, ids: [] }
    g.ids.push(e.id)
    grupos.set(clave, g)
  }
  return [...grupos.values()]
}
