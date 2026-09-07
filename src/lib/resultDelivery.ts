import { supabase } from './supabase'
import { resultAttemptStore, type ResultPayload } from './resultAttempt'

const DEV = 'rkmioktcsgqqjshrlkmy'
async function scope() {
  if (!supabase || import.meta.env.VITE_SUPABASE_URL !== `https://${DEV}.supabase.co`) {
    throw Error('El envío de resultados solo está habilitado en el clon DEV.')
  }
  const { data, error } = await supabase.auth.getSession()
  if (error || !data.session) throw Error('Volvé a iniciar sesión para recuperar el envío.')
  return data.session
}

export async function pendingResult(salidaId: string) {
  const session = await scope()
  return { userId: session.user.id, payload: resultAttemptStore(localStorage, DEV, session.user.id, salidaId).read() }
}

export async function deliverResult(payload: ResultPayload, userId: string | null) {
  const session = await scope()
  if (session.user.id !== userId) throw Error('Cambió la cuenta. Volvé a abrir esta salida.')
  const store = resultAttemptStore(localStorage, DEV, session.user.id, payload.p_salida_id)
  if (!navigator.locks) throw Error('Este navegador no permite coordinar envíos seguros entre pestañas.')
  return navigator.locks.request(store.key, async () => {
    const current = await scope()
    if (current.user.id !== session.user.id) throw Error('Cambió la cuenta. Volvé a abrir esta salida.')
    const stable = store.prepare(payload)
    const { error } = await supabase!.rpc('informar_resultado_salida', stable)
      .setHeader('Authorization', `Bearer ${current.access_token}`)
    if (error) throw error
    store.confirm(stable.p_id)
    return stable
  })
}
