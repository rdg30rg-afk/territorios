import { useEffect, useRef, useState } from 'react'
import { BuscadorPunto } from './BuscadorPunto'
import { ElegirDeLista } from './ElegirDeLista'
import { MeetingPointPickerMap } from './MeetingPointPickerMap'
import { supabase } from '../lib/supabase'
import { useAuth } from '../context/useAuth'
import { decirElError } from '../lib/decirElError'
import '../styles/hoja-grupo.css'
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
  const { profile } = useAuth()
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
  const [cargando, setCargando] = useState(true)
  const [falloCarga, setFalloCarga] = useState(false)
  const [reintento, setReintento] = useState(0)
  const [miembroParaSacar, setMiembroParaSacar] = useState<Miembro | null>(null)
  const [exito, setExito] = useState<string | null>(null)
  const cuerpo = useRef<HTMLDivElement>(null)
  const seccionTerritorio = useRef<HTMLElement>(null)
  const seccionSacar = useRef<HTMLElement>(null)

  // Mientras la hoja está abierta el fondo no se mueve: antes el dedo
  // arrastraba la pantalla de atrás y la hoja quedaba inalcanzable.
  useEffect(() => {
    if (!abierto) return
    const raiz = document.documentElement
    raiz.classList.add('hoja-grupo-abierta')
    return () => raiz.classList.remove('hoja-grupo-abierta')
  }, [abierto])

  // Escape cierra solo esta hoja. Abierta desde la ficha del panel, el mismo
  // Escape cerraba también la ventana de atrás. Se escucha primero (captura) y
  // se frena la propagación; si arriba de la hoja hay otra capa (una lista para
  // elegir), esa capa se ocupa de su Escape y acá solo se evita que el
  // navegador cierre la ventana de atrás.
  const raizHoja = useRef<HTMLDivElement>(null)
  const onCerrarRef = useRef(onCerrar)
  useEffect(() => { onCerrarRef.current = onCerrar }, [onCerrar])
  useEffect(() => {
    if (!abierto || !contexto.group_id) return
    const tecla = (evento: KeyboardEvent) => {
      if (evento.key !== 'Escape') return
      evento.preventDefault()
      const capas = document.querySelectorAll('.sobre[role="dialog"]')
      if (capas.length && capas[capas.length - 1] !== raizHoja.current) return
      evento.stopPropagation()
      onCerrarRef.current()
    }
    document.addEventListener('keydown', tecla, true)
    return () => document.removeEventListener('keydown', tecla, true)
  }, [abierto, contexto.group_id])

  // Los formularios se abren abajo de todo de la lista: se los trae a la vista.
  useEffect(() => {
    if (miembroParaTerritorio) seccionTerritorio.current?.scrollIntoView({ block: 'center', behavior: 'smooth' })
  }, [miembroParaTerritorio])
  useEffect(() => {
    if (miembroParaSacar) seccionSacar.current?.scrollIntoView({ block: 'center', behavior: 'smooth' })
  }, [miembroParaSacar])
  // Un aviso nuevo también se trae a la vista (arriba del cuerpo).
  useEffect(() => {
    if (aviso || exito) cuerpo.current?.scrollTo({ top: 0, behavior: 'smooth' })
  }, [aviso, exito])

  useEffect(() => {
    if (!abierto || !supabase || !contexto.group_id) return
    let vivo = true
    setCargando(true)
    setFalloCarga(false)
    void (async () => {
      const [
        { data: filas, error: errFilas },
        { data: inv, error: errInv },
        { data: puntoGrupo },
        { data: puntosData },
        { data: territoriosData },
      ] = await Promise.all([
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
      const { data: perfiles, error: errPerfiles } = ids.length
        ? await supabase.from('profiles').select('id, full_name, driver_id').in('id', ids)
        : { data: [], error: null }
      if (!vivo) return
      // Sin los hermanos no se puede decir «0 hermanos»: no se sabe.
      if (errFilas || errPerfiles || errInv) {
        setFalloCarga(true)
        setCargando(false)
        return
      }
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
      setCargando(false)
    })().catch(() => {
      if (!vivo) return
      setFalloCarga(true)
      setCargando(false)
    })
    return () => {
      vivo = false
    }
  }, [abierto, contexto.group_id, reintento])

  if (!abierto || !contexto.group_id) return null

  const pendientes = miembros.filter((m) => m.estado === 'pendiente')
  const confirmados = miembros.filter((m) => m.estado === 'confirmado')
  const grupo = contexto.group_number ? `Grupo ${contexto.group_number}` : contexto.group_name ?? 'Tu grupo'

  const decidir = async (id: string, accion: 'confirmar' | 'rechazar' | 'cambiar_rol', rol?: RolEnGrupo): Promise<boolean> => {
    if (!supabase || ocupado) return false
    setOcupado(true)
    setAviso(null)
    setExito(null)
    const { error } = await supabase.rpc('confirmar_miembro', {
      p_miembro_id: id,
      p_accion: accion,
      p_rol: rol ?? null,
    })
    setOcupado(false)
    if (error) {
      setAviso(decirElError(error, 'No se pudo hacer el cambio en el grupo.'))
      return false
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
    return true
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
      setAviso(decirElError(error, 'No se pudo guardar el punto.'))
      return
    }
    setExito('Guardamos el punto del grupo.')
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
      setAviso(decirElError(error, 'No se pudo dar el territorio.'))
      return
    }
    setTerritorios((actuales) => actuales.filter((territorio) => territorio.id !== territorioElegido))
    setMiembroParaTerritorio(null)
    setTerritorioElegido('')
    setExito(`Territorio asignado a ${miembroParaTerritorio.full_name}.`)
    onCambio()
  }

  const renovar = async () => {
    if (!supabase || ocupado) return
    if (codigo && !window.confirm('El código viejo deja de servir. ¿Lo cambiás?')) return
    setOcupado(true)
    setAviso(null)
    setExito(null)
    const { data, error } = await supabase.rpc('renovar_codigo_grupo', { p_group_id: contexto.group_id })
    setOcupado(false)
    if (error) {
      setAviso(decirElError(error, 'No se pudo cambiar el código.'))
      return
    }
    setCodigo(typeof data === 'string' ? data : null)
    setExito('Listo, el código quedó cambiado.')
  }

  const esUnoMismo = (m: Miembro) => m.profile_id === profile?.id
  const esResponsable = (m: Miembro) => m.rol_en_grupo === 'superintendente' || m.rol_en_grupo === 'siervo'

  const sacarDelGrupo = async () => {
    const m = miembroParaSacar
    if (!m) return
    const eraUnoMismo = esUnoMismo(m)
    const salio = await decidir(m.id, 'rechazar')
    setMiembroParaSacar(null)
    if (!salio) return
    if (eraUnoMismo) onCerrar()
    else setExito(`${m.full_name} ya no está en el grupo.`)
  }

  const compartir = () => {
    if (!codigo) return
    const texto = encodeURIComponent(
      `Sumate al ${grupo} en Territorios. El código es ${codigo}.`,
    )
    window.open(`https://wa.me/?text=${texto}`, '_blank', 'noopener,noreferrer')
  }

  return (
    <div ref={raizHoja} className="sobre hoja-grupo" role="dialog" aria-modal="true" aria-label={`Mi grupo · ${grupo}`}>
      <div className="sobreBarra">
        <h2>
          {grupo}
          <small>{cargando ? 'Cargando…' : falloCarga ? 'No se pudo cargar' : `${confirmados.length} ${confirmados.length === 1 ? 'hermano' : 'hermanos'}`}</small>
        </h2>
        <button type="button" className="boton secundario" onClick={onCerrar}>
          <Icono nombre="cerrar" tamaño={18} />
          Cerrar
        </button>
      </div>
      <div ref={cuerpo} className="sobreCuerpo hoja-grupo-cuerpo elegir-lista-cuerpo">
        {aviso ? (
          <p className="nota error" role="alert">
            {aviso}
          </p>
        ) : null}
        {exito && !aviso ? (
          <p className="nota ok" role="status">
            {exito}
          </p>
        ) : null}
        {falloCarga ? (
          <div className="nota error" role="alert">
            <p>No pudimos cargar los datos del grupo. Fijate si tenés internet.</p>
            <button type="button" className="boton secundario" onClick={() => setReintento((n) => n + 1)}>
              <Icono nombre="reintentar" tamaño={18} />
              Probar de nuevo
            </button>
          </div>
        ) : null}

        {pendientes.length > 0 ? (
          <section className="panel">
            <h2>Esperan confirmación</h2>
            {pendientes.map((m) => (
              <article key={m.id} className="panel panel-plano">
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
              {puntoCoordenadas ? ' · Con cómo llegar' : ''}
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
              <p className="sub">Escribí una esquina, una casa o Zoom. El mapa es solo para mostrar cómo llegar.</p>
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
            <Icono nombre="reintentar" tamaño={18} />
            {codigo ? 'Cambiar el código' : 'Crear el código'}
          </button>
        </section>

        <section className="panel">
          <h2>Hermanos del grupo</h2>
          {cargando ? <p className="sub" role="status">Cargando los hermanos…</p> : null}
          {!cargando && !falloCarga && confirmados.length === 0 ? (
            <p className="sub">Todavía no hay hermanos confirmados en el grupo.</p>
          ) : null}
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
                  onClick={() => setMiembroParaSacar(m)}
                >
                  <Icono nombre="eliminar" tamaño={18} />
                  {esUnoMismo(m) ? 'Salir del grupo' : 'Sacarlo del grupo'}
                </button>
              </article>
            ))}
          </div>
        </section>

        {miembroParaSacar ? (
          <section
            ref={seccionSacar}
            className="panel confirmar-sacar"
            role="alertdialog"
            aria-label={`Sacar a ${miembroParaSacar.full_name} del grupo`}
          >
            <h2>{esUnoMismo(miembroParaSacar) ? '¿Salir del grupo?' : `¿Sacar a ${miembroParaSacar.full_name}?`}</h2>
            <p>
              {esUnoMismo(miembroParaSacar)
                ? `Vas a salir del ${grupo}${esResponsable(miembroParaSacar) ? ' y el grupo se queda sin vos a cargo' : ''}. Dejás de ver la salida del grupo y de poder administrarlo. Para volver necesitás el código y que te confirmen.`
                : esResponsable(miembroParaSacar)
                  ? `${miembroParaSacar.full_name} está a cargo del grupo (${rotuloRolGrupo(miembroParaSacar.rol_en_grupo)}). Si lo sacás, el grupo se queda sin ese responsable y para ponerlo de nuevo hay que pedírselo a un administrador.`
                  : `${miembroParaSacar.full_name} deja de ver la salida del grupo. Puede volver con el código, y alguien tiene que confirmarlo.`}
            </p>
            <button type="button" className="boton peligro" disabled={ocupado} onClick={() => void sacarDelGrupo()}>
              <Icono nombre="eliminar" tamaño={18} />
              {esUnoMismo(miembroParaSacar) ? 'Sí, salir del grupo' : `Sí, sacar a ${miembroParaSacar.full_name}`}
            </button>
            <button type="button" className="boton secundario" disabled={ocupado} onClick={() => setMiembroParaSacar(null)}>
              <Icono nombre="cerrar" tamaño={18} />
              No, dejarlo como está
            </button>
          </section>
        ) : null}

        {miembroParaTerritorio ? (
          <section ref={seccionTerritorio} className="panel" aria-label={`Darle un territorio a ${miembroParaTerritorio.full_name}`}>
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
