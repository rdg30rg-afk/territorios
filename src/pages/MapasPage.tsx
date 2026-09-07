import { SanJuanMap } from '../components/SanJuanMap'
import { useSearchParams } from 'react-router-dom'
import { useEffect, useState } from 'react'
import { CoverageHeatmapPanel } from '../components/CoverageHeatmapPanel'
import { useAuth } from '../context/useAuth'
import { canOpenAdminPanel } from '../lib/access'
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
  const { profile, contexto } = useAuth()
  const [searchParams] = useSearchParams()
  const requestedTerritoryId = searchParams.get('territorio')?.trim() || null
  const [view,setView]=useState<'editor'|'cobertura'>('editor')
  const [editingEnabled, setEditingEnabled] = useState(false)
  const canEditMap = canOpenAdminPanel(profile, contexto)

  useEffect(() => {
    const narrowScreen = window.matchMedia('(max-width: 767px)')
    const leaveEditingOnNarrowScreen = () => {
      if (narrowScreen.matches) setEditingEnabled(false)
    }
    leaveEditingOnNarrowScreen()
    narrowScreen.addEventListener('change', leaveEditingOnNarrowScreen)
    return () => narrowScreen.removeEventListener('change', leaveEditingOnNarrowScreen)
  }, [])

  const selectView = (nextView: 'editor' | 'cobertura') => {
    setView(nextView)
    if (nextView === 'cobertura') setEditingEnabled(false)
  }

  return (
    <div className="page mapas-pagina">
      <section className="page-header">
        <h2>Mapas y territorios</h2>
        <div className="mapas-header-controls">
          <div className="segmentado" role="tablist" aria-label="Vista del mapa">
            <button
              type="button"
              role="tab"
              aria-selected={view === 'editor'}
              onClick={() => selectView('editor')}
            >
              Territorios
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={view === 'cobertura'}
              onClick={() => selectView('cobertura')}
            >
              Cobertura
            </button>
          </div>
          {canEditMap && view === 'editor' ? (
            <button
              type="button"
              className={editingEnabled ? 'map-mode-button is-active' : 'map-mode-button'}
              aria-pressed={editingEnabled}
              onClick={() => setEditingEnabled((current) => !current)}
            >
              <span aria-hidden="true">{editingEnabled ? '✓' : '✎'}</span>
              {editingEnabled ? 'Cerrar edición' : 'Editar mapa'}
            </button>
          ) : null}
        </div>
      </section>
      {editingEnabled ? (
        <div className="map-editing-notice" role="status">
          <span aria-hidden="true">✎</span>
          <span><strong>Edición activa.</strong> Elegí un territorio o creá uno nuevo.</span>
        </div>
      ) : null}
      <div hidden={view!=='editor'}>
        <SanJuanMap
          initialTerritoryId={requestedTerritoryId}
          editingEnabled={editingEnabled}
        />
      </div>
      {view==='cobertura'?<CoverageHeatmapPanel key={requestedTerritoryId??'general'} initialTerritoryId={requestedTerritoryId}/>:null}
    </div>
  )
}
