import { useCallback, useEffect, useReducer, useRef, useState } from 'react'
import { Desplegable } from '../components/Desplegable'
import { useAuth } from '../context/useAuth'
import { supabase } from '../lib/supabase'
import { Icono } from '../components/Icono'
import '../styles/importacion.css'

/**
 * REVISION DE LO IMPORTADO
 *
 * El ETL dejo las 3.346 filas del Excel en el staging. Las filas con
 * evidencia suficiente ya pueden tener un destino historico; las que no
 * la tienen quedan como cierres auditables y no se ofrecen como datos
 * operativos. El origen tiene formulas y filas donde la casilla dice una
 * cosa y la observacion escrita dice otra.
 *
 * Esta pantalla es ese paso. Y tiene una regla que la define:
 *
 *   LA PERSONA NO RE-TIPEA EL DATO. Deja registrada su DECISION.
 *
 * El ETL es el unico que sabe leer la forma del Excel. Si acá se
 * permitiera corregir valores a mano, habria dos lugares que interpretan
 * el archivo y se irian separando. Lo que se guarda es
 * `normalizado.decision_humana`, y al aplicar, el ETL vuelve a leer la
 * fila y usa esa decision en lugar del dato ambiguo.
 */

type Importacion = {
  id: string
  archivo: string
  drive_id: string | null
  nota: string | null
  estado: 'en_curso' | 'aplicada' | 'revertida'
  corrida_at: string
}

type Celda = {
  columna: string
  valor: unknown
  tipo?: string
  formula?: unknown
  valor_calculado?: unknown
  hipervinculo?: string
}

type Bruto = {
  hoja?: string
  fila?: number
  celdas?: Celda[]
  errores_formula?: string[]
}

type Registro = {
  id: string
  pestania: string
  fila: number
  rango: string | null
  tipo: string
  bruto: Bruto | null
  normalizado: Record<string, unknown> | null
  estado: 'pendiente' | 'aplicado' | 'conflicto' | 'descartado'
  motivo: string | null
  destino_tabla: string | null
  destino_tipo: string | null
  revisado_at: string | null
}

/** Qué decisión tiene sentido pedir según lo que sea la fila. */
const DECISIONES: Record<string, { campo: string; opciones: [string, string][] }> = {
  salida: {
    campo: 'estado',
    opciones: [
      ['realizada', 'Se hizo'],
      ['parcial', 'Se hizo a medias'],
      ['no_realizada', 'No se hizo'],
      ['cancelada', 'Se suspendió'],
      ['sin_dato', 'No se puede saber'],
    ],
  },
  historial_territorio: {
    campo: 'clase',
    opciones: [
      ['trabajado', 'Se trabajó'],
      ['bloqueo', 'Es un bloqueo'],
      ['excepcion', 'Es una excepción'],
      ['sin_dato', 'No se puede saber'],
    ],
  },
}

type Resumen = {
  total: number
  porEstado: Record<string, number>
  porTipo: Record<string, number>
  sinEvidencia: number
}

const ESTADOS = ['pendiente', 'aplicado', 'conflicto', 'descartado'] as const
const TIPOS = [
  'salida', 'resultado', 'historial_territorio', 'territorio',
  'conductor', 'grupo', 'punto_encuentro', 'territorio_personal', 'otro',
] as const

const NOMBRE_TIPO: Record<string, string> = {
  salida: 'Salidas',
  resultado: 'Resultados',
  historial_territorio: 'Historial de territorios',
  territorio: 'Territorios',
  conductor: 'Conductores',
  grupo: 'Grupos',
  punto_encuentro: 'Puntos de encuentro',
  territorio_personal: 'Territorio personal',
  otro: 'Otros',
}

export const IMPORTACION_PAGE_SIZE = 200

export type ImportacionViewState = {
  corrida: string | null
  filtroTipo: string
  filtroEstado: string
  pagina: number
}

