import type { SupabaseClient } from '@supabase/supabase-js'
import { readAllRows } from './readAllRows.ts'
import { buildCoverageHeatmap, type HeatmapBlock, type HeatmapSide, type HeatmapEvent } from './coverageHeatmap.ts'

/**
 * `territoryId` acota los dibujos a un territorio.
 *
 * Sin él esta función trae los lados de los 70 territorios: medido en el
 * navegador, 1,3 MB en diez páginas de `manzana_lados`, para pintar 2.735
 * lados en un mapa donde, a esa distancia, no se distingue uno de otro.
 * Los territorios y los eventos se piden siempre enteros: pesan 4 kB y 13 kB,
 * y los nombres hacen falta para la lista.
 */
export async function loadCoverageHeatmap(
  client: SupabaseClient, instant: string, territoryId: string | null = null,
) {
  const timestamp=Date.parse(instant)
  if(!Number.isFinite(timestamp)) throw Error('Fecha de cobertura inválida')
  const iso=new Date(timestamp).toISOString()
  // Lecturas completas y ordenadas. Ningún resultado parcial se entrega si
  // falla una página. Sin datos personales ni escrituras.
  const [territories,blocks,sides,events]=await Promise.all([
    readAllRows<{id:string;name:string}>((from,to)=>client.from('territorios')
      .select('id,name').order('id').range(from,to)),
    readAllRows<HeatmapBlock>((from,to)=>{
      const query=client.from('territorio_manzanas')
        .select('id,territory_id,geometry_version,vigente_desde,vigente_hasta')
        .lte('vigente_desde',iso)
      if(territoryId) query.eq('territory_id',territoryId)
      return query.order('id').range(from,to)
    }),
    readAllRows<HeatmapSide>((from,to)=>{
      const query=client.from('manzana_lados')
        .select('id,manzana_id,territory_id,geometry_version,geometry_geojson,largo_m,vigente_desde,vigente_hasta')
        .lte('vigente_desde',iso)
      if(territoryId) query.eq('territory_id',territoryId)
      return query.order('id').range(from,to)
    }),
    readAllRows<HeatmapEvent>((from,to)=>client.from('cobertura_eventos')
      .select('id,lado_id,estado,informado_at').lte('informado_at',iso)
      .order('informado_at').order('id').range(from,to)),
  ])
  return buildCoverageHeatmap(territories,blocks,sides,events,iso)
}
