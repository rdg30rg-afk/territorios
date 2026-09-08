import { useEffect, useRef, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { SanJuanMap } from '../components/SanJuanMap'
import { CoverageHeatmapPanel } from '../components/CoverageHeatmapPanel'
import { useAuth } from '../context/useAuth'
import { canOpenAdminPanel } from '../lib/access'
import { supabase } from '../lib/supabase'
import '../styles/mapas-pagina.css'

/** Keep the existing editor document alive while switching tabs. */
export function MapasPage() {
  const { profile, contexto } = useAuth()
  const [searchParams] = useSearchParams()
  const requestedTerritoryId = searchParams.get('territorio')?.trim() || null
  const [view, setView] = useState<'editor' | 'cobertura'>('editor')
  const canEditMap = canOpenAdminPanel(profile, contexto)
  const [editorHtml, setEditorHtml] = useState<string | null>(null)
  const [editorError, setEditorError] = useState<string | null>(null)
  const editorFrameRef = useRef<HTMLIFrameElement>(null)

  useEffect(() => {
    if (!supabase) return
    const authClient = supabase
    const sendSession = async () => {
      const { data } = await authClient.auth.getSession()
      editorFrameRef.current?.contentWindow?.postMessage({
        type: 'territorios:editor:session',
        session: data.session ? { accessToken: data.session.access_token, expiresAt: data.session.expires_at } : null,
      }, window.location.origin)
    }
    const receiveRequest = (event: MessageEvent) => {
      if (event.origin === window.location.origin && event.source === editorFrameRef.current?.contentWindow && event.data?.type === 'territorios:editor:request-session') void sendSession()
    }
    window.addEventListener('message', receiveRequest)
    const { data: authListener } = authClient.auth.onAuthStateChange(() => { void sendSession() })
    return () => { window.removeEventListener('message', receiveRequest); authListener.subscription.unsubscribe() }
  }, [])

  useEffect(() => {
    if (!canEditMap || editorHtml) return
    const abortController = new AbortController()
    fetch('/editor-manzanas.html', { cache: 'no-store', signal: abortController.signal })
      .then(async (response) => {
        if (!response.ok) throw new Error(`HTTP ${response.status}`)
        const html = await response.text()
        if (!html.includes('<title>Editor de manzanas')) throw new Error('respuesta inesperada')
        setEditorHtml(html)
      })
      .catch((error: unknown) => {
        if (error instanceof DOMException && error.name === 'AbortError') return
        setEditorError(error instanceof Error ? error.message : 'No se pudo abrir el editor.')
      })
    return () => abortController.abort()
  }, [canEditMap, editorHtml])
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
          editorHtml ? (
            <iframe ref={editorFrameRef} className="editor-integrado-frame" srcDoc={editorHtml} title="Editor completo de manzanas y territorios" allow="geolocation; screen-wake-lock" />
          ) : (
            <div className={editorError ? 'form-feedback error' : 'map-editing-notice'} role="status">
              {editorError ? `No se pudo abrir el editor: ${editorError}` : 'Abriendo el editor completo…'}
            </div>
          )
        ) : (
          <SanJuanMap initialTerritoryId={requestedTerritoryId} editingEnabled={false} />
        )}
      </div>
      {view === 'cobertura' ? <CoverageHeatmapPanel key={requestedTerritoryId ?? 'general'} initialTerritoryId={requestedTerritoryId} /> : null}
    </div>
  )
}