export const initialImportacionViewState: ImportacionViewState = {
  corrida: null,
  filtroTipo: 'todos',
  filtroEstado: 'conflicto',
  pagina: 0,
}

export type ImportacionViewAction =
  | { type: 'setCorrida'; corrida: string | null }
  | { type: 'setFiltroTipo'; filtroTipo: string }
  | { type: 'setFiltroEstado'; filtroEstado: string }
  | { type: 'setPagina'; pagina: number }

export function importacionViewReducer(
  state: ImportacionViewState,
  action: ImportacionViewAction,
): ImportacionViewState {
  switch (action.type) {
    case 'setCorrida':
      return { ...state, corrida: action.corrida, pagina: 0 }
    case 'setFiltroTipo':
      return { ...state, filtroTipo: action.filtroTipo, pagina: 0 }
    case 'setFiltroEstado':
      return { ...state, filtroEstado: action.filtroEstado, pagina: 0 }
    case 'setPagina':
      return { ...state, pagina: Math.max(0, Math.floor(action.pagina)) }
    default:
      return state
  }
}

export function importacionPagination(total: number | null, pagina: number) {
  const page = Math.max(0, Math.floor(pagina))
  const from = page * IMPORTACION_PAGE_SIZE
  const to = from + IMPORTACION_PAGE_SIZE - 1
  const pageCount = total === null ? null : Math.ceil(total / IMPORTACION_PAGE_SIZE)
  const firstShown = total === null || total === 0 ? 0 : from + 1
  const lastShown = total === null || total === 0 ? 0 : Math.min(to + 1, total)
  return {
    page,
    from,
    to,
    pageCount,
    firstShown,
    lastShown,
    canPrevious: page > 0,
    canNext: pageCount !== null && page < pageCount - 1,
  }
}

export function exactImportacionCount(
  response: { count: number | null; error: { message: string } | null },
  label: string,
): number {
  if (response.error) throw new Error(`${label}: ${response.error.message}`)
  const count = response.count
  if (typeof count !== 'number' || !Number.isInteger(count) || count < 0) {
    throw new Error(`${label}: el servidor no devolvió un total exacto.`)
  }
  return count
}

export function createImportacionRequestGate() {
  let generation = 0
  let controller: AbortController | null = null

  return {
    start() {
      controller?.abort()
      const nextController = new AbortController()
      controller = nextController
      const requestGeneration = ++generation
      return {
        signal: nextController.signal,
        isCurrent: () => requestGeneration === generation && !nextController.signal.aborted,
      }
    },
    cancel() {
      generation += 1
      controller?.abort()
      controller = null
    },
  }
}

export type ImportacionDecisionResponse = {
  error: { message: string } | null
}

export async function executeImportacionDecision(
  send: () => Promise<ImportacionDecisionResponse>,
  isCurrent: () => boolean,
  onError: (message: string) => void,
  onSuccess: () => void,
  onFinally: () => void,
) {
  try {
    const response = await send()
    if (!isCurrent()) return
    if (response.error) {
      onError(response.error.message)
      return
    }
    onSuccess()
  } catch (failure) {
    if (!isCurrent()) return
    const message =
      failure instanceof Error
        ? failure.message
        : typeof failure === 'object' && failure !== null && 'message' in failure && typeof failure.message === 'string'
          ? failure.message
          : 'No se pudo guardar la decisión.'
    onError(message)
  } finally {
    if (isCurrent()) onFinally()
  }
}

const fecha = (iso: string) =>
  new Date(iso).toLocaleString('es-AR', { dateStyle: 'medium', timeStyle: 'short' })

/** El Excel guarda celdas vacías igual que las llenas; solo estorban. */
function celdasConAlgo(bruto: Bruto | null): Celda[] {
  return (bruto?.celdas ?? []).filter(
    (c) => c.valor !== null && c.valor !== undefined && String(c.valor).trim() !== '',
  )
}

