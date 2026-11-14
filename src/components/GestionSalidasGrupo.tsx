import { useEffect, useMemo, useRef, useState } from 'react'
import { supabase } from '../lib/supabase'
import { decirElError } from '../lib/decirElError'
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

function claveDe(fecha: Date) {
  return `${fecha.getFullYear()}-${String(fecha.getMonth() + 1).padStart(2, '0')}-${String(fecha.getDate()).padStart(2, '0')}`
}

function claveHoy() {
  return claveDe(new Date())
}

/**
 * Qué día y hora proponer. Hoy a las 10 casi nunca es lo que se quiere.
 * Si el grupo ya tiene salidas, se repite su día y su hora una semana
 * después de la última; si no tiene ninguna, el próximo sábado a las 10.
 */
function proponerSalida(salidas: Array<{ scheduled_for: string }>, ahora = new Date()): { fecha: string; hora: string } {
  const hoy = new Date(ahora.getFullYear(), ahora.getMonth(), ahora.getDate())
  const ultima = salidas.length ? new Date(salidas[salidas.length - 1].scheduled_for) : null
  if (ultima && !Number.isNaN(ultima.getTime())) {
    const dia = new Date(ultima.getFullYear(), ultima.getMonth(), ultima.getDate() + 7)
    while (dia < hoy) dia.setDate(dia.getDate() + 7)
    return {
      fecha: claveDe(dia),
      hora: `${String(ultima.getHours()).padStart(2, '0')}:${String(ultima.getMinutes()).padStart(2, '0')}`,
    }
  }
  const sabado = new Date(hoy)
  sabado.setDate(sabado.getDate() + ((6 - hoy.getDay() + 7) % 7))
  return { fecha: claveDe(sabado), hora: '10:00' }
}

const porNombre = (a: { name: string }, b: { name: string }) =>
  a.name.localeCompare(b.name, 'es', { numeric: true })

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
  const [fecha, setFecha] = useState(() => proponerSalida([]).fecha)
  const [hora, setHora] = useState('10:00')
  const [territorioId, setTerritorioId] = useState('')
  const [conductorId, setConductorId] = useState('')
  const [abierto, setAbierto] = useState(false)
  const [cargando, setCargando] = useState(true)
  const [guardando, setGuardando] = useState(false)
  const [aviso, setAviso] = useState<string | null>(null)
  const [avisoEsError, setAvisoEsError] = useState(false)
  const formulario = useRef<HTMLDivElement>(null)
  const tocoFecha = useRef(false)
  const [lugar, setLugar] = useState(contexto.punto_grupo_nombre ?? '')

  const avisar = (texto: string | null, esError = false) => {
    setAviso(texto)
    setAvisoEsError(esError)
  }

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
      avisar(decirElError(error, 'No pudimos cargar las salidas del grupo.'), true)
    } else {
      const lista = ((territoriosResult.data as Opcion[] | null) ?? []).slice().sort(porNombre)
      const gente = ((conductoresResult.data as Array<{ id: string; full_name: string }> | null) ?? [])
        .slice()
        .sort((a, b) => a.full_name.localeCompare(b.full_name, 'es'))
      const proximas = (salidasResult.data as SalidaGrupo[] | null) ?? []
      setTerritorios(lista)
      setConductores(gente)
      setSalidas(proximas)
      if (!tocoFecha.current) {
        const propuesta = proponerSalida(proximas)
        setFecha(propuesta.fecha)
        setHora(propuesta.hora)
      }
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
  const lugarEscrito = lugar.trim()
  const usaPuntoDelGrupo = lugarEscrito.length > 0
    && lugarEscrito === (contexto.punto_grupo_nombre ?? '').trim()
    && Boolean(contexto.punto_grupo_id)
  const lat = usaPuntoDelGrupo ? contexto.punto_grupo_lat : null
  const lng = usaPuntoDelGrupo ? contexto.punto_grupo_lng : null

  const guardar = async () => {
    if (!supabase || !contexto.group_id || guardando) return
    const instante = new Date(`${fecha}T${hora}:00`)
    if (!fecha || !hora || !territorioId || !conductorId || lugarEscrito.length < 2 || Number.isNaN(instante.getTime())) {
      avisar('Elegí fecha, hora, territorio, conductor y dónde se juntan.', true)
      return
    }
    setGuardando(true)
    avisar(null)
    const nombreGrupo = contexto.group_number ? `Grupo ${contexto.group_number}` : contexto.group_name ?? 'tu grupo'
    const { error } = await supabase.rpc('crear_salida', {
      p_scope: 'grupo',
      p_title: `Salida del ${nombreGrupo}`,
      p_territory_id: territorioId,
      p_driver_id: conductorId,
      p_group_id: contexto.group_id,
      p_meeting_point_id: usaPuntoDelGrupo ? contexto.punto_grupo_id : null,
      p_meeting_point_name: lugarEscrito,
      p_meeting_point_lat: lat,
      p_meeting_point_lng: lng,
      p_scheduled_for: instante.toISOString(),
      p_notes: null,
    })
    setGuardando(false)
    if (error) {
      avisar(decirElError(error, 'No se pudo programar la salida.'), true)
      return
    }
    avisar('La salida quedó programada para tu grupo.')
    setAbierto(false)
    setTerritorioId('')
    setConductorId('')
    await cargar()
    onCambio()
  }

  // El formulario se abre debajo de la lista: se lo trae a la vista.
  useEffect(() => {
    if (abierto) formulario.current?.scrollIntoView({ block: 'start', behavior: 'smooth' })
  }, [abierto])

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

      {aviso ? <p className={avisoEsError ? 'nota error' : 'nota ok'} role={avisoEsError ? 'alert' : 'status'}>{aviso}</p> : null}
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
        <div ref={formulario} className="form-stack gestion-salida-form">
          <label className="sub">
            Dónde se juntan
            <input
              value={lugar}
              onChange={(event) => setLugar(event.target.value)}
              placeholder="Una esquina, una casa o Zoom"
              maxLength={500}
            />
          </label>
          <p className="sub">
            {lat != null && lng != null
              ? 'Con esta ubicación el grupo va a ver cómo llegar.'
              : 'Sin un punto en el mapa no hay cómo llegar, y la salida se puede programar igual.'}
          </p>
          <div className="gestion-salida-fecha">
            <label>Fecha<input type="date" min={claveHoy()} value={fecha} onChange={(event) => { tocoFecha.current = true; setFecha(event.target.value) }} /></label>
            <label>Hora<input type="time" value={hora} onChange={(event) => { tocoFecha.current = true; setHora(event.target.value) }} /></label>
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
          <button type="button" className="boton principal" disabled={guardando || lugarEscrito.length < 2 || !territorioId || !conductorId} onClick={() => void guardar()}>
            <Icono nombre="guardar" tamaño={18} />
            {guardando ? 'Programando…' : 'Guardar la salida'}
          </button>
        </div>
      ) : null}
    </div>
  )
}
