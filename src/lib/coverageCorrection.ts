import type { CoverageInput } from './coverageOutbox'
import type { CoverageState } from './coverageSummary'

export function prepareCoverageCorrection(
  actor:{id:string;role:string;access_status:string},
  event:{id:string;lado_id:string;manzana_id:string},
  side:{id:string;manzana_id:string;geometry_version:number},
  territoryId:string,state:CoverageState,note:string,
): CoverageInput {
  if(actor.role!=='admin'||actor.access_status!=='active') throw Error('Solo un administrador activo puede corregir.')
  if(!actor.id||!event.id||!territoryId||side.id!==event.lado_id||side.manzana_id!==event.manzana_id
    ||!Number.isInteger(side.geometry_version)||side.geometry_version<1) throw Error('No se pudo identificar el dibujo original de la marca.')
  if(!['recorrido','no_accesible','revisitar','sin_dato'].includes(state)) throw Error('Estado de cobertura inválido.')
  if(note.trim().length<2) throw Error('Explicá el motivo de la corrección.')
  return {lado_id:side.id,manzana_id:side.manzana_id,territory_id:territoryId,geometry_version:side.geometry_version,
    estado:state,origen:'correccion',informado_por:actor.id,corrige_evento_id:event.id,nota:note.trim()}
}
