import type { SupabaseClient } from '@supabase/supabase-js'
import { readAllRows } from './readAllRows.ts'

export type ManzanaFormaGeom = { type: 'Polygon'; coordinates: [number, number][][] }

export type ManzanaForma = {
  letra: string
  geom: ManzanaFormaGeom
}

type FilaDeForma = {
  territory_id: string
  label: string
  geometry_geojson: ManzanaFormaGeom | null
}

/**
 * Las formas de las manzanas vigentes de unos territorios, desde la base.
 *
 * Devuelve una entrada por cada territorio pedido, vacía si la base contestó y
 * no tiene formas. Ese vacío es el que el mapa traduce en "este territorio
 * todavía no tiene manzanas publicadas", así que tiene que ser verdad: si la
 * consulta falla se rechaza la promesa, y si la respuesta es más larga que lo
 * que PostgREST entrega de una vez se pide por páginas. Sin la paginación, un
 * territorio cuyas filas quedaran fuera del primer millar figuraría como "sin
 * manzanas" sin que nada fallara.
 */
export async function loadManzanaFormas(client: SupabaseClient, territoryIds: string[]) {
  const formas = new Map<string, ManzanaForma[]>(territoryIds.map((id) => [id, []]))
  if (territoryIds.length === 0) return formas

  const filas = await readAllRows<FilaDeForma>((desde, hasta) =>
    client
      .from('territorio_manzanas')
      .select('id, territory_id, label, geometry_geojson')
      .in('territory_id', territoryIds)
      .is('vigente_hasta', null)
      .not('geometry_geojson', 'is', null)
      // El orden fijo es lo que hace que las páginas no se pisen ni se salteen.
      .order('id')
      .range(desde, hasta),
  )

  for (const fila of filas) {
    if (!fila.geometry_geojson?.coordinates?.length) continue
    formas.get(fila.territory_id)?.push({ letra: fila.label, geom: fila.geometry_geojson })
  }
  return formas
}
