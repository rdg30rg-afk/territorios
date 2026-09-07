import { SanJuanMap } from '../components/SanJuanMap'
import { useSearchParams } from 'react-router-dom'
import { useState } from 'react'
import { CoverageHeatmapPanel } from '../components/CoverageHeatmapPanel'

/**
 * MAPAS Y TERRITORIOS
 *
 * Quien entra: el que arma los territorios, en la PC, a dibujar o a
 * buscar uno. Viene a ver el mapa. La unica accion es tocar un
 * territorio de la lista, o dibujar uno nuevo.
 *
 * Antes esta pantalla tenia, debajo del mapa, dos paneles que explicaban
 * la aplicacion: "Como usarlo: selecciona un territorio desde la tabla
 * superior" y "Formato de guardado: GeoJSON listo para crecer". El
 * primero describia el boton que estaba tres centimetros mas arriba; el
 * segundo nombraba el formato del archivo, que es un detalle de adentro
 * del sistema y no cambia ninguna decision de nadie. Los dos ocupaban la
 * mitad de la pantalla debajo del mapa. El mapa es la pantalla.
 */
export function MapasPage() {
  const [searchParams] = useSearchParams()
  const requestedTerritoryId = searchParams.get('territorio')?.trim() || null
  const [view,setView]=useState<'editor'|'cobertura'>('editor')

  return (
    <div className="page">
      <section className="page-header">
        <div>
          <h2>Mapas y Territorios</h2>
          <p className="lead">
            Buscá un territorio en la lista para verlo, o dibujá uno nuevo sobre el mapa.
          </p>
        </div>
      </section>

      <div className="module-table-actions" aria-label="Vista del mapa">
        <button type="button" className="secondary-button" aria-pressed={view==='editor'} onClick={()=>setView('editor')}>Territorios y dibujo</button>
        <button type="button" className="secondary-button" aria-pressed={view==='cobertura'} onClick={()=>setView('cobertura')}>Ver cobertura</button>
      </div>
      <div hidden={view!=='editor'}><SanJuanMap initialTerritoryId={requestedTerritoryId} /></div>
      {view==='cobertura'?<CoverageHeatmapPanel key={requestedTerritoryId??'general'} initialTerritoryId={requestedTerritoryId}/>:null}
    </div>
  )
}
