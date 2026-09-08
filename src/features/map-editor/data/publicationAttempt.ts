import type { AtomicPublicationItemV2 } from '../model/publication.ts'

export type PublicationAttempt = { operationId: string; changes: AtomicPublicationItemV2[] }

// Persist before sending. A lost response must retain the identical UUID and payload.
export function publicationAttemptStore(storage: Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>, project: string, user: string) {
  const key = `territorios:editor-publication:v1:${project}:${user}`
  const receiptKey = `${key}:confirmed`
  const content = (changes: AtomicPublicationItemV2[]) => JSON.stringify(changes
    .map(({ territory_id, manzanas }) => ({ territory_id, manzanas }))
    .sort((a, b) => a.territory_id.localeCompare(b.territory_id)))
  function read(): PublicationAttempt | null {
    const raw = storage.getItem(key)
    if (raw === null) return null
    const value = JSON.parse(raw) as PublicationAttempt
    if (!value || typeof value.operationId !== 'string' || !value.operationId || !Array.isArray(value.changes) || !value.changes.length ||
      value.changes.some((item) => !item.territory_id || !Number.isSafeInteger(item.version_esperada) || !Array.isArray(item.manzanas))) {
      throw Error('El intento pendiente no se puede leer. Conservamos la copia; no publiques otro lote.')
    }
    return value
  }
  return {
    key, read,
    prepare(attempt: PublicationAttempt) {
      const existing = read()
      if (existing) return existing
      if (storage.getItem(receiptKey) === content(attempt.changes)) {
        throw Error('Este mismo dibujo ya fue confirmado. No se publicará otra versión idéntica.')
      }
      storage.setItem(key, JSON.stringify(attempt))
      const saved = read()
      if (JSON.stringify(saved) !== JSON.stringify(attempt)) throw Error('No se pudo conservar el intento antes de publicar.')
      return saved!
    },
    confirm(operationId: string) {
      const pending = read()
      if (pending?.operationId === operationId) {
        storage.setItem(receiptKey, content(pending.changes))
        storage.removeItem(key)
      }
    },
  }
}