function textoCorto(v: unknown): string {
  if (v === null || v === undefined) return '—'
  const t = typeof v === 'object' ? JSON.stringify(v) : String(v)
  return t.length > 120 ? t.slice(0, 117) + '…' : t
}

export function ImportacionPage() {
  const { profile } = useAuth()
  const esAdmin = profile?.role === 'admin'

  const [corridas, setCorridas] = useState<Importacion[] | null>(null)
  const [corridasError, setCorridasError] = useState<string | null>(null)
  const [corridasReintento, setCorridasReintento] = useState(0)
  const [vista, dispatch] = useReducer(importacionViewReducer, initialImportacionViewState)
  const { corrida, filtroTipo, filtroEstado, pagina } = vista
  const [resumen, setResumen] = useState<Resumen | null>(null)
  const [resumenCargando, setResumenCargando] = useState(false)
  const [resumenError, setResumenError] = useState<string | null>(null)
  const [resumenReintento, setResumenReintento] = useState(0)
  const [registros, setRegistros] = useState<Registro[] | null>(null)
  const [totalRegistros, setTotalRegistros] = useState<number | null>(null)
  const [listaError, setListaError] = useState<string | null>(null)
  const [listaReintento, setListaReintento] = useState(0)
  const [abierto, setAbierto] = useState<string | null>(null)
  const [edicionPendiente, setEdicionPendiente] = useState<string | null>(null)
  const [aviso, setAviso] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [guardando, setGuardando] = useState<string | null>(null)
  const corridasGate = useRef(createImportacionRequestGate())
  const resumenGate = useRef(createImportacionRequestGate())
  const listaGate = useRef(createImportacionRequestGate())
  const decisionGeneration = useRef(0)
  const decisionGuard = useRef<{ id: string; generation: number } | null>(null)

  // ------------------------------------------------------- las corridas
  useEffect(() => {
    const request = corridasGate.current.start()
    setCorridas(null)
    setCorridasError(null)
    if (!supabase || !esAdmin) {
      dispatch({ type: 'setCorrida', corrida: null })
      return () => corridasGate.current.cancel()
    }

    void (async () => {
      try {
        const { data, error: e } = await supabase
          .from('importaciones')
          .select('id, archivo, drive_id, nota, estado, corrida_at')
          .order('corrida_at', { ascending: false })
          .abortSignal(request.signal)
        if (!request.isCurrent()) return
        if (e) throw new Error(e.message)
        const lista = (data as Importacion[]) ?? []
        setCorridas(lista)
        // La que sirve es la última que no quedó revertida.
        dispatch({
          type: 'setCorrida',
          corrida: lista.find((c) => c.estado !== 'revertida')?.id ?? lista[0]?.id ?? null,
        })
      } catch (failure) {
        if (!request.isCurrent()) return
        setCorridasError(failure instanceof Error ? failure.message : 'No se pudieron cargar las corridas.')
        setCorridas(null)
      }
    })()
    return () => corridasGate.current.cancel()
  }, [esAdmin, corridasReintento])

  // --------------------------------------------- el resumen de la corrida
  // Se cuenta EN EL SERVIDOR. La primera version traia las filas y las
  // contaba aca, y decia "1000 filas" sobre 3.345: PostgREST corta en mil
  // y el numero salia redondo y creible. Un total equivocado en un tablero
  // de importacion es peor que no tener tablero.
  useEffect(() => {
    const request = resumenGate.current.start()
    setResumen(null)
    setResumenError(null)
    setResumenCargando(false)
    if (!supabase || !corrida) return () => resumenGate.current.cancel()

    setResumenCargando(true)
    void (async () => {
      try {
        const contar = async (col: 'tipo' | 'estado' | null, valor: string | null) => {
          let q = supabase!
            .from('importacion_registros')
            .select('id', { count: 'exact', head: true })
            .eq('importacion_id', corrida)
          if (col && valor) q = q.eq(col, valor)
          return exactImportacionCount(await q.abortSignal(request.signal), col ? `${col}=${valor}` : 'total de staging')
        }

        const [total, estados, tipos] = await Promise.all([
          contar(null, null),
          Promise.all(ESTADOS.map(async (estado) => [estado, await contar('estado', estado)] as const)),
          Promise.all(TIPOS.map(async (tipo) => [tipo, await contar('tipo', tipo)] as const)),
        ])
        const cierres = await supabase
          .from('historical_resolution_closures')
          .select('id', { count: 'exact', head: true })
          .eq('source_importation_id', corrida)
          .abortSignal(request.signal)
        const sinEvidencia = exactImportacionCount(cierres, 'cierres sin evidencia')

        if (!request.isCurrent()) return
        setResumen({
          total,
          porEstado: Object.fromEntries(estados),
          porTipo: Object.fromEntries(tipos.filter(([, count]) => count > 0)),
          sinEvidencia,
        })
      } catch (failure) {
        if (!request.isCurrent()) return
        setResumenError(failure instanceof Error ? failure.message : 'No se pudieron contar las filas de la corrida.')
        setResumen(null)
      } finally {
        if (request.isCurrent()) setResumenCargando(false)
      }
    })()
    return () => resumenGate.current.cancel()
  }, [corrida, resumenReintento])

  // ---------------------------------------------------- las filas visibles
  useEffect(() => {
    const request = listaGate.current.start()
    setRegistros(null)
    setTotalRegistros(null)
    setListaError(null)
    if (!supabase || !corrida) return () => listaGate.current.cancel()

    const bounds = importacionPagination(null, pagina)
    void (async () => {
      try {
        let q = supabase!
          .from('importacion_registros')
          .select('id, pestania, fila, rango, tipo, bruto, normalizado, estado, motivo, destino_tabla, destino_tipo, revisado_at', { count: 'exact' })
          .eq('importacion_id', corrida)
        if (filtroTipo !== 'todos') q = q.eq('tipo', filtroTipo)
        if (filtroEstado !== 'todos') q = q.eq('estado', filtroEstado)
        const { data, count, error: e } = await q
          .order('pestania', { ascending: true })
          .order('fila', { ascending: true })
          .order('id', { ascending: true })
          .range(bounds.from, bounds.to)
          .abortSignal(request.signal)
        if (!request.isCurrent()) return
        if (e) throw new Error(e.message)
        const total = exactImportacionCount({ count, error: null }, 'total de filas filtradas')
        setRegistros((data as Registro[]) ?? [])
        setTotalRegistros(total)
      } catch (failure) {
        if (!request.isCurrent()) return
        setListaError(failure instanceof Error ? failure.message : 'No se pudieron cargar las filas.')
        setRegistros(null)
        setTotalRegistros(null)
      }
    })()
    return () => listaGate.current.cancel()
  }, [corrida, filtroTipo, filtroEstado, pagina, listaReintento])

  const confirmarNavegacion = useCallback(() => {
    if (guardando || decisionGuard.current) {
      setAviso('Esperá a que termine de guardarse la decisión antes de navegar.')
      return false
    }
    if (!edicionPendiente) return true
    return window.confirm('Hay una decisión sin guardar. Si continuás, se perderá la nota escrita.')
  }, [edicionPendiente, guardando])

  const limpiarEdicionY = useCallback((action: ImportacionViewAction) => {
    if (!confirmarNavegacion()) return
    setEdicionPendiente(null)
    setAbierto(null)
    dispatch(action)
  }, [confirmarNavegacion])

  const cambiarPagina = (nextPage: number) => {
    if (nextPage === pagina) return
    limpiarEdicionY({ type: 'setPagina', pagina: nextPage })
  }

  useEffect(() => {
    if (!edicionPendiente && !guardando) return
    const avisarAntesDeSalir = (event: BeforeUnloadEvent) => {
      event.preventDefault()
      event.returnValue = ''
    }
    window.addEventListener('beforeunload', avisarAntesDeSalir)
    return () => window.removeEventListener('beforeunload', avisarAntesDeSalir)
  }, [edicionPendiente, guardando])

  useEffect(() => {
    if (totalRegistros === null) return
    const pageCount = Math.ceil(totalRegistros / IMPORTACION_PAGE_SIZE)
    const lastPage = Math.max(0, pageCount - 1)
    if (pagina > lastPage) dispatch({ type: 'setPagina', pagina: lastPage })
  }, [pagina, totalRegistros])

  // ------------------------------------------------------------ decidir
  const decidir = useCallback(
    async (r: Registro, campo: string | null, valor: string | null, nota: string) => {
      if (!supabase || !profile?.id) return
      if (decisionGuard.current) {
        setAviso('Esperá a que termine de guardarse la decisión antes de enviar otra.')
        return
      }
      const generation = ++decisionGeneration.current
      decisionGuard.current = { id: r.id, generation }
      setGuardando(r.id)
      setError(null)

      const sigueSiendoLaDecision = () =>
        decisionGuard.current?.id === r.id && decisionGuard.current.generation === generation

      await executeImportacionDecision(
        async () => {
          const decision = {
            ...(campo && valor ? { [campo]: valor } : {}),
            nota: nota || null,
            por: profile.id,
            at: new Date().toISOString(),
          }
          // Descartar no necesita decisión de contenido: la fila no entra.
          const descarta = campo === null
          return supabase!
            .from('importacion_registros')
            .update({
              normalizado: { ...(r.normalizado ?? {}), decision_humana: decision },
              estado: descarta ? 'descartado' : 'pendiente',
              motivo: descarta ? nota || r.motivo : r.motivo,
              revisado_por: profile.id,
              revisado_at: new Date().toISOString(),
            })
            .eq('id', r.id)
        },
        sigueSiendoLaDecision,
        message => setError(message),
        () => {
          setAviso(
            campo === null
              ? `Fila ${r.pestania}:${r.fila} descartada. Sigue entre las filas importadas, marcada.`
              : `Fila ${r.pestania}:${r.fila} resuelta. Queda lista para aplicar.`,
          )
          setAbierto(null)
          setEdicionPendiente(null)
          setListaReintento((value) => value + 1)
          setResumenReintento((value) => value + 1)
        },
        () => {
          if (!sigueSiendoLaDecision()) return
          decisionGuard.current = null
          setGuardando(null)
        },
      )
    },
    [profile?.id],
  )

  const cambiarCorrida = (nextCorrida: string) => {
    limpiarEdicionY({ type: 'setCorrida', corrida: nextCorrida })
  }

  const cambiarFiltroTipo = (nextFiltroTipo: string) => {
    limpiarEdicionY({ type: 'setFiltroTipo', filtroTipo: nextFiltroTipo })
  }

  const cambiarFiltroEstado = (nextFiltroEstado: string) => {
    limpiarEdicionY({ type: 'setFiltroEstado', filtroEstado: nextFiltroEstado })
  }

  const cambiarAbierto = (id: string) => {
    if (!confirmarNavegacion()) return
    setEdicionPendiente(null)
    setAbierto(abierto === id ? null : id)
  }

  const reintentarLista = () => {
    if (!confirmarNavegacion()) return
    setEdicionPendiente(null)
    setAbierto(null)
    setListaReintento((value) => value + 1)
  }

  const reintentarResumen = () => {
    setResumenReintento((value) => value + 1)
  }

  if (!esAdmin) {
    return (
      <div className="page">
        <section className="page-header">
          <div>
            <p className="eyebrow">Importación</p>
            <h2>Revisión del Excel</h2>
            <p className="lead">
              Esta pantalla es solo para administradores. Lo que se decide acá cambia qué
              datos entran al sistema.
            </p>
          </div>
        </section>
      </div>
    )
  }

  const corridaActual = corridas?.find((c) => c.id === corrida)
  const paginaInfo = importacionPagination(totalRegistros, pagina)
  const mostrarConteo = (value: number | undefined) => {
    if (resumen === null) return resumenCargando ? '…' : '—'
    return value ?? '—'
  }

  return (
    <div className="page">
      <section className="page-header">
        <div>
          <p className="eyebrow">Importación</p>
          <h2>Revisión del Excel</h2>
          <p className="lead">
            La fuente completa queda conservada para auditarla: acá se ve qué se materializó
            en el histórico y qué quedó cerrado por falta de evidencia.
          </p>
        </div>
      </section>

      {error && <p className="form-feedback error">{error}</p>}
      {aviso && <p className="form-feedback success">{aviso}</p>}

      <section className="module-hero">
        <div className="module-hero-copy">
          <p className="eyebrow">Archivo</p>
          {corridas === null ? (
            corridasError ? (
              <div className="form-feedback error" role="alert">
                <span>No se pudieron cargar las importaciones: {corridasError}</span>
                <button type="button" className="ghost-button" onClick={() => setCorridasReintento((value) => value + 1)}>
                  <Icono nombre="rehacer" tamaño={18} />
                  Reintentar
                </button>
              </div>
            ) : (
              <h3>Cargando…</h3>
            )
          ) : !corridas.length ? (
            <h3>Todavía no se importó nada</h3>
          ) : (
            <>
              <label>
                Importación
                <Desplegable
                  etiqueta="Importación"
                  valor={corrida ?? ''}
                  alElegir={cambiarCorrida}
                  opciones={corridas.map((c) => ({
                    valor: c.id,
                    texto: `${fecha(c.corrida_at)} · ${c.archivo}${c.estado === 'revertida' ? ' · REVERTIDA' : ''}`,
                  }))}
                />
              </label>
              {corridaActual?.estado === 'revertida' && (
                <p>
                  Esta importación quedó <strong>revertida</strong>: falló a mitad de camino y
                  se conserva solo como auditoría. No la uses para decidir.
                </p>
              )}
            </>
          )}
        </div>

        {resumenError && (
          <div className="form-feedback error" role="alert">
            <span>No se pudieron contar las filas: {resumenError}</span>
            <button type="button" className="ghost-button" onClick={reintentarResumen}>
              <Icono nombre="rehacer" tamaño={18} />
              Reintentar conteos
            </button>
          </div>
        )}

        <div className="module-hero-stats">
          <article className="module-stat-card">
            <span>Filas importadas</span>
            <strong>{mostrarConteo(resumen?.total)}</strong>
            <small>filas del Excel</small>
          </article>
          <article className="module-stat-card">
            <span>Necesitan decisión</span>
            <strong>{mostrarConteo(resumen?.porEstado.conflicto)}</strong>
            <small>ninguna cuenta las resuelve</small>
          </article>
          <article className="module-stat-card">
            <span>Listas para aplicar</span>
            <strong>{mostrarConteo(resumen?.porEstado.pendiente)}</strong>
            <small>pendientes de aplicar</small>
          </article>
          <article className="module-stat-card">
            <span>Descartadas</span>
            <strong>{mostrarConteo(resumen?.porEstado.descartado)}</strong>
            <small>fuera de lo operativo, con motivo</small>
          </article>
          <article className="module-stat-card">
            <span>Sin evidencia</span>
            <strong>{mostrarConteo(resumen?.sinEvidencia)}</strong>
            <small>cierres históricos sin respaldo suficiente; no son filas descartadas</small>
          </article>
        </div>
      </section>

      <section className="panel">
        <div className="module-registry-toolbar">
          <label className="inline-filter">
            Qué
            <Desplegable
              etiqueta="Tipo de fila"
              valor={filtroTipo}
              alElegir={cambiarFiltroTipo}
              opciones={[
                { valor: 'todos', texto: `Todo (${resumen?.total ?? '—'})` },
                ...Object.entries(resumen?.porTipo ?? {})
                  .sort((a, b) => b[1] - a[1])
                  .map(([t, n]) => ({ valor: t, texto: `${NOMBRE_TIPO[t] ?? t} (${n})` })),
              ]}
            />
          </label>
          <label className="inline-filter">
            Estado
            <Desplegable
              etiqueta="Estado de revisión"
              valor={filtroEstado}
              alElegir={cambiarFiltroEstado}
              opciones={[
                { valor: 'conflicto', texto: 'Necesitan decisión' },
                { valor: 'pendiente', texto: 'Listas para aplicar' },
                { valor: 'descartado', texto: 'Descartadas' },
                { valor: 'aplicado', texto: 'Aplicadas' },
                { valor: 'todos', texto: 'Todas' },
              ]}
            />
          </label>
        </div>

        {!corrida ? (
          <p className="lead">Elegí una importación para ver sus filas.</p>
        ) : listaError ? (
          <div className="form-feedback error" role="alert">
            <span>No se pudieron cargar las filas: {listaError}</span>
            <button type="button" className="ghost-button" onClick={reintentarLista}>
              <Icono nombre="rehacer" tamaño={18} />
              Reintentar lista
            </button>
          </div>
        ) : registros === null ? (
          <p className="lead">Cargando…</p>
        ) : !registros.length ? (
          <p className="lead">
            {filtroEstado === 'conflicto'
              ? 'No hay filas pendientes de revisión.'
              : 'No hay filas con ese filtro.'}
          </p>
        ) : (
          <ul className="imp-lista">
            {registros.map((r) => (
              <FilaRegistro
                key={r.id}
                registro={r}
                abierto={abierto === r.id}
                guardando={guardando === r.id}
                onAbrir={() => cambiarAbierto(r.id)}
                onDraftChange={(id, dirty) => setEdicionPendiente(dirty ? id : null)}
                onDecidir={decidir}
              />
            ))}
          </ul>
        )}

        {totalRegistros !== null && totalRegistros > 0 && !listaError && (
          <div className="imp-acciones" aria-label="Paginación de filas" aria-live="polite">
            <button
              type="button"
              className="ghost-button"
              disabled={!paginaInfo.canPrevious || registros === null}
              onClick={() => cambiarPagina(pagina - 1)}
            >
              <Icono nombre="anterior" tamaño={18} />
              Anterior
            </button>
            <span>
              Mostrando {paginaInfo.firstShown}–{paginaInfo.lastShown} de {totalRegistros}
              {paginaInfo.pageCount ? ` · página ${paginaInfo.page + 1} de ${paginaInfo.pageCount}` : ''}
            </span>
            <button
              type="button"
              className="ghost-button"
              disabled={!paginaInfo.canNext || registros === null}
              onClick={() => cambiarPagina(pagina + 1)}
            >
              <Icono nombre="siguiente" tamaño={18} />
              Siguiente
            </button>
          </div>
        )}
      </section>
    </div>
  )
}

