import type { CoverageInput } from './coverageOutbox'
import type { CoverageState } from './coverageSummary'

type Actor = { id: string; access_status: string; driver_id: string | null; puede_informar_salidas?: boolean } | null
type Outing = { id?: string; driverId?: string; terrId?: string }
type Side = {
  id: string; manzana_id: string; territory_id: string
  geometry_version: number; vigente_hasta: string | null
}

export function canReportSalidaCoverage(actor: Actor, outing: Outing) {
  const capability = actor?.puede_informar_salidas ?? Boolean(actor?.driver_id)
  return Boolean(actor?.access_status === 'active' && capability && outing.id && outing.terrId)
}

export function prepareSalidaCoverage(actor: Actor, outing: Outing, side: Side, state: CoverageState): CoverageInput {
  if (!canReportSalidaCoverage(actor, outing) || !actor) throw Error('Tu cuenta no puede informar lo recorrido en esta salida.')
  if (side.territory_id !== outing.terrId || side.vigente_hasta !== null ||
    !Number.isInteger(side.geometry_version) || side.geometry_version < 1) {
    throw Error('El lado no pertenece al dibujo vigente de esta salida. Actualizá antes de marcar.')
  }
  if (!['recorrido', 'revisitar', 'no_accesible', 'sin_dato'].includes(state)) throw Error('Estado de cobertura inválido.')
  return {
    lado_id: side.id, manzana_id: side.manzana_id, territory_id: side.territory_id,
    geometry_version: side.geometry_version, estado: state, origen: 'cierre_salida',
    salida_id: outing.id!, informado_por: actor.id,
  }
}
