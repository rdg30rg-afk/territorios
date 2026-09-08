import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react'
import { Desplegable } from './Desplegable'
import { decirElError } from '../lib/decirElError'
import { supabase } from '../lib/supabase'
import { deliverResult, pendingResult } from '../lib/resultDelivery'
import type { ResultPayload } from '../lib/resultAttempt'
import { Icono } from './Icono'

export type SalidaResultadoEstado =
  | 'realizada'
  | 'parcial'
  | 'no_realizada'
  | 'cancelada'
  | 'sin_dato'

export type SalidaResultadoMotivo =
  | 'acceso'
  | 'edificio'
  | 'consorcio'
  | 'clima'
  | 'feriado'
  | 'sin_conductor'
  | 'sin_publicadores'
  | 'otro'

type SalidaResultadoActual = {
  resultado_id: string
  estado: SalidaResultadoEstado
  motivo: SalidaResultadoMotivo | null
  observaciones: string | null
  ocurrio_at: string | null
  informado_at: string
}

export type SalidaResultadoFormProps = {
  salidaId: string
  canReport: boolean
  canCorrect: boolean
  onSaved?: () => void
}

type QueryError = {
  message?: string
  code?: string
  details?: string
}

const estadoLabels: Record<SalidaResultadoEstado, string> = {
  realizada: 'Realizada',
  parcial: 'Parcial',
  no_realizada: 'No realizada',
  cancelada: 'Cancelada',
  sin_dato: 'Sin dato',
}

const motivoOptions: Array<{ valor: SalidaResultadoMotivo; texto: string }> = [
  { valor: 'acceso', texto: 'Acceso' },
  { valor: 'edificio', texto: 'Edificio' },
  { valor: 'consorcio', texto: 'Consorcio' },
  { valor: 'clima', texto: 'Clima' },
  { valor: 'feriado', texto: 'Feriado' },
  { valor: 'sin_conductor', texto: 'Sin conductor' },
  { valor: 'sin_publicadores', texto: 'Sin publicadores' },
  { valor: 'otro', texto: 'Otro' },
]

const estadoOptions: Array<{ valor: SalidaResultadoEstado; texto: string }> = [
  { valor: 'sin_dato', texto: 'Sin dato' },
  { valor: 'realizada', texto: 'Realizada' },
  { valor: 'parcial', texto: 'Parcial' },
  { valor: 'no_realizada', texto: 'No realizada' },
  { valor: 'cancelada', texto: 'Cancelada' },
]

function statusClass(estado: SalidaResultadoEstado) {
  if (estado === 'realizada') return 'status-activo'
  if (estado === 'parcial' || estado === 'sin_dato') return 'status-pendiente'
  return 'status-inactivo'
}

