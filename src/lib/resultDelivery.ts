import { supabase } from './supabase'
import { resultAttemptStore, type ResultPayload } from './resultAttempt'

// La base a la que apunta esta copia de la app. Antes era una constante fija
// de un solo proyecto: al cambiar de base todos veían el envío bloqueado.
// Ahora sale de la dirección configurada, así la cola de cada base queda
// separada de las otras sin atarse a ninguna.
function proyectoActual() {
  const url = import.meta.env.VITE_SUPABASE_URL
  if (!supabase || !url) throw Error('Todavía no está configurada la conexión con la base.')
  try {
    return new URL(url).hostname.split('.')[0] || url
  } catch {
    return url
  }
}

async function scope() {
  const project = proyectoActual()
  const { data, error } = await supabase!.auth.getSession()
  if (error || !data.session) throw Error('Volvé a iniciar sesión para recuperar el envío.')
  return { session: data.session, project }
}

// Errores con los que el servidor dice «no» de forma definitiva: el envío no
// se aplicó ni se va a aplicar tal cual. Reintentar el mismo intento daría
// siempre lo mismo, así que no tiene sentido conservarlo.
// Una falla de red o un 5xx no traen código: esos quedan pendientes.
const RECHAZO_DEFINITIVO = /^(22\w{3}|23\w{3}|42\w{3}|55\w{3}|40001|P0001)$/

export function esRechazoDefinitivo(error: unknown) {
  const code = (error as { code?: unknown } | null)?.code
  return typeof code === 'string' && RECHAZO_DEFINITIVO.test(code)
}

export async function pendingResult(salidaId: string) {
  const { session, project } = await scope()
  return { userId: session.user.id, payload: resultAttemptStore(localStorage, project, session.user.id, salidaId).read() }
}

export async function deliverResult(payload: ResultPayload, userId: string | null) {
  const { session, project } = await scope()
  if (session.user.id !== userId) throw Error('Cambió la cuenta. Volvé a abrir esta salida.')
  const store = resultAttemptStore(localStorage, project, session.user.id, payload.p_salida_id)
  if (!navigator.locks) throw Error('Este navegador no permite coordinar envíos seguros entre pestañas.')
  return navigator.locks.request(store.key, async () => {
    const current = await scope()
    if (current.session.user.id !== session.user.id) throw Error('Cambió la cuenta. Volvé a abrir esta salida.')
    const stable = store.prepare(payload)
    const { error } = await supabase!.rpc('informar_resultado_salida', stable)
      .setHeader('Authorization', `Bearer ${current.session.access_token}`)
    if (error) {
      if (esRechazoDefinitivo(error)) {
        // Por ejemplo: otra persona ya informó esta salida mientras tanto.
        // Se suelta el intento para que no quede trabado para siempre.
        store.confirm(stable.p_id)
        throw Object.assign(Error(error.message), { code: error.code, definitivo: true })
      }
      throw error
    }
    store.confirm(stable.p_id)
    return stable
  })
}
