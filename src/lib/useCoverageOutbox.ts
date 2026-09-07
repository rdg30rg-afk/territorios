import { useCallback, useEffect, useRef, useState } from 'react'
import { CreateOutbox, type CoverageInput, type CoverageOutbox, type CoverageQueuedEvent } from './coverageOutbox'
import { supabase } from './supabase'

const DEV = 'rkmioktcsgqqjshrlkmy'
export function useCoverageOutbox(userId: string | undefined) {
  const active = useRef<{ userId: string; box: CoverageOutbox; live: boolean; running: boolean } | null>(null)
  const [events, setEvents] = useState<CoverageQueuedEvent[]>([])
  const [confirmed, setConfirmed] = useState<Array<CoverageQueuedEvent & { confirmationOrder: number }>>([])
  const confirmationOrder = useRef(0)
  const [error, setError] = useState<string | null>(null)
  const [sending, setSending] = useState(false)
  const [remoteRevision, setRemoteRevision] = useState(0)

  const sync = useCallback(async () => {
    const scope = active.current
    if (!scope?.live || scope.running || !navigator.onLine) return
    try {
      if (!scope.box.getEvents().some(e => e.status === 'pending' || e.status === 'sending')) return
    } catch (failure) { setError(String(failure)); return }
    scope.running = true
    setSending(true)
    try {
      const result = await scope.box.drain()
      if (scope.live && result.confirmed) setRemoteRevision(value => value + 1)
      if (scope.live) { setEvents(scope.box.getEvents()); setError(null) }
    } catch (failure) {
      if (scope.live) setError(failure instanceof Error ? failure.message : 'No se pudo sincronizar la cobertura.')
    } finally {
      scope.running = false
      if (scope.live) setSending(false)
    }
  }, [])

  useEffect(() => {
    setEvents([]); setConfirmed([]); setError(null); setSending(false)
    if (!userId || !supabase) return
    let scope: NonNullable<typeof active.current>
    try {
      if (import.meta.env.VITE_SUPABASE_URL !== `https://${DEV}.supabase.co`) throw new Error('Cola bloqueada: esta versión solo escribe en el clon DEV.')
      const box = CreateOutbox({
        projectRef: DEV, userId, storage: localStorage,
        shouldContinue: () => scope.live,
        send: async event => {
          if (!scope.live) throw new Error('La sesión cambió. La marca sigue pendiente en su cuenta original.')
          const { data, error: sessionError } = await supabase!.auth.getSession()
          if (sessionError || data.session?.user.id !== userId || !scope.live) throw new Error('Volvé a ingresar con la cuenta que informó esta marca.')
          // Fijar el JWT de su autor evita tomar otra cuenta si cambia la sesión
          // entre la comprobación anterior y la petición de PostgREST.
          const response = await supabase!.rpc('informar_cobertura', {
            p_event_id: event.id, p_lado_id: event.lado_id, p_estado: event.estado,
            p_origen: event.origen, p_salida_id: event.salida_id ?? null,
            p_corrige_evento_id: event.corrige_evento_id ?? null,
            p_nota: event.nota ?? null, p_geometry_version: event.geometry_version,
          }).setHeader('Authorization', `Bearer ${data.session.access_token}`)
          if (response.error) return { confirmed: false, error: response.error.message }
          if (response.data !== event.id) return { confirmed: false, error: 'El servidor no confirmó el identificador de la marca.' }
          if (scope.live) {
            const order = ++confirmationOrder.current
            setConfirmed(previous => [...previous.filter(e => e.id !== event.id), { ...event, confirmationOrder: order }])
          }
          return true
        },
      })
      scope = { userId, box, live: true, running: false }
      active.current = scope
      setEvents(box.getEvents())
    } catch (failure) {
      active.current = null
      setError(failure instanceof Error ? failure.message : 'No se pudo abrir la cola de marcas.')
      return
    }
    const refresh = () => {
      try { setEvents(scope.box.getEvents()) } catch (failure) { setError(String(failure)) }
      void sync()
    }
    let knownIds = new Set(scope.box.getEvents().map(event => event.id))
    const storageChanged = (event: StorageEvent) => {
      if (event.key === scope.box.key || event.key === null) {
        try {
          const nextIds = new Set(scope.box.getEvents().map(item => item.id))
          if ([...knownIds].some(id => !nextIds.has(id))) setRemoteRevision(value => value + 1)
          knownIds = nextIds
        } catch (failure) { setError(String(failure)) }
        refresh()
      }
    }
    const beforeUnload = (event: BeforeUnloadEvent) => {
      try { if (!scope.box.getEvents().length) return } catch { /* Advertir también si no podemos leer. */ }
      event.preventDefault()
      event.returnValue = ''
    }
    window.addEventListener('storage', storageChanged)
    window.addEventListener('online', refresh)
    window.addEventListener('focus', refresh)
    window.addEventListener('beforeunload', beforeUnload)
    void sync()
    return () => {
      scope.live = false
      if (active.current === scope) active.current = null
      window.removeEventListener('storage', storageChanged)
      window.removeEventListener('online', refresh)
      window.removeEventListener('focus', refresh)
      window.removeEventListener('beforeunload', beforeUnload)
    }
  }, [userId, sync])

  const enqueue = useCallback(async (input: CoverageInput) => {
    const scope = active.current
    if (!scope?.live || scope.userId !== input.informado_por) throw new Error('No se pudo abrir la cola para esta cuenta.')
    const event = await scope.box.enqueue(input)
    if (scope.live) setEvents(scope.box.getEvents())
    // Quien llama encola todos los lados primero y después pide sync.
    return event
  }, [])
  const retry = useCallback(async () => {
    const scope = active.current
    if (!scope?.live) return
    try { await scope.box.retryErrors(); setEvents(scope.box.getEvents()); await sync() }
    catch (failure) { setError(failure instanceof Error ? failure.message : 'No se pudo reintentar.') }
  }, [sync])
  const checkpoint = useCallback(() => confirmationOrder.current, [])
  const acknowledgeSnapshot = useCallback((order: number) => {
    setConfirmed(previous => previous.filter(event => event.confirmationOrder > order))
  }, [])
  return { events, confirmed, error, sending, remoteRevision, enqueue, sync, retry, checkpoint, acknowledgeSnapshot }
}
