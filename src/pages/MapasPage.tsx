import { useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { SanJuanMap } from '../components/SanJuanMap'
import { CoverageHeatmapPanel } from '../components/CoverageHeatmapPanel'
import { useAuth } from '../context/useAuth'
import { canOpenAdminPanel } from '../lib/access'
import '../styles/mapas-pagina.css'

/** Keep the existing editor document alive while switching tabs. */
export function MapasPage() {
  const { profile, contexto } = useAuth()
  const [searchParams] = useSearchParams()
  const requestedTerritoryId = searchParams.get('territorio')?.trim() || null
  const [view, setView] = useState<'editor' | 'cobertura'>('editor')
  const canEditMap = canOpenAdminPanel(profile, contexto)
  return (
    <div className="page mapas-pagina">
      <section className="page-header">
        <h2>Mapas y territorios</h2>
        <div className="mapas-header-controls">
          <div className="segmentado" role="tablist" aria-label="Vista del mapa">
            <button type="button" role="tab" aria-selected={view === 'editor'} onClick={() => setView('editor')}>Territorios</button>
            <button type="button" role="tab" aria-selected={view === 'cobertura'} onClick={() => setView('cobertura')}>Cobertura</button>
          </div>
        </div>
      </section>
      <div hidden={view !== 'editor'} className="editor-integrado-container">
        {canEditMap ? (
          <iframe
            className="editor-integrado-frame"
            src="/editor-manzanas.html"
            title="Editor completo de manzanas y territorios"
            allow="geolocation; screen-wake-lock"
          />
        ) : (
          <SanJuanMap initialTerritoryId={requestedTerritoryId} editingEnabled={false} />
        )}
      </div>
      {view === 'cobertura' ? <CoverageHeatmapPanel key={requestedTerritoryId ?? 'general'} initialTerritoryId={requestedTerritoryId} /> : null}
    </div>
  )
}