function FilaRegistro({
  registro: r,
  abierto,
  guardando,
  onAbrir,
  onDraftChange,
  onDecidir,
}: {
  registro: Registro
  abierto: boolean
  guardando: boolean
  onAbrir: () => void
  onDraftChange: (id: string, dirty: boolean) => void
  onDecidir: (r: Registro, campo: string | null, valor: string | null, nota: string) => void
}) {
  const [nota, setNota] = useState('')
  const decision = DECISIONES[r.tipo]
  const celdas = celdasConAlgo(r.bruto)
  const errores = r.bruto?.errores_formula ?? []
  const yaDecidida = (r.normalizado as { decision_humana?: unknown } | null)?.decision_humana
  const cierreSinEvidencia = r.destino_tipo === 'historical_closure'

  return (
    <li className={`imp-fila imp-${r.estado}`}>
      <button type="button" className="imp-cabecera" onClick={onAbrir} aria-expanded={abierto} disabled={guardando}>
        <span className="imp-donde">
          {r.pestania} <strong>fila {r.fila}</strong>
        </span>
        <span className="imp-tipo">{NOMBRE_TIPO[r.tipo] ?? r.tipo}</span>
        <span className="imp-motivo">{r.motivo ?? 'sin observaciones'}</span>
        <span className="imp-flecha" aria-hidden="true">
          <Icono nombre="chevron-abajo" tamaño={18} />
        </span>
      </button>

      {abierto && (
        <div className="imp-cuerpo">
          {cierreSinEvidencia && (
            <p className="imp-alerta imp-cierre">
              Cierre auditable: sin evidencia suficiente. No se creó una relación operativa,
              una fecha/hora ni un resultado.
            </p>
          )}
          {errores.length > 0 && (
            <p className="imp-alerta">
              El Excel devuelve error en {errores.length === 1 ? 'la columna' : 'las columnas'}{' '}
              <strong>{errores.join(', ')}</strong>. Un error de fórmula no es un dato.
            </p>
          )}

          <p className="eyebrow">La fila, tal cual está en el Excel</p>
          <table className="module-table imp-tabla">
            <tbody>
              {celdas.map((c) => (
                <tr key={c.columna} className={errores.includes(c.columna) ? 'imp-mala' : ''}>
                  <th scope="row">{c.columna}</th>
                  <td>{textoCorto(c.valor)}</td>
                  <td className="imp-extra">
                    {c.formula ? `fórmula → ${textoCorto(c.valor_calculado)}` : ''}
                    {c.hipervinculo ? `enlace: ${textoCorto(c.hipervinculo)}` : ''}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>

          {cierreSinEvidencia ? (
            <p className="imp-pie">
              Este cierre es de solo lectura. Si aparece nueva evidencia, se agrega una
              corrección auditada; no se reabre ni se sobreescribe esta fila.
            </p>
          ) : (
            <>
              {yaDecidida ? (
                <p className="imp-alerta">
                  Esta fila ya tiene una decisión tomada. Volver a decidir la reemplaza.
                </p>
              ) : null}

              <p className="eyebrow">Qué hacemos con esta fila</p>
              <label className="imp-nota">
                Por qué (queda guardado)
                <input
                  type="text"
                  value={nota}
                  disabled={guardando}
                  onChange={(e) => {
                    setNota(e.target.value)
                    onDraftChange(r.id, e.target.value.trim().length > 0)
                  }}
                  placeholder="Ej: el conductor confirmó que ese día llovió"
                />
              </label>

              <div className="imp-acciones">
                {decision?.opciones.map(([valor, texto]) => (
                  <button
                    key={valor}
                    type="button"
                    className="ghost-button"
                    disabled={guardando}
                    onClick={() => onDecidir(r, decision.campo, valor, nota)}
                  >
                    <Icono nombre="guardar" tamaño={18} />
                    {texto}
                  </button>
                ))}
                {!decision && (
                  <button
                    type="button"
                    className="ghost-button"
                    disabled={guardando}
                    onClick={() => onDecidir(r, 'revisado', 'ok', nota)}
                  >
                    <Icono nombre="guardar" tamaño={18} />
                    Está bien, que entre
                  </button>
                )}
                <button
                  type="button"
                  className="danger-button"
                  disabled={guardando}
                  onClick={() => {
                    if (
                      !window.confirm(
                        '¿Descartás esta fila? Queda fuera de lo operativo, con el motivo que hayas escrito.',
                      )
                    ) {
                      return
                    }
                    onDecidir(r, null, null, nota)
                  }}
                >
                  <Icono nombre="eliminar" tamaño={18} />
                  Descartar
                </button>
              </div>

              <p className="imp-pie">
                Se guarda tu decisión, no el dato corregido: al aplicar, el importador vuelve a
                leer la fila del Excel y usa lo que decidiste en lugar del valor dudoso.
              </p>
            </>
          )}
        </div>
      )}
    </li>
  )
}
