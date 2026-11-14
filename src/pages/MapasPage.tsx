import { useCallback, useEffect, useRef, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { SanJuanMap } from '../components/SanJuanMap'
import { CoverageHeatmapPanel } from '../components/CoverageHeatmapPanel'
import { useAuth } from '../context/useAuth'
import { canOpenAdminPanel } from '../lib/access'
import { supabase } from '../lib/supabase'
import { modoSimulacion } from '../lib/simulacion'
import { Icono } from '../components/Icono'
import { Modal } from '../components/Modal'
import '../styles/mapas-pagina.css'

/**
 * /mapas SIEMPRE abre una vista de solo lectura (SanJuanMap, sin escritura).
 * El editor completo (iframe) recién se monta cuando un administrador toca
 * «Editar el mapa» Y confirma el diálogo. No hay parámetro de la URL que
 * salte esos dos pasos: `?editar=1` no se lee.
 */
export function MapasPage() {
  const { profile, contexto } = useAuth()
  const [searchParams, setSearchParams] = useSearchParams()
  const requestedTerritoryId = searchParams.get('territorio')?.trim() || null
  const [view, setView] = useState<'editor' | 'cobertura'>(
    searchParams.get('vista') === 'cobertura' ? 'cobertura' : 'editor',
  )
  // La pestaña queda en la URL: se puede recargar o compartir el enlace.
  const cambiarVista = (siguiente: 'editor' | 'cobertura') => {
    // Cambiar de pestaña también es salir de la edición: se avisa si hay algo sin guardar.
    if (enEdicion && siguiente === 'cobertura') { pedirSalida({ vista: 'cobertura' }); return }
    setView(siguiente)
    const params = new URLSearchParams(searchParams)
    if (siguiente === 'cobertura') params.set('vista', 'cobertura')
    else params.delete('vista')
    setSearchParams(params, { replace: true })
  }
  const navigate = useNavigate()
  const canEditMap = canOpenAdminPanel(profile, contexto)
  const [editando, setEditando] = useState(false)
  const [confirmandoEntrada, setConfirmandoEntrada] = useState(false)
  const [sinGuardar, setSinGuardar] = useState(false)
  const [salidaPendiente, setSalidaPendiente] = useState<{ destino?: string; vista?: 'cobertura' } | null>(null)
  // Sin permiso no hay edición, aunque el estado diga otra cosa.
  const enEdicion = editando && canEditMap
  const botonCancelarEntrada = useRef<HTMLButtonElement>(null)
  const botonSeguirEditando = useRef<HTMLButtonElement>(null)
  const cerrarConfirmacionEntrada = useCallback(() => setConfirmandoEntrada(false), [])
  const cerrarAvisoSalida = useCallback(() => setSalidaPendiente(null), [])

  const terminarEdicion = (destino: { destino?: string; vista?: 'cobertura' } | null) => {
    setEditando(false)
    setSinGuardar(false)
    setEditorHtml(null)
    setEditorError(null)
    setSalidaPendiente(null)
    if (destino?.vista) cambiarVistaDirecto(destino.vista)
    if (destino?.destino) navigate(destino.destino)
  }
  function pedirSalida(destino: { destino?: string; vista?: 'cobertura' } | null) {
    if (sinGuardar) setSalidaPendiente(destino ?? {})
    else terminarEdicion(destino)
  }
  function cambiarVistaDirecto(siguiente: 'editor' | 'cobertura') {
    setView(siguiente)
    const params = new URLSearchParams(searchParams)
    if (siguiente === 'cobertura') params.set('vista', 'cobertura')
    else params.delete('vista')
    setSearchParams(params, { replace: true })
  }
  const [editorHtml, setEditorHtml] = useState<string | null>(null)
  const [editorError, setEditorError] = useState<string | null>(null)
  const editorFrameRef = useRef<HTMLIFrameElement>(null)

  useEffect(() => {
    if (!supabase) return
    const authClient = supabase
    const sendSession = async () => {
      const { data } = await authClient.auth.getSession()
      // Un iframe srcDoc tiene un origen opaco ("null"). El frame es el que
      // creó esta app y se valida abajo por referencia; por eso la respuesta
      // usa * para que también llegue a ese origen opaco.
      editorFrameRef.current?.contentWindow?.postMessage({
        type: 'territorios:editor:session',
        session: data.session ? { accessToken: data.session.access_token, expiresAt: data.session.expires_at } : null,
      }, '*')
    }
    const receiveRequest = (event: MessageEvent) => {
      const originIsExpected = event.origin === window.location.origin || event.origin === 'null'
      if (originIsExpected && event.source === editorFrameRef.current?.contentWindow && event.data?.type === 'territorios:editor:request-session') void sendSession()
    }
    window.addEventListener('message', receiveRequest)
    const { data: authListener } = authClient.auth.onAuthStateChange(() => { void sendSession() })
    return () => { window.removeEventListener('message', receiveRequest); authListener.subscription.unsubscribe() }
  }, [])

  // El editor avisa si tiene trabajo sin guardar (postMessage mínimo).
  useEffect(() => {
    const recibir = (event: MessageEvent) => {
      const origenEsperado = event.origin === window.location.origin || event.origin === 'null'
      if (!origenEsperado || event.source !== editorFrameRef.current?.contentWindow) return
      if (event.data?.type === 'territorios:editor:cambios') setSinGuardar(event.data.sinGuardar === true)
    }
    window.addEventListener('message', recibir)
    return () => window.removeEventListener('message', recibir)
  }, [])

  // Salir por el menú lateral (o cualquier enlace de la app) con cambios sin guardar.
  useEffect(() => {
    if (!enEdicion || !sinGuardar) return
    const alTocarEnlace = (event: MouseEvent) => {
      if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return
      const enlace = (event.target as Element | null)?.closest?.('a[href]') as HTMLAnchorElement | null
      if (!enlace || (enlace.target && enlace.target !== '_self') || enlace.hasAttribute('download')) return
      const url = new URL(enlace.href, window.location.href)
      if (url.origin !== window.location.origin) return
      if (url.pathname === window.location.pathname && url.search === window.location.search) return
      event.preventDefault()
      event.stopPropagation()
      setSalidaPendiente({ destino: `${url.pathname}${url.search}${url.hash}` })
    }
    document.addEventListener('click', alTocarEnlace, true)
    return () => document.removeEventListener('click', alTocarEnlace, true)
  }, [enEdicion, sinGuardar])

  // El foco inicial de cada diálogo va en el botón seguro.
  useEffect(() => { if (confirmandoEntrada) botonCancelarEntrada.current?.focus() }, [confirmandoEntrada])
  useEffect(() => { if (salidaPendiente) botonSeguirEditando.current?.focus() }, [salidaPendiente])

  useEffect(() => {
    // El editor corre en su propio marco, con su propio fetch: el candado de
    // la simulación no lo alcanza, así que ahí directamente no se abre.
    if (!enEdicion || editorHtml || modoSimulacion) return
    const abortController = new AbortController()
    // El paquete de Estracom se construye con modo `development` para apuntar
    // a Supabase DEV, pero sigue siendo una app publicada. La decisión debe
    // depender del host que la está sirviendo, no del modo de Vite: la ruta
    // versionada evita que una PWA anterior reutilice el HTML del editor.
    const hostLocal = ['localhost', '127.0.0.1', '[::1]'].includes(window.location.hostname)
    const editorPath = hostLocal ? 'editor-manzanas.html' : 'editor-manzanas-embedded.html'
    fetch(`/${editorPath}?embed-session-bridge=2`, { cache: 'no-store', signal: abortController.signal })
      .then(async (response) => {
        if (!response.ok) throw new Error(`HTTP ${response.status}`)
        const html = await response.text()
        if (!html.includes('<title>Editor de manzanas')) throw new Error('respuesta inesperada')
        const bridgedHtml = html.replace(
          '<head>',
          `<head><script>window.__TERRITORIOS_APP_ORIGIN__ = ${JSON.stringify(window.location.origin)}</script>`,
        )
        setEditorHtml(bridgedHtml)
      })
      .catch((error: unknown) => {
        if (error instanceof DOMException && error.name === 'AbortError') return
        setEditorError(error instanceof Error ? error.message : 'No se pudo abrir el editor.')
      })
    return () => abortController.abort()
  }, [enEdicion, editorHtml])
  return (
    <div className="page mapas-pagina">
      <section className="page-header">
        <h2>Mapas y territorios</h2>
        <div className="mapas-header-controls">
          <div className="segmentado" role="tablist" aria-label="Vista del mapa">
            <button type="button" role="tab" aria-selected={view === 'editor'} onClick={() => cambiarVista('editor')}>
              <Icono nombre="territorios" tamaño={18} />
              Territorios
            </button>
            <button type="button" role="tab" aria-selected={view === 'cobertura'} onClick={() => cambiarVista('cobertura')}>
              <Icono nombre="cobertura" tamaño={18} />
              Cobertura
            </button>
          </div>
          {canEditMap && view === 'editor' && !enEdicion ? (
            <button type="button" className="secondary-button" onClick={() => setConfirmandoEntrada(true)}>
              Editar el mapa
            </button>
          ) : null}
        </div>
      </section>
      {enEdicion && view === 'editor' ? (
        <div className="form-feedback mapas-franja-edicion" role="status">
          <strong>Estás editando el mapa</strong>
          <button type="button" className="secondary-button" onClick={() => pedirSalida(null)}>
            Salir de la edición
          </button>
        </div>
      ) : null}
      <div hidden={view !== 'editor'} className="editor-integrado-container">
        {enEdicion ? (
          editorHtml ? (
            <iframe ref={editorFrameRef} className="editor-integrado-frame" srcDoc={editorHtml} title="Editor completo de manzanas y territorios" allow="geolocation; screen-wake-lock" />
          ) : (
            <div className={editorError ? 'form-feedback error' : 'map-editing-notice'} role="status">
              {modoSimulacion
                ? 'El editor de territorios queda apagado en modo simulación. La pestaña Cobertura sí funciona.'
                : editorError ? `No se pudo abrir el editor: ${editorError}` : 'Abriendo el editor completo…'}
            </div>
          )
        ) : (
          // Solo se monta con la pestaña a la vista: un mapa Leaflet que nace
          // dentro de un contenedor oculto queda con tamaño 0 y descentrado.
          view === 'editor' ? <SanJuanMap initialTerritoryId={requestedTerritoryId} editingEnabled={false} /> : null
        )}
      </div>
      {view === 'cobertura' ? <CoverageHeatmapPanel key={requestedTerritoryId ?? 'general'} initialTerritoryId={requestedTerritoryId} /> : null}
      <Modal
        abierto={confirmandoEntrada}
        alCerrar={cerrarConfirmacionEntrada}
        titulo="Editar el mapa"
        bajada="Vas a trabajar sobre el borrador compartido. Lo que publiques cambia el mapa que usan los hermanos."
      >
        <div className="form-actions">
          <button ref={botonCancelarEntrada} type="button" className="secondary-button" onClick={cerrarConfirmacionEntrada}>
            Cancelar
          </button>
          <button type="button" className="primary-button" onClick={() => { setConfirmandoEntrada(false); if (canEditMap) setEditando(true) }}>
            Sí, editar el mapa
          </button>
        </div>
      </Modal>
      <Modal
        abierto={salidaPendiente !== null}
        alCerrar={cerrarAvisoSalida}
        titulo="Hay cambios sin guardar"
        bajada="Lo último que hiciste todavía no llegó al borrador. Si salís ahora, se pierde."
      >
        <div className="form-actions">
          <button ref={botonSeguirEditando} type="button" className="primary-button" onClick={cerrarAvisoSalida}>
            Seguir editando
          </button>
          <button type="button" className="secondary-button" onClick={() => terminarEdicion(salidaPendiente)}>
            Salir sin guardar
          </button>
        </div>
      </Modal>
    </div>
  )
}
