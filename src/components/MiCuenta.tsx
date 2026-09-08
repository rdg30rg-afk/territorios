import { useEffect, useState, type FormEvent } from 'react'
import { CampoCodigoGrupo } from './CampoCodigoGrupo'
import { useAuth } from '../context/useAuth'
import { supabase } from '../lib/supabase'
import type { ContextoHermano } from '../lib/vistaHermano'
import { Icono } from './Icono'

type MiCuentaProps = {
  compact?: boolean
}

function nombreDelRol(rol: ContextoHermano['rol_en_grupo']) {
  if (rol === 'superintendente') return 'Superintendente'
  if (rol === 'auxiliar') return 'Auxiliar'
  if (rol === 'siervo') return 'Siervo de grupo'
  return 'Publicador'
}

// El código se pide en su propia hoja y no dentro del popover. Metido ahí
// adentro, el aviso de que cambiar de grupo cierra la pertenencia actual
// aparecía apretado entre dos botones, y la lista de acciones pasaba de tres
// a seis sin que nada explicara por qué.
function HojaGrupoCodigo({
  cambio,
  onCerrar,
  onListo,
}: {
  cambio: boolean
  onCerrar: () => void
  onListo: () => void
}) {
  const [ocupado, setOcupado] = useState(false)

  useEffect(() => {
    const tecla = (evento: KeyboardEvent) => {
      if (evento.key === 'Escape') onCerrar()
    }
    document.addEventListener('keydown', tecla)
    return () => document.removeEventListener('keydown', tecla)
  }, [onCerrar])

  const titulo = cambio ? 'Cambiar de grupo' : 'Sumarme a un grupo'

  return (
    <div className="sobre" role="dialog" aria-modal="true" aria-label={titulo}>
      <div className="sobreBarra">
        <h2>
          {titulo}
          <small>Te lo pasa el superintendente</small>
        </h2>
        <button type="button" className="boton secundario" onClick={onCerrar}>
          <Icono nombre="cerrar" tamaño={18} />
          Cerrar
        </button>
      </div>
      <div className="sobreCuerpo hoja-cuerpo">
        {cambio ? (
          <p className="nota">
            <Icono nombre="grupo" tamaño={20} />
            <span>
              El código nuevo cierra tu pertenencia al grupo actual y te deja
              esperando confirmación en el otro. Vas a dejar de ver la salida
              del grupo de ahora.
            </span>
          </p>
        ) : null}
        <CampoCodigoGrupo
          ocupado={ocupado}
          alUnir={async (codigo) => {
            if (!supabase) return 'Todavía no está la conexión.'
            setOcupado(true)
            const { error } = await supabase.rpc('unirme_a_grupo', { p_codigo: codigo })
            setOcupado(false)
            if (error) {
              return /ningún grupo|ningun grupo|22023/i.test(error.message)
                ? 'Ese código no es de ningún grupo. Fijate si lo copiaste bien.'
                : error.message
            }
            onListo()
            return null
          }}
        />
      </div>
    </div>
  )
}

export function MiCuenta({ compact = false }: MiCuentaProps) {
  const { profile, contexto, signOut, retryAuth } = useAuth()
  const [nombre, setNombre] = useState(profile?.full_name ?? '')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [hojaGrupo, setHojaGrupo] = useState(false)
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
  // Lima es "esto es lo que hay que hacer aca". Con "Guardar nombre" siempre
  // lima, el popover gritaba una accion que casi nunca hace falta y tapaba a
  // la que si: sumarse a un grupo.
  const nombreCambio = nombre.trim() !== (profile?.full_name ?? '').trim()
  const leave = async () => {
    if (busy) return
    setBusy(true); setError(null)
    try { await signOut() }
    catch { setError('No pudimos cerrar la sesión. Volvé a intentar.') }
    finally { setBusy(false) }
  }

  // Tres cosas y en este orden: como te llamas, en que grupo estas, y la
  // sesion. Antes eran seis controles del mismo peso en una sola columna.
  return <>
    <details className={compact ? 'miCuenta compacto' : 'panel'}>
      <summary className="boton secundario cuenta-resumen" aria-label="Abrir Mi cuenta">
        {compact && <span className="cuentaIcono" aria-hidden="true">
          <Icono nombre="persona" tamaño={20} />
        </span>}
        <span className={compact ? 'cuentaTexto' : undefined}>Mi cuenta</span>
      </summary>
      <form className="auth-form" onSubmit={save}>
        <label>Tu nombre visible
          <input value={nombre} onChange={event => setNombre(event.target.value)} autoComplete="name" required minLength={2} maxLength={120} disabled={busy} />
        </label>
        <button
          className={nombreCambio ? 'boton principal' : 'boton secundario'}
          disabled={busy || !nombreCambio}
          type="submit"
        >{busy ? 'Procesando…' : 'Guardar nombre'}</button>

        <p className="cuentaGrupo">
          {contexto?.group_id ? (
            <>
              <strong>
                {contexto.group_number ? `Grupo ${contexto.group_number}` : contexto.group_name}
                {' · '}
                {nombreDelRol(contexto.rol_en_grupo)}
              </strong>
              {contexto.miembro_estado === 'pendiente' ? <small>Esperando confirmación</small> : null}
            </>
          ) : (
            <strong>Todavía no estás en un grupo</strong>
          )}
          {profile?.driver_id ? (
            <small>Conductor: {conductorVinculado ?? 'nombre no disponible'}</small>
          ) : null}
        </p>
        <button
          className="boton secundario"
          disabled={busy}
          type="button"
          onClick={(event) => {
            // El popover se cierra al abrir la hoja: dos capas apiladas
            // diciendo cosas distintas sobre el mismo grupo es una de mas.
            event.currentTarget.closest('details')?.removeAttribute('open')
            setHojaGrupo(true)
          }}
        >
          <Icono nombre="grupo" tamaño={18} />
          {contexto?.group_id ? 'Cambiar de grupo' : 'Sumarme a un grupo'}
        </button>

        {error && <p className="nota" role="alert">{error}</p>}
        <button className="boton chico" disabled={busy} type="button" onClick={() => void leave()}>
          <Icono nombre="cerrar" tamaño={18} />
          Cerrar sesión
        </button>
      </form>
    </details>
    {hojaGrupo ? (
      <HojaGrupoCodigo
        cambio={Boolean(contexto?.group_id)}
        onCerrar={() => setHojaGrupo(false)}
        onListo={() => { setHojaGrupo(false); retryAuth() }}
      />
    ) : null}
  </>
}
