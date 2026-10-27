import type { SupabaseClient } from '@supabase/supabase-js'
import { readAllRows } from './readAllRows.ts'
import { buildCoverageHeatmap, type HeatmapBlock, type HeatmapSide, type HeatmapEvent } from './coverageHeatmap.ts'

/**
 * `territoryId` acota la consulta a un territorio.
 *
 * Sin él esta función trae los dibujos de todos los territorios y toda la
 * bitácora de cobertura hasta la fecha: son cientos de filas por territorio,
 * pedidas en páginas, para pintar un mapa donde, a esa distancia, no se
 * distingue un lado de otro. Y la bitácora sólo crece: cada marca de cada
 * hermano es una fila que no se borra.
 *
 * Con territorio elegido se acotan las tres tablas grandes por la columna
 * `territory_id`, que existe en todas:
 *
 *  - `territorio_manzanas` y `manzana_lados`: es de la fila.
 *  - `cobertura_eventos`: está desnormalizada a propósito (la tabla lo dice en
 *    su comentario) y se copia del lado en el momento de la marca, en
 *    `informar_cobertura`. Un lado nunca cambia de territorio: redibujar crea
 *    lados nuevos y cierra los viejos con `vigente_hasta`. Por eso los eventos
 *    del territorio son exactamente los de sus lados, y la tabla tiene el
 *    índice `(territory_id, informado_at desc)`.
 *
 * Los territorios se piden siempre enteros: son pocos y sus nombres hacen
 * falta para la lista de donde se elige.
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
    readAllRows<HeatmapEvent>((from,to)=>{
      const query=client.from('cobertura_eventos')
        .select('id,lado_id,estado,informado_at').lte('informado_at',iso)
      if(territoryId) query.eq('territory_id',territoryId)
      return query.order('informado_at').order('id').range(from,to)
    }),
  ])
  return buildCoverageHeatmap(territories,blocks,sides,events,iso)
}
