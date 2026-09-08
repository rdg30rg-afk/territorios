import { useEffect, useState } from 'react'
import { BuscadorPunto } from './BuscadorPunto'
import { ElegirDeLista } from './ElegirDeLista'
import { MeetingPointPickerMap } from './MeetingPointPickerMap'
import { supabase } from '../lib/supabase'
import type { PuntoEncuentro } from '../lib/puntosEncuentro'
import { rotuloRolGrupo, type ContextoHermano, type RolEnGrupo } from '../lib/vistaHermano'
import { Icono } from './Icono'
import { GestionSalidasGrupo } from './GestionSalidasGrupo'

type Miembro = {
  id: string
  profile_id: string
  rol_en_grupo: RolEnGrupo
  estado: 'pendiente' | 'confirmado' | 'retirado'
  created_at: string
  full_name: string
  driver_id: string | null
}

type TerritorioDisponible = { id: string; name: string }

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
  const [puntoId, setPuntoId] = useState<string | null>(null)
  const [puntoCoordenadas, setPuntoCoordenadas] = useState<[number, number] | null>(
    contexto.punto_grupo_lng != null && contexto.punto_grupo_lat != null
      ? [contexto.punto_grupo_lng, contexto.punto_grupo_lat]
      : null,
  )
  const [puntos, setPuntos] = useState<PuntoEncuentro[]>([])
  const [territorios, setTerritorios] = useState<TerritorioDisponible[]>([])
  const [miembroParaTerritorio, setMiembroParaTerritorio] = useState<Miembro | null>(null)
  const [territorioElegido, setTerritorioElegido] = useState('')
  const [editandoPunto, setEditandoPunto] = useState(false)

  useEffect(() => {
    if (!abierto || !supabase || !contexto.group_id) return
    let vivo = true
    void (async () => {
      const [{ data: filas }, { data: inv }, { data: puntoGrupo }, { data: puntosData }, { data: territoriosData }] = await Promise.all([
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
        supabase
          .from('puntos_encuentro')
          .select('id, nombre, barrio, lat, lng, maps_url, territory_id, activo, codigo, tipo')
          .eq('group_id', contexto.group_id)
          .eq('tipo', 'grupo')
          .eq('activo', true)
          .maybeSingle(),
        supabase
          .from('puntos_encuentro')
          .select('id, nombre, barrio, lat, lng, maps_url, territory_id, activo, codigo, tipo')
          .eq('activo', true)
          .in('tipo', ['territorial', 'especial'])
          .order('codigo', { ascending: true }),
        supabase.rpc('territorios_disponibles_para_grupo', { p_group_id: contexto.group_id }),
      ])
      const ids = [...new Set((filas ?? []).map((fila) => fila.profile_id))]
      const { data: perfiles } = ids.length
        ? await supabase.from('profiles').select('id, full_name, driver_id').in('id', ids)
        : { data: [] }
      if (!vivo) return
      const nombres = new Map(
        ((perfiles ?? []) as Array<{ id: string; full_name: string | null; driver_id: string | null }>).map((perfil) => [
          perfil.id,
          perfil,
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
          full_name: nombres.get(fila.profile_id)?.full_name?.trim() || 'Sin nombre',
          driver_id: nombres.get(fila.profile_id)?.driver_id ?? null,
        })),
      )
      setCodigo(inv?.codigo ?? null)
      const punto = puntoGrupo as PuntoEncuentro | null
      setPuntoNombre(punto?.nombre ?? '')
      setPuntoId(null)
      setPuntoCoordenadas(
        punto?.lng != null && punto.lat != null ? [punto.lng, punto.lat] : null,
      )
      setPuntos((puntosData as PuntoEncuentro[] | null) ?? [])
      setTerritorios((territoriosData as TerritorioDisponible[] | null) ?? [])
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
      p_lat: puntoCoordenadas?.[1] ?? null,
      p_lng: puntoCoordenadas?.[0] ?? null,
      p_maps_url: null,
    })
    setOcupado(false)
    if (error) {
      setAviso(error.message)
      return
    }
    setEditandoPunto(false)
    onCambio()
  }

  const darTerritorio = async () => {
    if (!supabase || !miembroParaTerritorio || !territorioElegido || ocupado) return
    setOcupado(true)
    setAviso(null)
    const { error } = await supabase.rpc('asignar_territorio', {
      p_territory_id: territorioElegido,
      p_assigned_to: miembroParaTerritorio.profile_id,
      p_nota: null,
    })
    setOcupado(false)
    if (error) {
      setAviso(error.message)
      return
    }
    setTerritorios((actuales) => actuales.filter((territorio) => territorio.id !== territorioElegido))
    setMiembroParaTerritorio(null)
    setTerritorioElegido('')
    setAviso(`Territorio asignado a ${miembroParaTerritorio.full_name}.`)
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
          <Icono nombre="cerrar" tamaño={18} />
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
                  <Icono nombre="completo" tamaño={18} />
                  Confirmar
                </button>
                <button
                  type="button"
                  className="boton secundario"
                  disabled={ocupado}
                  onClick={() => void decidir(m.id, 'rechazar')}
                >
                  <Icono nombre="error" tamaño={18} />
                  No es del grupo
                </button>
              </article>
            ))}
          </section>
        ) : null}

        <section className="panel">
          <h2>La salida del grupo</h2>
          {puntoNombre && !editandoPunto ? (
            <p>
              {puntoNombre}
              {puntoCoordenadas ? ' · GPS listo' : ' · Falta el GPS'}
            </p>
          ) : (
            <p className="sub">Todavía no cargaron dónde se junta el grupo.</p>
          )}
          {editandoPunto ? (
            <>
              <label className="sub">
                Dónde se juntan
                <BuscadorPunto
                  puntos={puntos}
                  valorId={puntoId}
                  textoLibre={puntoNombre}
                  etiqueta="Dónde se junta el grupo"
                  alElegir={(punto, texto) => {
                    setPuntoId(punto?.id ?? null)
                    setPuntoNombre(texto)
                    setPuntoCoordenadas(
                      punto?.lng != null && punto.lat != null ? [punto.lng, punto.lat] : null,
                    )
                  }}
                />
              </label>
              <p className="sub">Elegí un punto existente o escribí una esquina. Tocá el mapa para marcar la ubicación exacta.</p>
              <MeetingPointPickerMap
                markerPosition={puntoCoordenadas}
                onPick={setPuntoCoordenadas}
                zoom={13}
              />
              <button type="button" className="boton principal" disabled={ocupado || puntoNombre.trim().length < 2} onClick={() => void guardarPunto()}>
                <Icono nombre="guardar" tamaño={18} />
                Guardar el punto
              </button>
            </>
          ) : (
            <button type="button" className="boton secundario" onClick={() => setEditandoPunto(true)}>
              <Icono nombre="punto" tamaño={18} />
              {contexto.punto_grupo_nombre ? 'Cambiar el punto' : 'Cargar el punto'}
            </button>
          )}
          <GestionSalidasGrupo contexto={contexto} onCambio={onCambio} />
        </section>

        <section className="panel">
          <h2>Código para sumarse</h2>
          <p className="codigo-grande">{codigo ?? '————'}</p>
          <button type="button" className="boton principal" disabled={!codigo} onClick={compartir}>
            <Icono nombre="compartir" tamaño={18} />
            Compartir por WhatsApp
          </button>
          <button type="button" className="boton secundario" disabled={ocupado} onClick={() => void renovar()}>
            <Icono nombre="rehacer" tamaño={18} />
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
                  {m.driver_id ? <span className="sub"> · Conductor vinculado</span> : null}
                </p>
                <button
                  type="button"
                  className="boton secundario"
                  disabled={ocupado}
                  onClick={() => {
                    setMiembroParaTerritorio(m)
                    setTerritorioElegido('')
                  }}
                >
                  <Icono nombre="reservar" tamaño={18} />
                  Darle un territorio
                </button>
                <button
                  type="button"
                  className="boton secundario"
                  disabled={ocupado}
                  onClick={() => void decidir(m.id, 'rechazar')}
                >
                  <Icono nombre="eliminar" tamaño={18} />
                  Sacarlo del grupo
                </button>
              </article>
            ))}
          </div>
        </section>

        {miembroParaTerritorio ? (
          <section className="panel" aria-label={`Darle un territorio a ${miembroParaTerritorio.full_name}`}>
            <h2>Darle un territorio</h2>
            <p className="sub">Para {miembroParaTerritorio.full_name}. Sólo aparecen territorios sin una asignación activa.</p>
            <ElegirDeLista
              etiqueta="Territorio libre"
              valor={territorioElegido}
              vacio="Elegí un territorio"
              opciones={territorios.map((territorio) => ({ valor: territorio.id, texto: territorio.name }))}
              alElegir={setTerritorioElegido}
            />
            <button type="button" className="boton principal" disabled={ocupado || !territorioElegido} onClick={() => void darTerritorio()}>
              <Icono nombre="reservar" tamaño={18} />
              Asignar territorio
            </button>
            <button type="button" className="boton secundario" disabled={ocupado} onClick={() => setMiembroParaTerritorio(null)}>
              <Icono nombre="cerrar" tamaño={18} />
              Cancelar
            </button>
          </section>
        ) : null}
      </div>
    </div>
  )
}
