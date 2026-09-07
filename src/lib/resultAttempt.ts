export type ResultPayload = {
  p_id: string
  p_salida_id: string
  p_estado: string
  p_motivo: string | null
  p_observaciones: string | null
  p_ocurrio_at: string | null
  p_corrige_id: string | null
}

// Write-ahead record: never forget an uncertain RPC, including after remount.
// The caller pins the JWT and serializes each user/salida with Web Locks.
export function resultAttemptStore(storage: Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>, project: string, user: string, salida: string) {
  const key = `territorios:result-attempt:v1:${project}:${user}:${salida}`
  function read(): ResultPayload | null {
    const raw = storage.getItem(key)
    if (raw === null) return null
    const value = JSON.parse(raw) as ResultPayload
    if (!value || value.p_salida_id !== salida || typeof value.p_id !== 'string' || !value.p_id ||
      !['realizada', 'parcial', 'no_realizada', 'cancelada', 'sin_dato'].includes(value.p_estado) ||
      !['p_motivo', 'p_observaciones', 'p_ocurrio_at', 'p_corrige_id'].every(field =>
        value[field as keyof ResultPayload] === null || typeof value[field as keyof ResultPayload] === 'string')) {
      throw Error('El envío pendiente no se puede leer. No se sobrescribió; pedí ayuda al administrador.')
    }
    return value
  }
  return {
    key, read,
    prepare(payload: ResultPayload) {
      const pending = read()
      if (pending) return pending
      if (payload.p_salida_id !== salida) throw Error('El envío pertenece a otra salida.')
      storage.setItem(key, JSON.stringify(payload))
      const saved = read()
      if (!saved || JSON.stringify(saved) !== JSON.stringify(payload)) throw Error('No se pudo conservar el envío en este dispositivo.')
      return saved
    },
    confirm(id: string) {
      if (read()?.p_id === id) storage.removeItem(key)
    },
  }
}
