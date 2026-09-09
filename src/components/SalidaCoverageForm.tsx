import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import L, { type LatLngTuple } from 'leaflet'
import { useAuth } from '../context/useAuth'
import { supabase } from '../lib/supabase'
import { readAllRows } from '../lib/readAllRows'
import { canReportSalidaCoverage, prepareSalidaCoverage } from '../lib/salidaCoverage'
import { linePoints } from '../lib/heatmapGeometry'
import { nearestPath } from '../lib/recorridoGesture'
import type { CoverageState } from '../lib/coverageSummary'
import { ponerFondo } from '../lib/fondoMapa'
import type { useCoverageOutbox } from '../lib/useCoverageOutbox'
import { Icono } from './Icono'

type Side = {
  id: string
  manzana_id: string
  territory_id: string
  orden: number
  geometry_version: number
  vigente_hasta: null
  geometry_geojson: unknown
}
type Block = { id: string; label: string; geometry_geojson: unknown }
type CoverageRow = { lado_id: string; estado: CoverageState }
export type CoverageOuting = { id?: string; driverId?: string; terrId?: string }
type MarkMode = 'manzana' | 'lado'

type SalidaCoverageFormProps = {
  outing: CoverageOuting
  queue: ReturnType<typeof useCoverageOutbox>
  autoOpen?: boolean
  autoSelectAll?: boolean
  onSaved?: () => void
  onCancel?: () => void
  onDirtyChange?: (dirty: boolean) => void
}

const coverageChoices: Array<{ value: CoverageState; label: string }> = [
  { value: 'recorrido', label: 'Recorrida' },
  { value: 'revisitar', label: 'Para volver' },
  { value: 'no_accesible', label: 'No accesible' },
  { value: 'sin_dato', label: 'Quitar marca' },
]

function polygonPoints(geometry: unknown): LatLngTuple[] | null {
  if (!geometry || typeof geometry !== 'object') return null
  const value = geometry as { type?: string; coordinates?: unknown }
  const ring = value.type === 'Polygon' && Array.isArray(value.coordinates)
    ? value.coordinates[0]
    : value.type === 'MultiPolygon' && Array.isArray(value.coordinates)
      ? value.coordinates[0]?.[0]
      : null
  if (!Array.isArray(ring) || ring.length < 3) return null
  const points: LatLngTuple[] = []
  for (const coordinate of ring) {
    if (!Array.isArray(coordinate) || coordinate.length < 2 ||
      !Number.isFinite(coordinate[0]) || !Number.isFinite(coordinate[1])) return null
    points.push([coordinate[1], coordinate[0]])
  }
  return points
}

