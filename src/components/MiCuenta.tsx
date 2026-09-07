import { useEffect, useState, type FormEvent } from 'react'
import { CampoCodigoGrupo } from './CampoCodigoGrupo'
import { useAuth } from '../context/useAuth'
import { supabase } from '../lib/supabase'

type MiCuentaProps = {
  compact?: boolean
}

export function MiCuenta({ compact = false }: MiCuentaProps) {
  const { profile, contexto, signOut, retryAuth } = useAuth()
  const [nombre, setNombre] = useState(profile?.full_name ?? '')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [cambiandoGrupo, setCambiandoGrupo] = useState(false)
  const [conductorVinculado, setConductorVinculado] = useState<string | null>(null)

  useEffect(() => {
    if (!supabase || !profile?.driver_id) {
      setConductorVinculado(null)
      return
    }
    let vivo = true
    void supabase
      .from('conductores')
      .select('full_name')
      .eq('id', profile.driver_id)
      .maybeSingle()
      .then(({ data }) => {
        if (vivo) setConductorVinculado(data?.full_name?.trim() || null)
      })
    return () => { vivo = false }
  }, [profile?.driver_id])
  const save = async (event: FormEvent) => {
    event.preventDefault()
    if (!supabase || busy) return
    setBusy(true); setError(null)
    try {
      const response = await supabase.rpc('actualizar_mi_nombre', { p_nombre: nombre.trim() })
      if (response.error) throw response.error
      retryAuth()
    } catch (failure) {
      setError(failure && typeof failure === 'object' && 'message' in failure ? String(failure.message) : 'No se pudo guardar tu nombre. Conservamos lo que escribiste.')
    } finally { setBusy(false) }
  }
  const leave = async () => {
    if (busy) return
    setBusy(true); setError(null)
    try { await signOut() }
    catch { setError('No pudimos cerrar la sesión. Volvé a intentar.') }
    finally { setBusy(false) }
  }
  return <details className={compact ? 'miCuenta compacto' : 'panel'}>
    <summary className="boton secundario cuenta-resumen" aria-label="Abrir Mi cuenta">
      {compact && <span className="cuentaIcono" aria-hidden="true">
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <circle cx="12" cy="8" r="3.5" />
          <path d="M5 20c.8-3.4 3.2-5 7-5s6.2 1.6 7 5" />
        </svg>
      </span>}
      <span className={compact ? 'cuentaTexto' : undefined}>Mi cuenta</span>
    </summary>
    <form className="auth-form" onSubmit={save}>
      <label>Tu nombre visible
        <input value={nombre} onChange={event => setNombre(event.target.value)} autoComplete="name" required minLength={2} maxLength={120} disabled={busy} />
      </label>
      <p className="sub">Tu nombre no cambia los territorios ni los permisos asignados a tu cuenta.</p>
      {contexto?.group_id ? (
        <p className="sub">
          {contexto.group_number ? `Grupo ${contexto.group_number}` : contexto.group_name} ·{' '}
          {contexto.rol_en_grupo === 'superintendente'
            ? 'Superintendente'
            : contexto.rol_en_grupo === 'auxiliar'
              ? 'Auxiliar'
              : contexto.rol_en_grupo === 'conductor'
                ? 'Conductor'
                : 'Publicador'}
          {contexto.miembro_estado === 'pendiente' ? ' · esperando confirmación' : ''}
        </p>
      ) : (
        <p className="sub">Todavía no estás en un grupo.</p>
      )}
      {profile?.driver_id ? (
        <p className="sub">Sos conductor vinculado a: {conductorVinculado ?? 'nombre no disponible'}.</p>
      ) : contexto?.rol_en_grupo === 'conductor' ? (
        <p className="sub">Todavía no te vincularon como conductor. Pedíselo al siervo de territorios.</p>
      ) : null}
      {cambiandoGrupo ? (
        <section className="panel">
          <p className="sub">El código nuevo cierra tu pertenencia actual y te deja esperando confirmación en el otro grupo.</p>
          <CampoCodigoGrupo
            ocupado={busy}
            alUnir={async (codigo) => {
              if (!supabase) return 'Todavía no está la conexión.'
              if (!window.confirm('¿Cambiás de grupo? Vas a dejar de ver la salida del grupo actual.')) return 'No se cambió el grupo.'
              setBusy(true)
              const { error: joinError } = await supabase.rpc('unirme_a_grupo', { p_codigo: codigo })
              setBusy(false)
              if (joinError) return joinError.message
              setCambiandoGrupo(false)
              retryAuth()
              return null
            }}
          />
          <button type="button" className="boton secundario" disabled={busy} onClick={() => setCambiandoGrupo(false)}>Cancelar</button>
        </section>
      ) : (
        <button className="boton secundario" disabled={busy} type="button" onClick={() => setCambiandoGrupo(true)}>
          {contexto?.group_id ? 'Cambiar de grupo' : 'Sumarme a un grupo'}
        </button>
      )}
      {error && <p className="nota" role="alert">{error}</p>}
      <button className="boton principal" disabled={busy} type="submit">{busy ? 'Procesando…' : 'Guardar nombre'}</button>
      <button className="boton secundario" disabled={busy} type="button" onClick={() => void leave()}>Cerrar sesión</button>
    </form>
  </details>
}
