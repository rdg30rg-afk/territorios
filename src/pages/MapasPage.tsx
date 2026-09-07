import { SanJuanMap } from '../components/SanJuanMap'
import { useSearchParams } from 'react-router-dom'
import { useState } from 'react'
import { CoverageHeatmapPanel } from '../components/CoverageHeatmapPanel'
import '../styles/mapas-pagina.css'

/**
 * MAPAS Y TERRITORIOS
 *
 * Quien entra: el que arma los territorios, en la PC, a dibujar o a
 * buscar uno. Viene a ver el mapa. La unica accion es tocar un
 * territorio de la lista, o dibujar uno nuevo.
 *
 * El titulo y la bajada ("Busca un territorio...") describian la
 * pantalla que ya tenian delante. En telefono eso empujaba el mapa
 * debajo del pliegue, detras de dos botones y un parrafo.
 */
export function MapasPage() {
  const [searchParams] = useSearchParams()
  const requestedTerritoryId = searchParams.get('territorio')?.trim() || null
  const [view,setView]=useState<'editor'|'cobertura'>('editor')

  return (
    <div className="page mapas-pagina">
      <section className="page-header">
        <h2>Mapas y territorios</h2>
        <div className="segmentado" role="tablist" aria-label="Vista del mapa">
          <button
            type="button"
            role="tab"
            aria-selected={view === 'editor'}
            onClick={() => setView('editor')}
          >
            Territorios
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={view === 'cobertura'}
            onClick={() => setView('cobertura')}
          >
            Cobertura
          </button>
        </div>
      </section>
      <div hidden={view!=='editor'}><SanJuanMap initialTerritoryId={requestedTerritoryId} /></div>
      {view==='cobertura'?<CoverageHeatmapPanel key={requestedTerritoryId??'general'} initialTerritoryId={requestedTerritoryId}/>:null}
    </div>
  )
}
