import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import { rotuloRolGrupo, type ContextoHermano, type RolEnGrupo } from '../lib/vistaHermano'

type Miembro = {
  id: string
  profile_id: string
  rol_en_grupo: RolEnGrupo
  estado: 'pendiente' | 'confirmado' | 'retirado'
  created_at: string
  full_name: string
}

type HojaMiGrupoProps = {
  contexto: ContextoHermano
  abierto: boolean
  onCerrar: () => void
  onCambio: () => void
}

function haceDias(iso: string): string {
  const dias = Math.max(0, Math.floor((Date.now() - new Date(iso).getTime()) / 86400000))
  if (dias === 0) return 'se sumó hoy'
  if (dias === 1) return 'se sumó ayer'
  return `se sumó hace ${dias} días`
}

export function HojaMiGrupo({ contexto, abierto, onCerrar, onCambio }: HojaMiGrupoProps) {
  const [miembros, setMiembros] = useState<Miembro[]>([])
  const [codigo, setCodigo] = useState<string | null>(null)
  const [aviso, setAviso] = useState<string | null>(null)
  const [ocupado, setOcupado] = useState(false)
  const [puntoNombre, setPuntoNombre] = useState(contexto.punto_grupo_nombre ?? '')
  const [editandoPunto, setEditandoPunto] = useState(false)

  useEffect(() => {
    if (!abierto || !supabase || !contexto.group_id) return
    let vivo = true
    void (async () => {
      const [{ data: filas }, { data: inv }] = await Promise.all([
        supabase
          .from('grupo_miembros')
          .select('id, profile_id, rol_en_grupo, estado, created_at')
          .eq('group_id', contexto.group_id)
          .is('hasta', null)
          .order('created_at', { ascending: false }),
        supabase
          .from('grupo_invitaciones')
          .select('codigo')
          .eq('group_id', contexto.group_id)
          .maybeSingle(),
      ])
      const ids = [...new Set((filas ?? []).map((fila) => fila.profile_id))]
      const { data: perfiles } = ids.length
        ? await supabase.from('profiles').select('id, full_name').in('id', ids)
        : { data: [] }
      if (!vivo) return
      const nombres = new Map(
        ((perfiles ?? []) as Array<{ id: string; full_name: string | null }>).map((perfil) => [
          perfil.id,
          perfil.full_name?.trim() || 'Sin nombre',
        ]),
      )
      setMiembros(
        ((filas ?? []) as Array<{
          id: string
          profile_id: string
          rol_en_grupo: RolEnGrupo
          estado: Miembro['estado']
          created_at: string
        }>).map((fila) => ({
          id: fila.id,
          profile_id: fila.profile_id,
          rol_en_grupo: fila.rol_en_grupo,
          estado: fila.estado,
          created_at: fila.created_at,
          full_name: nombres.get(fila.profile_id) ?? 'Sin nombre',
        })),
      )
      setCodigo(inv?.codigo ?? null)
    })()
    return () => {
      vivo = false
    }
  }, [abierto, contexto.group_id])

  if (!abierto || !contexto.group_id) return null

  const pendientes = miembros.filter((m) => m.estado === 'pendiente')
  const confirmados = miembros.filter((m) => m.estado === 'confirmado')
  const grupo = contexto.group_number ? `Grupo ${contexto.group_number}` : contexto.group_name ?? 'Tu grupo'

  const decidir = async (id: string, accion: 'confirmar' | 'rechazar' | 'cambiar_rol', rol?: RolEnGrupo) => {
    if (!supabase || ocupado) return
    setOcupado(true)
    setAviso(null)
    const { error } = await supabase.rpc('confirmar_miembro', {
      p_miembro_id: id,
      p_accion: accion,
      p_rol: rol ?? null,
    })
    setOcupado(false)
    if (error) {
      setAviso(error.message)
      return
    }
    setMiembros((actuales) =>
      actuales
        .map((m) =>
          m.id !== id
            ? m
            : accion === 'rechazar'
              ? { ...m, estado: 'retirado' as const }
              : accion === 'cambiar_rol'
                ? { ...m, rol_en_grupo: rol ?? m.rol_en_grupo }
                : { ...m, estado: 'confirmado' as const },
        )
        .filter((m) => m.estado !== 'retirado'),
    )
    onCambio()
  }

  const guardarPunto = async () => {
    if (!supabase || ocupado) return
    setOcupado(true)
    setAviso(null)
    const { error } = await supabase.rpc('definir_punto_de_grupo', {
      p_group_id: contexto.group_id,
      p_nombre: puntoNombre.trim(),
      p_lat: contexto.punto_grupo_lat,
      p_lng: contexto.punto_grupo_lng,
    })
    setOcupado(false)
    if (error) {
      setAviso(error.message)
      return
    }
    setEditandoPunto(false)
    onCambio()
  }

  const renovar = async () => {
    if (!supabase || ocupado) return
    if (!window.confirm('El código viejo deja de servir. ¿Lo cambiás?')) return
    setOcupado(true)
    const { data, error } = await supabase.rpc('renovar_codigo_grupo', { p_group_id: contexto.group_id })
    setOcupado(false)
    if (error) {
      setAviso(error.message)
      return
    }
    setCodigo(typeof data === 'string' ? data : null)
  }

  const compartir = () => {
    if (!codigo) return
    const texto = encodeURIComponent(
      `Sumate al ${grupo} en Territorios. El código es ${codigo}.`,
    )
    window.open(`https://wa.me/?text=${texto}`, '_blank', 'noopener,noreferrer')
  }

  return (
    <div className="sobre" role="dialog" aria-modal="true" aria-label={`Mi grupo · ${grupo}`}>
      <div className="sobreBarra">
        <h2>
          {grupo}
          <small>{confirmados.length} hermanos</small>
        </h2>
        <button type="button" className="boton secundario" onClick={onCerrar}>
          Cerrar
        </button>
      </div>
      <div className="sobreCuerpo elegir-lista-cuerpo">
        {aviso ? (
          <p className="nota" role="alert">
            {aviso}
          </p>
        ) : null}

        {pendientes.length > 0 ? (
          <section className="panel">
            <h2>Esperan confirmación</h2>
            {pendientes.map((m) => (
              <article key={m.id} className="panel" style={{ boxShadow: 'none' }}>
                <p>
                  <strong>{m.full_name}</strong>
                  <span className="sub"> · {haceDias(m.created_at)}</span>
                </p>
                <button
                  type="button"
                  className="boton principal"
                  disabled={ocupado}
                  onClick={() => void decidir(m.id, 'confirmar')}
                >
                  Confirmar
                </button>
                <button
                  type="button"
                  className="boton secundario"
                  disabled={ocupado}
                  onClick={() => void decidir(m.id, 'rechazar')}
                >
                  No es del grupo
                </button>
              </article>
            ))}
          </section>
        ) : null}

        <section className="panel">
          <h2>La salida del grupo</h2>
          {contexto.punto_grupo_nombre ? (
            <p>
              {contexto.punto_grupo_nombre}
              {contexto.punto_grupo_lat != null ? ' · GPS listo' : ' · Falta el GPS'}
            </p>
          ) : (
            <p className="sub">Todavía no cargaron dónde se junta el grupo.</p>
          )}
          {editandoPunto ? (
            <>
              <label className="sub">
                Dónde se juntan
                <input
                  className="boton secundario"
                  value={puntoNombre}
                  onChange={(evento) => setPuntoNombre(evento.target.value)}
                />
              </label>
              <button type="button" className="boton principal" disabled={ocupado} onClick={() => void guardarPunto()}>
                Guardar el punto
              </button>
            </>
          ) : (
            <button type="button" className="boton secundario" onClick={() => setEditandoPunto(true)}>
              {contexto.punto_grupo_nombre ? 'Cambiar el punto' : 'Cargar el punto'}
            </button>
          )}
        </section>

        <section className="panel">
          <h2>Código para sumarse</h2>
          <p className="codigo-grande">{codigo ?? '————'}</p>
          <button type="button" className="boton principal" disabled={!codigo} onClick={compartir}>
            Compartir por WhatsApp
          </button>
          <button type="button" className="boton secundario" disabled={ocupado} onClick={() => void renovar()}>
            Cambiar el código
          </button>
        </section>

        <section className="panel">
          <h2>Hermanos del grupo</h2>
          <div className="lista-hermanos">
            {confirmados.map((m) => (
              <article key={m.id}>
                <p>
                  <strong>{m.full_name}</strong>
                  <span className="sub"> · {rotuloRolGrupo(m.rol_en_grupo)}</span>
                </p>
                {m.rol_en_grupo === 'publicador' ? (
                  <button
                    type="button"
                    className="boton secundario"
                    disabled={ocupado}
                    onClick={() => void decidir(m.id, 'cambiar_rol', 'conductor')}
                  >
                    Es conductor
                  </button>
                ) : m.rol_en_grupo === 'conductor' ? (
                  <button
                    type="button"
                    className="boton secundario"
                    disabled={ocupado}
                    onClick={() => void decidir(m.id, 'cambiar_rol', 'publicador')}
                  >
                    Ya no conduce
                  </button>
                ) : null}
                <button
                  type="button"
                  className="boton secundario"
                  disabled={ocupado}
                  onClick={() => void decidir(m.id, 'rechazar')}
                >
                  Sacarlo del grupo
                </button>
              </article>
            ))}
          </div>
        </section>
      </div>
    </div>
  )
}
