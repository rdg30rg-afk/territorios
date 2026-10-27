/**
 * Deshacer después de marcar (H3): lo que se puede decidir sin pantalla.
 *
 * La bitácora de cobertura es de solo agregar, así que deshacer no borra el
 * evento anterior: informa uno nuevo. Es el mismo camino que "Sin dato" al
 * desmarcar. Casi siempre el estado de antes era "sin dato" y es eso lo que
 * se emite; si el dedo pisó otro estado (recorrido, revisitar...), se vuelve
 * a ese en vez de borrarlo en silencio.
 */
import type { CoverageInput } from './coverageOutbox.ts'

/** Cuánto dura el aviso con el botón. */
export const DURACION_DESHACER_MS = 8000
/** Cuánto dura el "Listo" que confirma que se deshizo. */
export const DURACION_DESHECHA_MS = 3000

export type EstadoDeCobertura = CoverageInput['estado']

const ESTADOS: readonly EstadoDeCobertura[] = ['recorrido', 'no_accesible', 'revisitar', 'sin_dato']

/** Lo que no es un estado conocido cuenta como "sin dato", igual que en el resumen. */
export function normalizarEstado(valor: unknown): EstadoDeCobertura {
  return ESTADOS.includes(valor as EstadoDeCobertura) ? (valor as EstadoDeCobertura) : 'sin_dato'
}

export type LadoMarcable = { id: string; manzana_id: string; geometry_version?: number }

export type CambioDeMarca = {
  ladoId: string
  manzanaId: string
  geometryVersion: number
  estadoPrevio: EstadoDeCobertura
}

/**
 * Los lados que de verdad cambian: los que ya tienen el estado pedido no se
 * tocan (y por lo tanto tampoco se deshacen).
 */
export function cambiosParaMarcar(
  lados: readonly LadoMarcable[],
  estadoNuevo: EstadoDeCobertura,
  estadosActuales: Readonly<Record<string, string>>,
): CambioDeMarca[] {
  const cambios: CambioDeMarca[] = []
  for (const lado of lados) {
    if (estadosActuales[lado.id] === estadoNuevo) continue
    if (!lado.geometry_version) throw new Error('Falta la versión del dibujo. Actualizá antes de marcar.')
    cambios.push({
      ladoId: lado.id,
      manzanaId: lado.manzana_id,
      geometryVersion: lado.geometry_version,
      estadoPrevio: normalizarEstado(estadosActuales[lado.id]),
    })
  }
  return cambios
}

function entradaDeCobertura(
  cambio: CambioDeMarca,
  estado: EstadoDeCobertura,
  territoryId: string,
  userId: string,
): CoverageInput {
  return {
    lado_id: cambio.ladoId,
    manzana_id: cambio.manzanaId,
    territory_id: territoryId,
    geometry_version: cambio.geometryVersion,
    estado,
    origen: 'app_hermano',
    informado_por: userId,
  }
}

export function entradasDeMarca(
  cambios: readonly CambioDeMarca[],
  estado: EstadoDeCobertura,
  territoryId: string,
  userId: string,
): CoverageInput[] {
  return cambios.map((c) => entradaDeCobertura(c, estado, territoryId, userId))
}

/** Un evento por lado, devolviéndolo al estado que tenía antes de marcar. */
export function entradasParaDeshacer(
  cambios: readonly CambioDeMarca[],
  territoryId: string,
  userId: string,
): CoverageInput[] {
  return cambios.map((c) => entradaDeCobertura(c, c.estadoPrevio, territoryId, userId))
}

export type Alcance =
  | { tipo: 'manzana'; etiqueta: string }
  | { tipo: 'cuadra'; numero: number; etiqueta: string }

export function describirAlcance(alcance: Alcance) {
  const rotulo = alcance.etiqueta.trim().toUpperCase()
  const manzana = rotulo ? `la manzana ${rotulo}` : 'una manzana sin rótulo'
  return alcance.tipo === 'manzana' ? manzana : `la cuadra ${alcance.numero} de ${manzana}`
}

/** "Marcaste la manzana B", dicho según el estado informado. */
export function textoDeMarca(estado: EstadoDeCobertura, alcance: Alcance) {
  const donde = describirAlcance(alcance)
  switch (estado) {
    case 'recorrido': return `Marcaste ${donde}`
    case 'no_accesible': return `Marcaste ${donde} como no accesible`
    case 'revisitar': return `Marcaste ${donde} para revisitar`
    case 'sin_dato': return `Quitaste la marca de ${donde}`
  }
}

export const TEXTO_DESHECHO = 'Listo, quedó como estaba'

export type MarcaReciente = {
  id: number
  texto: string
  cambios: CambioDeMarca[]
  /** `deshecha`: ya se apretó el botón; se muestra la confirmación y nada más. */
  fase: 'reciente' | 'deshecha'
}