function formatDateTime(value: string | null) {
  if (!value) return 'Sin fecha'

  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return 'Fecha no disponible'

  return new Intl.DateTimeFormat('es-AR', {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(date)
}

function toLocalDateTimeValue(value: string | null) {
  if (!value) return ''

  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return ''

  const pad = (part: number) => String(part).padStart(2, '0')

  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(
    date.getHours(),
  )}:${pad(date.getMinutes())}`
}

function toIsoDateTimeValue(value: string) {
  if (!value) return null

  const date = new Date(value)
  if (Number.isNaN(date.getTime())) {
    throw new Error('La fecha del resultado no es válida.')
  }

  return date.toISOString()
}

function createAttemptId() {
  if (globalThis.crypto?.randomUUID) {
    return globalThis.crypto.randomUUID()
  }

  throw new Error('No se puede identificar el envío de forma segura. Abrí la app mediante HTTPS o localhost.')
}

function errorMessage(error: unknown, fallback: string) {
  if (error instanceof Error) {
    return decirElError({ message: error.message }, fallback)
  }

  if (error && typeof error === 'object') {
    return decirElError(error as QueryError, fallback)
  }

  return fallback
}

export function SalidaResultadoForm({
  salidaId,
  canReport,
  canCorrect,
  onSaved,
}: SalidaResultadoFormProps) {
  const client = supabase
  const attemptId = useRef<string | null>(null)
  const pendingAttempt = useRef<ResultPayload | null>(null)
  const attemptUser = useRef<string | null>(null)
  const submissionRunning = useRef(false)
  const [resultado, setResultado] = useState<SalidaResultadoActual | null>(null)
  const [estado, setEstado] = useState<SalidaResultadoEstado>('sin_dato')
  const [motivo, setMotivo] = useState<SalidaResultadoMotivo | ''>('')
  const [observaciones, setObservaciones] = useState('')
  const [ocurrioAt, setOcurrioAt] = useState('')
  const [modoEdicion, setModoEdicion] = useState(false)
  const [isLoading, setIsLoading] = useState(true)
  const [hasLoaded, setHasLoaded] = useState(false)
  const [isSaving, setIsSaving] = useState(false)
  const [unconfirmed, setUnconfirmed] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [message, setMessage] = useState<string | null>(null)

  useEffect(() => {
    if (!unconfirmed) return
    const warnBeforeLeaving = (event: BeforeUnloadEvent) => {
      event.preventDefault()
      event.returnValue = ''
    }
    window.addEventListener('beforeunload', warnBeforeLeaving)
    return () => window.removeEventListener('beforeunload', warnBeforeLeaving)
  }, [unconfirmed])

  const loadCurrentResult = useCallback(
    async (showLoading = true) => {
      if (!client) {
        setError('Todavía no está configurada la conexión con la base.')
        setIsLoading(false)
        return false
      }

      if (!salidaId) {
        setError('Falta identificar la salida que se quiere informar.')
        setIsLoading(false)
        return false
      }

      if (showLoading) setIsLoading(true)
      setHasLoaded(false)

      try {
        const recovered = await pendingResult(salidaId)
        const pending = recovered.payload
        attemptUser.current = recovered.userId
        const { data, error: loadError } = await client
          .from('salida_resultado_actual')
          .select('resultado_id, estado, motivo, observaciones, ocurrio_at, informado_at')
          .eq('salida_id', salidaId)
          .maybeSingle()

        if (loadError) {
          setError(errorMessage(loadError, 'No se pudo cargar el resultado de la salida.'))
          setIsLoading(false)
          return false
        }

        const currentResult = (data as SalidaResultadoActual | null) ?? null
        setResultado(currentResult)
        setHasLoaded(true)
        pendingAttempt.current = pending
        setEstado((pending?.p_estado ?? currentResult?.estado ?? 'sin_dato') as SalidaResultadoEstado)
        setMotivo((pending ? pending.p_motivo ?? '' : currentResult?.motivo ?? '') as SalidaResultadoMotivo | '')
        setObservaciones(pending ? pending.p_observaciones ?? '' : currentResult?.observaciones ?? '')
        setOcurrioAt(toLocalDateTimeValue(pending ? pending.p_ocurrio_at : currentResult?.ocurrio_at ?? null))
        setModoEdicion(Boolean(pending))
        attemptId.current = pending?.p_id ?? null
        setUnconfirmed(Boolean(pending))
        if (pending) setMessage('Hay un envío conservado en este dispositivo sin confirmación. Reintentá el mismo envío para comprobarlo sin duplicarlo.')
        setError(null)
        setIsLoading(false)
        return true
      } catch (caught) {
        setError(errorMessage(caught, 'No se pudo cargar el resultado de la salida.'))
        setIsLoading(false)
        return false
      }
    },
    [client, salidaId],
  )

  useEffect(() => {
    setResultado(null)
    setEstado('sin_dato')
    setMotivo('')
    setObservaciones('')
    setOcurrioAt('')
    setModoEdicion(false)
    setError(null)
    setMessage(null)
    attemptId.current = null
    void loadCurrentResult()
  }, [loadCurrentResult])

  const openEditor = () => {
    if (!hasLoaded) return
    setEstado(resultado?.estado ?? 'sin_dato')
    setMotivo(resultado?.motivo ?? '')
    setObservaciones(resultado?.observaciones ?? '')
    setOcurrioAt(toLocalDateTimeValue(resultado?.ocurrio_at ?? null))
    setModoEdicion(true)
    setError(null)
    setMessage(null)
    attemptId.current = null
  }

  const cancelEditor = () => {
    if (unconfirmed) return
    setModoEdicion(false)
    setError(null)
    setMessage(null)
    attemptId.current = null
  }

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()

    if (!client || submissionRunning.current || isSaving || !hasLoaded) return

    if (!canReport && !canCorrect) {
      setError('No tenés permiso para informar este resultado.')
      return
    }

    const isCorrection = pendingAttempt.current ? Boolean(pendingAttempt.current.p_corrige_id) : Boolean(resultado)
    if (isCorrection && !canCorrect) {
      setError('Sólo un administrador puede corregir un resultado ya informado.')
      return
    }

    const trimmedObservations = observaciones.trim()
    if (isCorrection && trimmedObservations.length < 2) {
      setError('Escribí el motivo de la corrección en las observaciones.')
      return
    }

    let occurredAtIso: string | null
    try {
      occurredAtIso = toIsoDateTimeValue(ocurrioAt)
    } catch (caught) {
      setError(errorMessage(caught, 'La fecha del resultado no es válida.'))
      return
    }

    setError(null)
    setMessage(null)
    setIsSaving(true)
    submissionRunning.current = true
    try {
      const stableAttemptId = attemptId.current ?? createAttemptId()
      attemptId.current = stableAttemptId
      setUnconfirmed(true)
      const payload = pendingAttempt.current ?? {
        p_id: stableAttemptId,
        p_salida_id: salidaId,
        p_estado: estado,
        p_motivo: motivo || null,
        p_observaciones: trimmedObservations || null,
        p_ocurrio_at: occurredAtIso,
        p_corrige_id: resultado?.resultado_id ?? null,
      }
      pendingAttempt.current = payload
      await deliverResult(payload, attemptUser.current)
      pendingAttempt.current = null

      // Ya confirmó la RPC: cerrar el formulario antes de recargar. Si esa
      // lectura falla, no habilitar otro envío con un ID distinto.
      setModoEdicion(false)
      setUnconfirmed(false)
      const refreshed = await loadCurrentResult(false)
      attemptId.current = null
      if (refreshed) {
        setMessage(isCorrection ? 'Corrección guardada como un nuevo evento.' : 'Resultado guardado.')
      } else {
        setMessage(
          isCorrection
            ? 'La corrección se guardó, pero no se pudo volver a cargar el resultado.'
            : 'El resultado se guardó, pero no se pudo volver a cargar.',
        )
      }
      onSaved?.()
    } catch (caught) {
      setError(errorMessage(caught, 'No se pudo guardar el resultado de la salida.'))
    } finally {
      submissionRunning.current = false
      setIsSaving(false)
    }
  }

  if (isLoading) {
    return <div className="status-card">Cargando resultado de la salida...</div>
  }

  return (
    <section className="module-detail-list">
      {error ? (
        <div className="form-feedback error" role="alert">
          {error}
        </div>
      ) : null}
      {message ? (
        <div className="form-feedback success" role="status">
          {message}
        </div>
      ) : null}

      {!hasLoaded ? <div className="status-card">
        <p>No se pudo verificar el resultado actual. No significa que la salida esté sin informar.</p>
        <button type="button" className="secondary-button" disabled={isSaving}
          onClick={() => void loadCurrentResult()}>
          <Icono nombre="rehacer" tamaño={18} />
          Volver a consultar
        </button>
      </div> : null}

      {hasLoaded ? <div className="module-detail-card">
        <span>Resultado actual</span>
        {resultado ? (
          <>
            <strong>
              <span className={`status-pill ${statusClass(resultado.estado)}`}>
                {estadoLabels[resultado.estado]}
              </span>
            </strong>
            <p>
              Motivo: {resultado.motivo
                ? motivoOptions.find((option) => option.valor === resultado.motivo)?.texto ??
                  resultado.motivo
                : 'Sin motivo'}
            </p>
            <p>Ocurrió: {formatDateTime(resultado.ocurrio_at)}</p>
            <p>Informado: {formatDateTime(resultado.informado_at)}</p>
            <p>{resultado.observaciones || 'Sin observaciones.'}</p>
          </>
        ) : (
          <>
            <strong>
              <span className="status-pill status-pendiente">Sin resultado informado</span>
            </strong>
            <p>
              Todavía no hay un dato sobre lo que ocurrió. Eso no se interpreta como “no realizada”.
            </p>
          </>
        )}
      </div> : null}

      {hasLoaded && resultado && canCorrect && !modoEdicion ? (
        <button type="button" className="secondary-button full-width" onClick={openEditor}>
          <Icono nombre="dibujar" tamaño={18} />
          Corregir resultado
        </button>
      ) : null}

      {hasLoaded && !resultado && canReport && !modoEdicion ? (
        <button type="button" className="primary-button full-width" onClick={openEditor}>
          <Icono nombre="completo" tamaño={18} />
          Informar resultado
        </button>
      ) : null}

      {modoEdicion ? (
        <form className="form-stack" onSubmit={handleSubmit}>
          {unconfirmed && !isSaving ? <div className="form-feedback" role="status">
            <p>No se confirmó el envío. Los campos quedan bloqueados para reintentar exactamente el mismo resultado, sin duplicarlo.</p>
            <button type="button" className="secondary-button" onClick={() => void loadCurrentResult()}>
              <Icono nombre="rehacer" tamaño={18} />
              Consultar qué quedó guardado
            </button>
          </div> : null}
          <label>
            Estado de la salida
            <Desplegable
              etiqueta="Elegir estado"
              valor={estado}
              alElegir={(value) => {
                attemptId.current = null
                setEstado(value as SalidaResultadoEstado)
              }}
              deshabilitado={isSaving || unconfirmed}
              opciones={estadoOptions}
            />
          </label>

          <p className="table-hint">
            “Sin dato” es el valor inicial y no significa que la salida no se haya realizado.
          </p>

          <label>
            Motivo
            <Desplegable
              etiqueta="Elegir motivo"
              valor={motivo}
              alElegir={(value) => {
                attemptId.current = null
                setMotivo(value as SalidaResultadoMotivo | '')
              }}
              deshabilitado={isSaving || unconfirmed}
              opciones={[
                { valor: '', texto: 'Sin motivo' },
                ...motivoOptions,
              ]}
            />
          </label>

          <label>
            {resultado
              ? 'Motivo de la corrección y observaciones (obligatorio)'
              : 'Observaciones'}
            <textarea
              value={observaciones}
              onChange={(event) => {
                attemptId.current = null
                setObservaciones(event.target.value)
              }}
              placeholder={
                resultado
                  ? 'Explicá qué se corrige y por qué.'
                  : 'Qué pasó, qué quedó pendiente o qué conviene saber.'
              }
              rows={4}
              disabled={isSaving || unconfirmed}
            />
          </label>

          <label>
            Cuándo ocurrió
            <input
              type="datetime-local"
              value={ocurrioAt}
              onChange={(event) => {
                attemptId.current = null
                setOcurrioAt(event.target.value)
              }}
              disabled={isSaving || unconfirmed}
            />
          </label>

          <div className="module-table-actions">
            <button
              type="button"
              className="secondary-button"
              onClick={cancelEditor}
              disabled={isSaving || unconfirmed}
            >
              <Icono nombre="cerrar" tamaño={18} />
              Cancelar
            </button>
            <button type="submit" className="primary-button" disabled={isSaving}>
              <Icono nombre="guardar" tamaño={18} />
              {isSaving ? 'Guardando...' : unconfirmed ? 'Reintentar el mismo envío' : resultado ? 'Guardar corrección' : 'Guardar resultado'}
            </button>
          </div>
        </form>
      ) : null}
    </section>
  )
}
