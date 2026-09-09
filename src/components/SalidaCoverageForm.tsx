import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import L, { type LatLngTuple } from 'leaflet'
import { useAuth } from '../context/useAuth'
import { supabase } from '../lib/supabase'
import { readAllRows } from '../lib/readAllRows'
import { canReportSalidaCoverage, prepareSalidaCoverage } from '../lib/salidaCoverage'
import { linePoints } from '../lib/heatmapGeometry'
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
type Outing = { id?: string; driverId?: string; terrId?: string }
type MarkMode = 'manzana' | 'lado'

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

export function SalidaCoverageForm({ outing, queue }: { outing: Outing; queue: ReturnType<typeof useCoverageOutbox> }) {
  const { profile, contexto } = useAuth()
  const [editing, setEditing] = useState(false)
  const [sides, setSides] = useState<Side[]>([])
  const [blocks, setBlocks] = useState<Block[]>([])
  const [current, setCurrent] = useState<Record<string, CoverageState>>({})
  const [selected, setSelected] = useState<Set<string>>(() => new Set())
  const [state, setState] = useState<CoverageState>('recorrido')
  const [mode, setMode] = useState<MarkMode>('manzana')
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
  const pendingState = useMemo(
    () => Object.fromEntries(pending.map((item) => [item.lado_id, item.estado])) as Record<string, CoverageState>,
    [pending],
  )

  const sidesByBlock = useMemo(() => {
    const grouped = new Map<string, Side[]>()
    for (const side of sides) grouped.set(side.manzana_id, [...(grouped.get(side.manzana_id) ?? []), side])
    return grouped
  }, [sides])
  const selectedSides = useMemo(() => sides.filter((side) => selected.has(side.id)), [selected, sides])
  const selectedBlocks = useMemo(
    () => blocks.filter((block) => {
      const own = sidesByBlock.get(block.id) ?? []
      return own.some((side) => selected.has(side.id)) &&
        own.every((side) => selected.has(side.id) || (pendingState[side.id] ?? current[side.id]) === state)
    }).length,
    [blocks, current, pendingState, selected, sidesByBlock, state],
  )

  useEffect(() => {
    if (lastSent && queue.confirmed.some((item) => item.id === lastSent)) setConfirmed(true)
  }, [lastSent, queue.confirmed])

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

  const toggleSides = useCallback((ids: string[]) => {
    const changeable = ids.filter((id) => (pendingState[id] ?? current[id]) !== state)
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
  }, [current, pendingState, state])

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
      for (const side of sides) {
        const points = linePoints(side.geometry_geojson)
        if (!points) continue
        const drafted = selected.has(side.id)
        const queued = Boolean(pendingState[side.id])
        const complete = current[side.id] === 'recorrido'
        L.polyline(points, { color: '#000', opacity: 0, weight: 28 })
          .addTo(layer).on('click', () => toggleSides([side.id]))
        L.polyline(points, {
          color: drafted ? '#172018' : queued ? '#8a5b16' : complete ? '#236447' : '#6a6e77',
          weight: drafted || queued ? 8 : complete ? 7 : 5,
          opacity: 1,
          interactive: false,
        }).addTo(layer)
      }
    }
    map.fitBounds(L.latLngBounds(allPoints).pad(0.12), { animate: false, maxZoom: 17 })
    return () => { map.remove() }
  }, [blocks, current, editing, loading, mode, pendingState, selected, sides, sidesByBlock, toggleSides])

  if (!allowed) return null

  const closeEditor = () => {
    if (selected.size) {
      setError('Tenés cambios sin guardar. Guardalos o tocá “Descartar selección”.')
      return
    }
    setEditing(false)
    setError(null)
  }

  return <section className="module-detail-list recorrido-salida">
    <div className="cierre-paso-encabezado">
      <span className="cierre-paso-numero" aria-hidden="true">2</span>
      <div>
        <h3>¿Qué territorio recorrieron?</h3>
        <p>Marcá en el mapa las manzanas que hicieron. Si hicieron sólo una parte, pasá a “Por calles”.</p>
      </div>
    </div>
    {lastSent && <p role="status">{confirmed ? 'El servidor confirmó la última marca.' : 'Las marcas quedaron guardadas en este teléfono y esperan confirmación.'}</p>}
    {pending.length > 0 && <p className="recorrido-aviso" role="status">{pending.length} marca(s) esperando confirmación.
      <button type="button" className="boton secundario" disabled={queue.sending} onClick={() => void queue.retry()}><Icono nombre="rehacer" tamaño={18} />Reintentar</button></p>}
    {(error || queue.error) && <p className="nota" role="alert">{error || queue.error}</p>}
    {pending.filter((item) => item.lastError).map((item) => <p role="alert" key={item.id}>{item.lastError}</p>)}
    {!editing ? <button type="button" className="boton principal" disabled={busy} onClick={() => setEditing(true)}>
      <Icono nombre="marcar" tamaño={18} />Marcar en el mapa
    </button> : <div className="recorrido-editor">
      <div className="recorrido-modos" role="group" aria-label="Qué querés marcar">
        <button type="button" aria-pressed={mode === 'manzana'} onClick={() => { setMode('manzana'); setSelected(new Set()) }}>Manzanas completas</button>
        <button type="button" aria-pressed={mode === 'lado'} onClick={() => { setMode('lado'); setSelected(new Set()) }}>Por calles</button>
      </div>
      <div className="recorrido-estados" role="group" aria-label="Qué querés informar">
        {coverageChoices.map((choice) => <button type="button" key={choice.value} aria-pressed={state === choice.value}
          onClick={() => { setState(choice.value); setSelected(new Set()); setError(null) }}>{choice.label}</button>)}
      </div>
      {loading ? <div className="recorrido-mapa-cargando" role="status">Cargando el mapa…</div> : !sides.length || !blocks.length ?
        <p>No hay un dibujo disponible para informar el recorrido.</p> : <>
          <div ref={mapElement} className="recorrido-mapa" aria-label="Mapa para marcar el recorrido de la salida" />
          <div className="recorrido-leyenda" aria-label="Referencias del mapa">
            <span><i className="actual" />Ya informada</span>
            <span><i className="elegida" />Elegida ahora</span>
            <span><i className="enviando" />Esperando envío</span>
            <span><i className="pendiente" />Sin marcar</span>
          </div>
          <details className="recorrido-lista">
            <summary>Elegir sin usar el mapa</summary>
            <div>
              {mode === 'manzana' ? blocks.map((block) => {
                const own = sidesByBlock.get(block.id) ?? []
                const chosen = own.length > 0 && own.every((side) => selected.has(side.id))
                return <button type="button" key={block.id} aria-pressed={chosen}
                  disabled={!own.length || own.every((side) => (pendingState[side.id] ?? current[side.id]) === state)}
                  onClick={() => toggleSides(own.map((side) => side.id))}>
                  Manzana {String(block.label).toUpperCase()}
                </button>
              }) : sides.map((side) => <button type="button" key={side.id} aria-pressed={selected.has(side.id)}
                disabled={(pendingState[side.id] ?? current[side.id]) === state} onClick={() => toggleSides([side.id])}>
                Manzana {String(blocks.find((block) => block.id === side.manzana_id)?.label ?? '').toUpperCase()} · calle {side.orden + 1}
              </button>)}
            </div>
          </details>
          <p className="recorrido-resumen" aria-live="polite">
            {selectedSides.length
              ? `${selectedBlocks ? `${selectedBlocks} manzana${selectedBlocks === 1 ? '' : 's'} · ` : ''}${selectedSides.length} calle${selectedSides.length === 1 ? '' : 's'} seleccionada${selectedSides.length === 1 ? '' : 's'}`
              : `Tocá ${mode === 'manzana' ? 'una manzana' : 'las calles'} en el mapa.`}
          </p>
        </>}
      <div className="recorrido-acciones">
        <button type="button" className="boton secundario" disabled={!selected.size || busy} onClick={() => { setSelected(new Set()); setError(null) }}>
          <Icono nombre="cerrar" tamaño={18} />Descartar selección
        </button>
        <button type="button" className="boton principal" disabled={busy || !selectedSides.length || !!queue.error} onClick={async () => {
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
          } catch (failure) {
            setSelected(remaining)
            setError(failure instanceof Error ? failure.message : 'No pudimos conservar todas las marcas.')
          } finally {
            running.current = false
            setBusy(false)
          }
        }}><Icono nombre="guardar" tamaño={18} />{busy ? 'Guardando…' : `Guardar ${selectedSides.length || ''} ${selectedSides.length === 1 ? 'calle' : 'calles'}`}</button>
      </div>
      <div className="recorrido-editor-pie">
        <button type="button" className="boton texto" disabled={loading || busy} onClick={() => setRevision((value) => value + 1)}><Icono nombre="rehacer" tamaño={18} />Actualizar mapa</button>
        <button type="button" className="boton texto" disabled={busy} onClick={closeEditor}><Icono nombre="completo" tamaño={18} />Terminar</button>
      </div>
    </div>}
  </section>
}
