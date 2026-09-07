import { validAt, latestEventsAt } from './coverageHistory.ts'
import { coverageSummary, type CoverageState } from './coverageSummary.ts'

type Validity = { vigente_desde: string | null; vigente_hasta: string | null }
export type HeatmapBlock = Validity & { id: string; territory_id: string; geometry_version: number }
export type HeatmapSide = Validity & {
  id: string; manzana_id: string; territory_id: string; geometry_version: number
  geometry_geojson: unknown; largo_m: number | string
}
export type HeatmapEvent = {
  id: string; lado_id: string; estado: string; informado_at: string
}
export const coverageLegend: Record<CoverageState, { label: string; color: string; dash: string | undefined }> = {
  recorrido: {label:'Recorrido',color:'#34734e',dash:undefined},
  revisitar: {label:'Volver a visitar',color:'#9a650d',dash:'8 4'},
  no_accesible: {label:'No accesible',color:'#a5423c',dash:'2 5'},
  sin_dato: {label:'Sin dato',color:'#666b70',dash:'4 6'},
}
function asState(value?: string): CoverageState {
  return value === 'recorrido' || value === 'revisitar' || value === 'no_accesible' ? value : 'sin_dato'
}
// Estado conocido EN el instante elegido, no la reconstrucción retroactiva de
// una fecha de visita. Correcciones posteriores no cambian esta instantánea.
export function buildCoverageHeatmap(
  territories: {id:string;name:string}[], blocks: HeatmapBlock[], sides: HeatmapSide[],
  events: HeatmapEvent[], instant: string,
) {
  const at = Date.parse(instant)
  if (!Number.isFinite(at)) throw Error('Fecha de cobertura inválida')
  const validBlocks = new Map(blocks.filter(block=>validAt(block,instant)).map(block=>[block.id,block]))
  const latest = latestEventsAt(events,instant)
  const knownTerritories = new Set(territories.map(t=>t.id))
  let inconsistentSides=0
  const visibleSides=sides.filter(side=>{
    if(!validAt(side,instant)) return false
    const block=validBlocks.get(side.manzana_id)
    if(!block || block.territory_id!==side.territory_id || block.geometry_version!==side.geometry_version
      || !knownTerritories.has(side.territory_id)) {inconsistentSides++;return false}
    return true
  }).map(side=>{
    const event=latest.get(side.id)
    return {...side,state:asState(event?.estado),informedAt:event?.informado_at ?? null,
      ageDays:event ? Math.floor((at-Date.parse(event.informado_at))/86400000) : null}
  })
  const grouped=new Map<string,typeof visibleSides>()
  for(const side of visibleSides) {
    const group=grouped.get(side.territory_id) ?? []
    group.push(side);grouped.set(side.territory_id,group)
  }
  return {
    instant,inconsistentSides,sides:visibleSides,
    territories:territories.map(territory=>{
      const group=grouped.get(territory.id) ?? []
      return {...territory,...coverageSummary(group,Object.fromEntries(group.map(side=>[side.id,side.state])))}
    }),
  }
}
