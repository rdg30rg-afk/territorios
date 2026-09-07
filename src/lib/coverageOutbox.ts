export type CoverageInput = {
  lado_id: string; manzana_id: string; territory_id: string; geometry_version: number
  estado: 'recorrido' | 'no_accesible' | 'revisitar' | 'sin_dato'
  origen: 'app_hermano' | 'cierre_salida' | 'correccion'
  informado_por: string; salida_id?: string | null; corrige_evento_id?: string | null; nota?: string | null
}
export type CoverageQueuedEvent = CoverageInput & {
  id: string; clientCreatedAt: string; status: 'pending' | 'sending' | 'error'; attempts: number; lastError: string | null
}
type Lock = <T>(name: string, task: () => Promise<T>) => Promise<T>
type Send = (event: CoverageQueuedEvent) => Promise<boolean | { confirmed: boolean; error?: string }>
type Options = {
  storage: Pick<Storage, 'getItem' | 'setItem'>; projectRef: string; userId: string
  lock?: Lock; send?: Send; shouldContinue?: () => boolean; now?: () => string; uuid?: () => string
}
export class CoverageOutboxStorageError extends Error {
  operation: 'read' | 'write'
  constructor(operation: 'read' | 'write') {
    super(operation === 'read' ? 'No pudimos leer las marcas pendientes. No borres los datos del navegador.' : 'No pudimos conservar la marca en este dispositivo. No se confirmó el guardado.')
    this.name = 'CoverageOutboxStorageError'; this.operation = operation
  }
}

/** Locks separados para entrega y mutaciones: esperar la red no bloquea enqueue.
 * Ninguna recuperación ocurre fuera del lock de entrega. */
export function CreateOutbox(options: Options) {
  if (!options.projectRef || !options.userId) throw new Error('Falta proyecto o usuario')
  const key = `coverage-outbox:v1:${encodeURIComponent(options.projectRef)}:${encodeURIComponent(options.userId)}`
  const lock: Lock = options.lock ?? (async (name, task) => {
    if (!globalThis.navigator?.locks) throw new Error('Este navegador no permite guardar marcas de forma segura entre pestañas.')
    return globalThis.navigator.locks.request(name, task)
  })
  const uuid = options.uuid ?? (() => {
    if (!globalThis.crypto?.randomUUID) throw new Error('No se puede generar un identificador seguro.')
    return globalThis.crypto.randomUUID()
  })
  const read = (): CoverageQueuedEvent[] => {
    try {
      const raw = options.storage.getItem(key)
      if (raw === null) return []
      const parsed = JSON.parse(raw)
      if (parsed.version !== 1 || parsed.projectRef !== options.projectRef || parsed.userId !== options.userId || !Array.isArray(parsed.events)) throw Error('Formato inválido')
      const ids = new Set<string>()
      for (const event of parsed.events) {
        if (!event || typeof event.id !== 'string' || ids.has(event.id) || event.informado_por !== options.userId || !event.lado_id || !['pending','sending','error'].includes(event.status)) throw Error('Evento inválido')
        ids.add(event.id)
      }
      return parsed.events
    } catch { throw new CoverageOutboxStorageError('read') }
  }
  const mutate = <T>(change: (events: CoverageQueuedEvent[]) => T) => lock(`${key}:storage`, async () => {
    const events = read(), result = change(events)
    try { options.storage.setItem(key, JSON.stringify({ version: 1, projectRef: options.projectRef, userId: options.userId, events })) }
    catch { throw new CoverageOutboxStorageError('write') }
    return result
  })
  read() // No reemplazar datos ilegibles por una cola vacía.
  return {
    key, getEvents: read,
    async enqueue(input: CoverageInput): Promise<CoverageQueuedEvent> {
      if (input.informado_por !== options.userId) throw Error('La marca pertenece a otra cuenta')
      if (!input.lado_id || !input.manzana_id || !input.territory_id || !Number.isInteger(input.geometry_version) || input.geometry_version < 1
        || !['recorrido','no_accesible','revisitar','sin_dato'].includes(input.estado) || !['app_hermano','cierre_salida','correccion'].includes(input.origen)) throw Error('Marca inválida')
      const event: CoverageQueuedEvent = { ...input, id: uuid(), clientCreatedAt: options.now?.() ?? new Date().toISOString(), status: 'pending', attempts: 0, lastError: null }
      await mutate(events => { if (events.some(e => e.id === event.id)) throw Error('Identificador repetido'); events.push(event) })
      return { ...event }
    },
    async retry(id: string): Promise<CoverageQueuedEvent | null> {
      return mutate(events => {
        const event = events.find(e => e.id === id)
        if (!event) return null
        if (event.status === 'error') { event.status = 'pending'; event.lastError = null }
        return { ...event }
      })
    },
    async retryErrors() {
      await mutate(events => { for (const e of events) if (e.status === 'error') { e.status = 'pending'; e.lastError = null } })
    },
    async drain(send = options.send) {
      if (!send) throw Error('Falta el envío de cobertura')
      return lock(`${key}:delivery`, async () => {
        const result = { attempted: 0, confirmed: 0, failed: 0, remaining: 0 }
        // Tener delivery prueba que otra pestaña no está enviando ahora.
        await mutate(events => { for (const e of events) if (e.status === 'sending') e.status = 'pending' })
        while (options.shouldContinue?.() !== false) {
          const event = await mutate(events => {
            const blocked = new Set<string>()
            for (const e of events) {
              if (e.status === 'error') blocked.add(e.lado_id)
              if (e.status === 'pending' && !blocked.has(e.lado_id)) { e.status = 'sending'; e.attempts++; return { ...e } }
            }
            return null
          })
          if (!event) break
          result.attempted++
          let confirmed = false, error = 'El servidor no confirmó la marca. Reintentá con el mismo identificador.'
          try {
            const response = await send(event)
            confirmed = response === true || (typeof response === 'object' && response.confirmed === true)
            if (typeof response === 'object' && response.error) error = response.error
          } catch (failure) { if (failure instanceof Error) error = failure.message }
          await mutate(events => {
            const index = events.findIndex(e => e.id === event.id)
            if (index < 0) throw Error('Desapareció una marca en envío')
            if (confirmed) events.splice(index, 1)
            else { events[index].status = 'error'; events[index].lastError = error }
          })
          if (confirmed) result.confirmed++; else result.failed++
        }
        result.remaining = read().length
        return result
      })
    },
  }
}
export type CoverageOutbox = ReturnType<typeof CreateOutbox>
