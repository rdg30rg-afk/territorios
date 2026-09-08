import { useEffect, useMemo, useState } from 'react'
import { supabase } from '../lib/supabase'
import type { ContextoHermano } from '../lib/vistaHermano'
import { ElegirDeLista } from './ElegirDeLista'
import { Icono } from './Icono'

type Opcion = { id: string; name: string }
type SalidaGrupo = {
  id: string
  scheduled_for: string
  territory_id: string | null
  driver_id: string | null
}

function claveHoy() {
  const ahora = new Date()
  return `${ahora.getFullYear()}-${String(ahora.getMonth() + 1).padStart(2, '0')}-${String(ahora.getDate()).padStart(2, '0')}`
}

function fechaLegible(iso: string) {
  return new Intl.DateTimeFormat('es-AR', {
    weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit',
  }).format(new Date(iso))
}

export function GestionSalidasGrupo({ contexto, onCambio }: {
  contexto: ContextoHermano
  onCambio: () => void
}) {
  const [territorios, setTerritorios] = useState<Opcion[]>([])
  const [conductores, setConductores] = useState<Array<{ id: string; full_name: string }>>([])
  const [salidas, setSalidas] = useState<SalidaGrupo[]>([])
  const [fecha, setFecha] = useState(claveHoy)
  const [hora, setHora] = useState('10:00')
  const [territorioId, setTerritorioId] = useState('')
  const [conductorId, setConductorId] = useState('')
  const [abierto, setAbierto] = useState(false)
  const [cargando, setCargando] = useState(true)
  const [guardando, setGuardando] = useState(false)
  const [aviso, setAviso] = useState<string | null>(null)

  const cargar = async () => {
    if (!supabase || !contexto.group_id) return
    setCargando(true)
    const desde = new Date(`${claveHoy()}T00:00:00`).toISOString()
    const [territoriosResult, conductoresResult, salidasResult] = await Promise.all([
      supabase.from('territorios').select('id, name').order('name'),
      supabase.rpc('conductores_disponibles_para_salida_grupo', { p_group_id: contexto.group_id }),
      supabase.from('salidas').select('id, scheduled_for, territory_id, driver_id')
        .eq('group_id', contexto.group_id).gte('scheduled_for', desde)
        .order('scheduled_for').limit(12),
    ])
    const error = territoriosResult.error ?? conductoresResult.error ?? salidasResult.error
    if (error) {
      setAviso(`No pudimos cargar las opciones: ${error.message}`)
    } else {
      setTerritorios((territoriosResult.data as Opcion[] | null) ?? [])
      setConductores((conductoresResult.data as Array<{ id: string; full_name: string }> | null) ?? [])
      setSalidas((salidasResult.data as SalidaGrupo[] | null) ?? [])
    }
    setCargando(false)
  }

  useEffect(() => {
    void cargar()
  // La carga se reinicia al cambiar de grupo; el resto se actualiza después de guardar.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [contexto.group_id])

  const nombresTerritorio = useMemo(() => new Map(territorios.map((item) => [item.id, item.name])), [territorios])
  const nombresConductor = useMemo(() => new Map(conductores.map((item) => [item.id, item.full_name])), [conductores])
  const puntoCompleto = Boolean(
    contexto.punto_grupo_id && contexto.punto_grupo_nombre
    && contexto.punto_grupo_lat != null && contexto.punto_grupo_lng != null,
  )

  const guardar = async () => {
    if (!supabase || !contexto.group_id || !puntoCompleto || guardando) return
    const instante = new Date(`${fecha}T${hora}:00`)
    if (!fecha || !hora || !territorioId || !conductorId || Number.isNaN(instante.getTime())) {
      setAviso('Elegí fecha, hora, territorio y conductor.')
      return
    }
    setGuardando(true)
    setAviso(null)
    const nombreGrupo = contexto.group_number ? `Grupo ${contexto.group_number}` : contexto.group_name ?? 'tu grupo'
    const { error } = await supabase.rpc('crear_salida', {
      p_scope: 'grupo',
      p_title: `Salida del ${nombreGrupo}`,
      p_territory_id: territorioId,
      p_driver_id: conductorId,
      p_group_id: contexto.group_id,
      p_meeting_point_id: contexto.punto_grupo_id,
      p_meeting_point_name: contexto.punto_grupo_nombre,
      p_meeting_point_lat: contexto.punto_grupo_lat,
      p_meeting_point_lng: contexto.punto_grupo_lng,
      p_scheduled_for: instante.toISOString(),
      p_notes: null,
    })
    setGuardando(false)
    if (error) {
      setAviso(error.message)
      return
    }
    setAviso('La salida quedó programada para tu grupo.')
    setAbierto(false)
    setTerritorioId('')
    setConductorId('')
    await cargar()
    onCambio()
  }

  return (
    <div className="gestion-salidas-grupo">
      <div className="gestion-salidas-grupo-cabecera">
        <div>
          <h3>Próximas salidas</h3>
          <p className="sub">Las que preparó tu grupo.</p>
        </div>
        <button type="button" className="boton secundario" onClick={() => setAbierto((valor) => !valor)} aria-expanded={abierto}>
          <Icono nombre={abierto ? 'cerrar' : 'salidas'} tamaño={18} />
          {abierto ? 'Cancelar' : 'Programar salida'}
        </button>
      </div>

      {aviso ? <p className="nota" role="status">{aviso}</p> : null}
      {cargando ? <p role="status">Cargando salidas…</p> : null}
      {!cargando && salidas.length === 0 ? <p className="sub">Todavía no hay salidas propias del grupo.</p> : null}
      {salidas.length > 0 ? (
        <ul className="salidas-grupo-resumen">
          {salidas.map((salida) => (
            <li key={salida.id}>
              <strong>{fechaLegible(salida.scheduled_for)}</strong>
              <span>{salida.territory_id ? `Territorio ${nombresTerritorio.get(salida.territory_id) ?? 'sin nombre'}` : 'Sin territorio'}</span>
              <span>{salida.driver_id ? `Conduce ${nombresConductor.get(salida.driver_id) ?? 'sin vincular'}` : 'Sin conductor'}</span>
            </li>
          ))}
        </ul>
      ) : null}

      {abierto ? (
        <div className="form-stack gestion-salida-form">
          {!puntoCompleto ? (
            <p className="nota" role="alert">Primero cargá arriba el punto del grupo con su ubicación en el mapa.</p>
          ) : (
            <p className="sub">Se sale de {contexto.punto_grupo_nombre}.</p>
          )}
          <div className="gestion-salida-fecha">
            <label>Fecha<input type="date" min={claveHoy()} value={fecha} onChange={(event) => setFecha(event.target.value)} /></label>
            <label>Hora<input type="time" value={hora} onChange={(event) => setHora(event.target.value)} /></label>
          </div>
          <ElegirDeLista
            etiqueta="Territorio"
            valor={territorioId}
            vacio="Elegí un territorio"
            alElegir={setTerritorioId}
            opciones={territorios.map((item) => ({ valor: item.id, texto: `Territorio ${item.name}` }))}
          />
          <ElegirDeLista
            etiqueta="Conductor"
            valor={conductorId}
            vacio="Elegí quién conduce"
            alElegir={setConductorId}
            opciones={conductores.map((item) => ({ valor: item.id, texto: item.full_name }))}
          />
          {conductores.length === 0 ? <p className="sub">No hay conductores activos para asignar. El siervo de territorios debe vincularlos.</p> : null}
          <button type="button" className="boton principal" disabled={guardando || !puntoCompleto || !territorioId || !conductorId} onClick={() => void guardar()}>
            <Icono nombre="guardar" tamaño={18} />
            {guardando ? 'Programando…' : 'Guardar la salida'}
          </button>
        </div>
      ) : null}
    </div>
  )
}