export function SalidaCoverageForm({
  outing,
  queue,
  autoOpen = false,
  autoSelectAll = false,
  onSaved,
  onCancel,
  onDirtyChange,
}: SalidaCoverageFormProps) {
  const { profile, contexto } = useAuth()
  const [internalEditing, setInternalEditing] = useState(false)
  const editing = autoOpen || internalEditing
  const [sides, setSides] = useState<Side[]>([])
  const [blocks, setBlocks] = useState<Block[]>([])
  const [current, setCurrent] = useState<Record<string, CoverageState>>({})
  const [selected, setSelected] = useState<Set<string>>(() => new Set())
  const [state, setState] = useState<CoverageState>('recorrido')
  const [mode, setMode] = useState<MarkMode>('lado')
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [revision, setRevision] = useState(0)
  const [busy, setBusy] = useState(false)
  const [lastSent, setLastSent] = useState<string | null>(null)
  const [confirmed, setConfirmed] = useState(false)
  const running = useRef(false)
  const mapElement = useRef<HTMLDivElement>(null)
  const actor = profile ? { ...profile, puede_informar_salidas: contexto?.puede_informar_salidas } : null
  const allowed = canReportSalidaCoverage(actor, outing)
  const pending = useMemo(
    () => queue.events.filter((item) => item.salida_id === outing.id),
    [outing.id, queue.events],
  )
  const waiting = useMemo(() => pending.filter((item) => item.status !== 'error'), [pending])
  const pendingState = useMemo(
    () => Object.fromEntries(waiting.map((item) => [item.lado_id, item.estado])) as Record<string, CoverageState>,
    [waiting],
  )

  const sidesByBlock = useMemo(() => {
    const grouped = new Map<string, Side[]>()
    for (const side of sides) grouped.set(side.manzana_id, [...(grouped.get(side.manzana_id) ?? []), side])
    return grouped
  }, [sides])
  const selectedSides = useMemo(() => sides.filter((side) => selected.has(side.id)), [selected, sides])
  const selectedBlockLabels = useMemo(
    () => blocks.filter((block) => {
      const own = sidesByBlock.get(block.id) ?? []
      return own.length > 0 && own.every((side) => selected.has(side.id))
    }).map((block) => String(block.label).toUpperCase()),
    [blocks, selected, sidesByBlock],
  )

  useEffect(() => {
    if (lastSent && queue.confirmed.some((item) => item.id === lastSent)) setConfirmed(true)
  }, [lastSent, queue.confirmed])

  useEffect(() => onDirtyChange?.(selected.size > 0), [onDirtyChange, selected.size])

  useEffect(() => {
    if (!editing || !allowed || !supabase || !outing.terrId) return
    let live = true
    setLoading(true)
    setError(null)
    setSides([])
    setBlocks([])
    setCurrent({})
    setSelected(new Set())
    void Promise.all([
      readAllRows<Side>((from, to) => supabase!.from('manzana_lados')
        .select('id, manzana_id, territory_id, orden, geometry_version, vigente_hasta, geometry_geojson')
        .eq('territory_id', outing.terrId!).is('vigente_hasta', null).order('manzana_id').order('orden').order('id').range(from, to)),
      readAllRows<Block>((from, to) => supabase!.from('territorio_manzanas')
        .select('id, label, geometry_geojson').eq('territory_id', outing.terrId!).is('vigente_hasta', null).order('label').order('id').range(from, to)),
      readAllRows<CoverageRow>((from, to) => supabase!.from('cobertura_lado_actual')
        .select('lado_id, estado').eq('territory_id', outing.terrId!).order('lado_id').range(from, to)),
    ]).then(([loadedSides, loadedBlocks, coverage]) => {
      if (!live) return
      setSides(loadedSides)
      setBlocks(loadedBlocks)
      setCurrent(Object.fromEntries(coverage.map((item) => [item.lado_id, item.estado])))
    }).catch(() => {
      if (live) setError('No pudimos cargar el mapa y su avance. Tocá Actualizar para volver a intentar.')
    }).finally(() => {
      if (live) setLoading(false)
    })
    return () => { live = false }
  }, [editing, allowed, outing.terrId, revision, queue.remoteRevision])

  useEffect(() => {
    if (autoSelectAll && sides.length) setSelected(new Set(sides.map((side) => side.id)))
  }, [autoSelectAll, sides])

  const toggleSides = useCallback((ids: string[]) => {
    const changeable = ids.filter((id) => pendingState[id] !== state)
    if (!changeable.length) return
    setSelected((before) => {
      const next = new Set(before)
      const allSelected = changeable.every((id) => next.has(id))
      for (const id of changeable) {
        if (allSelected) next.delete(id)
        else next.add(id)
      }
      return next
    })
  }, [pendingState, state])

  useEffect(() => {
    if (!editing || !mapElement.current || loading || !blocks.length) return
    const allPoints = blocks.flatMap((block) => polygonPoints(block.geometry_geojson) ?? [])
    if (!allPoints.length) return
    const map = L.map(mapElement.current, {
      zoomControl: false,
      dragging: false,
      scrollWheelZoom: false,
      doubleClickZoom: false,
      boxZoom: false,
      keyboard: false,
      touchZoom: false,
      zoomAnimation: false,
    })
    map.attributionControl.setPrefix(false)
    ponerFondo(L, map)
    map.getPane('overlayPane')!.style.mixBlendMode = 'multiply'
    const layer = L.layerGroup().addTo(map)
    for (const block of blocks) {
      const points = polygonPoints(block.geometry_geojson)
      if (!points) continue
      const own = sidesByBlock.get(block.id) ?? []
      const drafted = own.some((side) => selected.has(side.id))
      const queued = own.some((side) => pendingState[side.id])
      const complete = own.length > 0 && own.every((side) => current[side.id] === 'recorrido')
      const polygon = L.polygon(points, {
        color: drafted ? '#172018' : queued ? '#8a5b16' : complete ? '#236447' : '#6a6e77',
        weight: drafted || queued ? 4 : 2,
        fillColor: drafted ? '#c8ef4f' : queued ? '#f4cb72' : complete ? '#8bc5a4' : '#f4f0e9',
        fillOpacity: drafted ? 0.66 : queued ? 0.58 : complete ? 0.48 : 0.24,
      }).addTo(layer)
      polygon.bindTooltip(String(block.label).toUpperCase(), {
        permanent: true,
        direction: 'center',
        className: 'recorrido-mapa-etiqueta',
      })
      if (mode === 'manzana') polygon.on('click', () => toggleSides(own.map((side) => side.id)))
    }
    if (mode === 'lado') {
      const visibleLines = new Map<string, L.Polyline>()
      for (const side of sides) {
        const points = linePoints(side.geometry_geojson)
        if (!points) continue
        const drafted = selected.has(side.id)
        const queued = Boolean(pendingState[side.id])
        const complete = current[side.id] === 'recorrido'
        L.polyline(points, { color: '#000', opacity: 0, weight: 28 })
          .addTo(layer).on('click', () => toggleSides([side.id]))
        const visible = L.polyline(points, {
          color: drafted ? '#172018' : queued ? '#8a5b16' : complete ? '#236447' : '#6a6e77',
          weight: drafted || queued ? 8 : complete ? 7 : 5,
          opacity: 1,
          interactive: false,
        }).addTo(layer)
        visibleLines.set(side.id, visible)
      }
      ;(map as L.Map & { __recorridoLines?: Map<string, L.Polyline> }).__recorridoLines = visibleLines
    }
    map.fitBounds(L.latLngBounds(allPoints).pad(0.12), { animate: false, maxZoom: 17 })
    let drawing = false
    let stroke = new Set(selected)
    const markNearest = (event: PointerEvent) => {
      const bounds = mapElement.current?.getBoundingClientRect()
      if (!bounds) return
      const paths = sides.flatMap((side) => {
        const points = linePoints(side.geometry_geojson)
        if (!points) return []
        return [{
          id: side.id,
          points: points.map((point) => {
            const screen = map.latLngToContainerPoint(L.latLng(point[0], point[1]))
            return { x: screen.x, y: screen.y }
          }),
        }]
      })
      const nearest = nearestPath({ x: event.clientX - bounds.left, y: event.clientY - bounds.top }, paths)
      if (nearest && pendingState[nearest] !== state) {
        stroke.add(nearest)
        ;(map as L.Map & { __recorridoLines?: Map<string, L.Polyline> }).__recorridoLines
          ?.get(nearest)?.setStyle({ color: '#172018', weight: 8 })
      }
    }
    const startDrawing = (event: PointerEvent) => {
      if (mode !== 'lado') return
      drawing = true
      stroke = new Set(selected)
      mapElement.current?.setPointerCapture?.(event.pointerId)
      markNearest(event)
      event.preventDefault()
    }
    const draw = (event: PointerEvent) => {
      if (!drawing || mode !== 'lado') return
      markNearest(event)
      event.preventDefault()
    }
    const stopDrawing = () => {
      if (!drawing) return
      drawing = false
      setSelected(new Set(stroke))
    }
    const element = mapElement.current
    element?.addEventListener('pointerdown', startDrawing)
    element?.addEventListener('pointermove', draw)
    element?.addEventListener('pointerup', stopDrawing)
    element?.addEventListener('pointercancel', stopDrawing)
    return () => {
      element?.removeEventListener('pointerdown', startDrawing)
      element?.removeEventListener('pointermove', draw)
      element?.removeEventListener('pointerup', stopDrawing)
      element?.removeEventListener('pointercancel', stopDrawing)
      map.remove()
    }
  }, [blocks, current, editing, loading, mode, pendingState, selected, sides, sidesByBlock, state, toggleSides])

  if (!allowed) return null

  const closeEditor = () => {
    if (selected.size) {
      setError('Tenés cambios sin guardar. Guardalos o tocá “Descartar selección”.')
      return
    }
    setInternalEditing(false)
    setError(null)
    onCancel?.()
  }

  return <section className={`module-detail-list recorrido-salida${autoOpen ? ' recorrido-pantalla' : ''}`}>
    {!autoOpen && <div className="cierre-paso-encabezado">
      <span className="cierre-paso-numero" aria-hidden="true">2</span>
      <div>
        <h3>¿Qué territorio recorrieron?</h3>
        <p>Marcá las manzanas completas o dibujá con el dedo por las calles recorridas.</p>
      </div>
    </div>}
    {lastSent && <p role="status">{confirmed ? 'El servidor confirmó la última marca.' : 'Las marcas quedaron guardadas en este teléfono y esperan confirmación.'}</p>}
    {waiting.length > 0 && <p className="recorrido-aviso" role="status">{waiting.length} marca(s) esperando confirmación.
      <button type="button" className="boton secundario" disabled={queue.sending} onClick={() => void queue.retry()}><Icono nombre="rehacer" tamaño={18} />Reintentar</button></p>}
    {(error || queue.error) && <p className="nota" role="alert">{error || queue.error}</p>}
    {pending.filter((item) => item.lastError).map((item) => <p role="alert" key={item.id}>{item.lastError}</p>)}
    {!editing ? <button type="button" className="boton principal" disabled={busy} onClick={() => setInternalEditing(true)}>
      <Icono nombre="marcar" tamaño={18} />Marcar en el mapa
    </button> : <div className="recorrido-editor">
      {!autoSelectAll && <div className="recorrido-modos" role="group" aria-label="Cómo querés marcar">
        <button type="button" aria-pressed={mode === 'lado'} onClick={() => { setMode('lado'); setSelected(new Set()) }}>Dibujar con el dedo</button>
        <button type="button" aria-pressed={mode === 'manzana'} onClick={() => { setMode('manzana'); setSelected(new Set()) }}>Elegir manzanas</button>
      </div>}
      {!autoSelectAll && <div className="recorrido-estados" role="group" aria-label="Qué querés informar">
        {coverageChoices.map((choice) => <button type="button" key={choice.value} aria-pressed={state === choice.value}
          onClick={() => { setState(choice.value); setSelected(new Set()); setError(null) }}>{choice.label}</button>)}
      </div>}
      {loading ? <div className="recorrido-mapa-cargando" role="status">Cargando el mapa…</div> : !sides.length || !blocks.length ?
        <p>No hay un dibujo disponible para informar el recorrido.</p> : <>
          <div ref={mapElement} className={`recorrido-mapa${mode === 'lado' ? ' dibujando' : ''}`} aria-label="Mapa para marcar el recorrido de la salida" />
          <div className="recorrido-leyenda" aria-label="Referencias del mapa">
            <span><i className="actual" />Ya informada</span>
            <span><i className="elegida" />Elegida ahora</span>
            <span><i className="enviando" />Esperando envío</span>
            <span><i className="pendiente" />Sin marcar</span>
          </div>
          {!autoSelectAll && <details className="recorrido-lista" open>
            <summary>Manzanas completas por letra</summary>
            <div>
              {blocks.map((block) => {
                const own = sidesByBlock.get(block.id) ?? []
                const chosen = own.length > 0 && own.every((side) => selected.has(side.id))
                return <button type="button" key={block.id} aria-pressed={chosen}
                  disabled={!own.length || own.every((side) => pendingState[side.id] === state)}
                  onClick={() => toggleSides(own.map((side) => side.id))}>
                  Manzana {String(block.label).toUpperCase()}
                </button>
              })}
            </div>
          </details>}
          <p className="recorrido-resumen" aria-live="polite">
            {selectedSides.length
              ? `${selectedBlockLabels.length ? `Manzana${selectedBlockLabels.length === 1 ? '' : 's'} ${selectedBlockLabels.join(', ')} completa${selectedBlockLabels.length === 1 ? '' : 's'} · ` : ''}${selectedSides.length} lado${selectedSides.length === 1 ? '' : 's'} marcado${selectedSides.length === 1 ? '' : 's'}`
              : mode === 'manzana' ? 'Tocá las letras en el mapa o elegilas abajo.' : 'Pasá el dedo por los lados que recorrieron.'}
          </p>
        </>}
      <div className="recorrido-acciones">
        <button type="button" className="boton secundario" disabled={!selected.size || busy} onClick={() => { setSelected(new Set()); setError(null) }}>
          <Icono nombre="cerrar" tamaño={18} />Descartar selección
        </button>
        <button type="button" className="boton principal" disabled={busy || !selectedSides.length} onClick={async () => {
          if (!selectedSides.length || running.current) return
          running.current = true
          setBusy(true)
          setError(null)
          const remaining = new Set(selected)
          try {
            for (const side of selectedSides) {
              const saved = await queue.enqueue(prepareSalidaCoverage(actor, outing, side, state))
              remaining.delete(side.id)
              setLastSent(saved.id)
              setConfirmed(false)
            }
            setSelected(new Set())
            void queue.sync()
            onSaved?.()
          } catch (failure) {
            setSelected(remaining)
            setError(failure instanceof Error ? failure.message : 'No pudimos conservar todas las marcas.')
          } finally {
            running.current = false
            setBusy(false)
          }
        }}><Icono nombre="guardar" tamaño={18} />{busy ? 'Guardando…' : autoOpen ? 'Continuar' : `Guardar ${selectedSides.length || ''} ${selectedSides.length === 1 ? 'lado' : 'lados'}`}</button>
      </div>
      <div className="recorrido-editor-pie">
        <button type="button" className="boton texto" disabled={loading || busy} onClick={() => setRevision((value) => value + 1)}><Icono nombre="rehacer" tamaño={18} />Actualizar mapa</button>
        <button type="button" className="boton texto" disabled={busy} onClick={closeEditor}><Icono nombre="cerrar" tamaño={18} />Cancelar</button>
      </div>
    </div>}
  </section>
}
