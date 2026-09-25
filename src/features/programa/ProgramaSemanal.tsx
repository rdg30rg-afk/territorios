/**
 * EL PROGRAMA DEL PERÍODO
 *
 * La pantalla principal donde se arma el programa desde la computadora.
 * La grilla anterior queda disponible temporalmente con
 * `?programa=anterior` mientras termina el pase.
 *
 * Cuatro cosas cambian respecto de la grilla vieja:
 *
 * 1. LAS FILAS SON LAS DE LA CONGREGACIÓN. Salen de la semana de siempre
 *    (`configDeLaCongregacion`), no de catorce filas fijas: el jueves y el
 *    domingo no se sale y no aparecen, y el sábado tiene las Salidas de Grupos
 *    a las 10. Lo que se toca es la excepción: el feriado, la asamblea, esa
 *    semana rara.
 * 2. EL TERRITORIO SE VE. La columna dice hace cuánto que no se trabaja y de
 *    qué turno fue la última vez, que es la decisión que se toma acá.
 * 3. EL MOTOR PROPONE. "Proponer" llena lo que falta con la rotación, la
 *    alternancia de turno y los titulares de cada turno, y cada fila dice por
 *    qué. Nada se guarda hasta apretar Guardar.
 * 4. CADA FILA AVISA. Si el mismo conductor queda dos veces el mismo día, si
 *    un territorio se repite o si al punto le falta la ubicación, se dice ahí
 *    mismo y no al guardar.
 */
import { useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { Desplegable } from '../../components/Desplegable'
import { Icono } from '../../components/Icono'
import { decirElError } from '../../lib/decirElError'
import {
  NOMBRE_DIA,
  NOMBRE_TURNO,
  claveDeFila,
  claveFila,
  configDeLaCongregacion,
  horaHabitual,
  proponerPrograma,
  titularDeLaSemana,
  turnoParaDisponibilidad,
  turnosDelDia,
  type ConductorParaProponer,
  type ConfigSemana,
  type FilaDelPeriodo,
  type TerritorioParaProponer,
  type Turno,
  type TurnoDisponible,
} from '../../lib/programa.ts'
import {
  PRESETS_PROGRAMA,
  aClaveFecha,
  contarDiasInclusive,
  crearEstadoPrograma,
  deClaveFecha,
  fraseDelRango,
  rangoPorPreset,
  semanasDelRango,
  validarRango,
  type PresetPrograma,
} from '../../lib/programaRango'
import {
  comoSeDijoLaUltimaVez,
  rotacionPorTerritorio,
  type RotacionDeTerritorio,
  type SalidaParaRotacion,
} from '../../lib/rotacion.ts'
import { FaltaLaMigracion, cargarConfigSemana, guardarConfigSemana } from './configSemana'
import { readAllRows } from '../../lib/readAllRows'
import { supabase } from '../../lib/supabase'
import '../../styles/programa.css'

type Conductor = { id: string; full_name: string; status: string; availability?: unknown }
type Territorio = { id: string; name: string }
type Punto = {
  id: string
  nombre: string
  codigo?: string | null
  lat: number | null
  lng: number | null
  territory_id: string | null
  activo: boolean
}

type Fila = {
  tildada: boolean
  sinSalida: boolean
  territorioId: string
  puntoId: string
  puntoNombre: string
  lat: number | null
  lng: number | null
  conductorId: string
  hora: string
  motivo: string
  /** Puesta por el motor: habilita el "cambiar por el siguiente". */
  propuesta: boolean
}

type FilaDelPrograma = FilaDelPeriodo & { clave: string }

type HojaMovil =
  | { tipo: 'fila'; clave: string; paso: 'editar' | 'territorio' | 'punto' | 'conductor' | 'horario' }
  | { tipo: 'dia'; clave: string }

type Borrador = {
  filas: Record<string, Fila>
  /** Cada salida extra conserva su identidad aunque comparta día y turno. */
  extras: Record<string, Array<{ id: string; turno: Turno }>>
  /** Días sin salida por asamblea u otro motivo: fecha → motivo. */
  dias: Record<string, string | null>
  /** El orden que eligió el usuario: fecha → claves. */
  orden: Record<string, string[]>
  guardadoEn: number | null
  periodo: ReturnType<typeof crearEstadoPrograma> | null
}

type Props = {
  conductores: Conductor[]
  territorios: Territorio[]
  puntos: Punto[]
  puedeEscribir: boolean
  scope: 'general' | 'grupo'
  grupoId: string | null
  onGuardado: () => void
}

const CLAVE_BORRADOR = 'territorios.programa.v2'
const BORRADOR_VACIO: Borrador = { filas: {}, extras: {}, dias: {}, orden: {}, guardadoEn: null, periodo: null }

/* Los horarios posibles de cada turno. El de la semana es el que ya viene
   puesto; esto es para la excepción. */
const HORAS_MANANA = ['09:00', '09:15', '09:30', '09:45', '10:00', '10:15', '10:30']
const HORAS_TARDE = [
  '15:30', '15:45', '16:00', '16:15', '16:30', '16:45', '17:00', '17:15',
  '17:30', '17:45', '18:00', '18:15', '18:30', '18:45', '19:00', '19:15',
  '19:30',
]

function normalizarBorrador(dato: Partial<Borrador>): Borrador {
  const extras = Object.fromEntries(Object.entries(dato.extras ?? {}).map(([fecha, lista]) => [
    fecha,
    (Array.isArray(lista) ? lista : []).map((extra) => typeof extra === 'string'
      ? { id: 'legacy', turno: extra as Turno }
      : extra),
  ]))
  return {
    filas: dato.filas ?? {}, extras, dias: dato.dias ?? {}, orden: dato.orden ?? {},
    guardadoEn: dato.guardadoEn ?? null,
    periodo: dato.periodo && !validarRango(deClaveFecha(dato.periodo.desde), deClaveFecha(dato.periodo.hasta))
      ? dato.periodo : null,
  }
}

function leerBorrador(): Borrador {
  try {
    const crudo = localStorage.getItem(CLAVE_BORRADOR)
    if (!crudo) return BORRADOR_VACIO
    const dato = JSON.parse(crudo) as Partial<Borrador>
    return normalizarBorrador(dato)
  } catch {
    return BORRADOR_VACIO
  }
}

/** Lo que el motor necesita saber de un conductor, con la ficha como está. */
function paraProponer(conductor: Conductor): ConductorParaProponer | null {
  if (conductor.status !== 'activo') return null
  const ficha = conductor.availability as
    | { days?: number[]; turns?: string[]; byDay?: Record<string, string[]> }
    | undefined
  const porDia: Record<number, TurnoDisponible[]> = {}
  for (const [dia, turnos] of Object.entries(ficha?.byDay ?? {})) {
    const numero = Number(dia)
    if (!Number.isInteger(numero)) continue
    porDia[numero] = turnos.filter((t): t is TurnoDisponible =>
      ['manana', 'tarde', 'telefonica'].includes(t),
    )
  }
  return {
    id: conductor.id,
    nombre: conductor.full_name,
    dias: Array.isArray(ficha?.days) ? ficha.days : [0, 1, 2, 3, 4, 5, 6],
    turnos: Array.isArray(ficha?.turns)
      ? ficha.turns.filter((t): t is TurnoDisponible =>
          ['manana', 'tarde', 'telefonica'].includes(t),
        )
      : ['manana', 'tarde', 'telefonica'],
    porDia,
    carga: 0,
  }
}

function textoDelBorrador(guardadoEn: number | null): string {
  if (!guardadoEn) return 'Borrador compartido listo'
  const segundos = Math.max(1, Math.round((Date.now() - guardadoEn) / 1000))
  if (segundos < 60) return `Borrador compartido · hace ${segundos} s`
  return `Borrador compartido · hace ${Math.round(segundos / 60)} min`
}

export function ProgramaSemanal({
  conductores,
  territorios,
  puntos,
  puedeEscribir,
  scope,
  grupoId,
  onGuardado,
}: Props) {
  const client = supabase
  const [borrador, setBorrador] = useState<Borrador>(leerBorrador)
  const [periodo, setPeriodo] = useState(() => borrador.periodo ?? crearEstadoPrograma())
  const [borradorCargado, setBorradorCargado] = useState(false)
  const [versionBorrador, setVersionBorrador] = useState<number | null>(null)
  const [revisionBorrador, setRevisionBorrador] = useState(0)
  const [recargarBorrador, setRecargarBorrador] = useState(0)
  const [errorBorrador, setErrorBorrador] = useState<{ texto: string; conflicto: boolean } | null>(null)
  const revisionActual = useRef(0)
  const revisionGuardada = useRef(0)
  const guardandoBorrador = useRef(false)
  /* El día de la visita del superintendente. La semana del super se arma
     sobre la semana que contiene ese día, y sin el día no había forma de
     armar el período: el botón quedaba en un error que no se iba nunca. */
  const [diaVisita, setDiaVisita] = useState('')
  const [diasGuardados, setDiasGuardados] = useState<Record<string, string>>({})
  const [filasGuardadasSinSalida, setFilasGuardadasSinSalida] = useState<Set<string>>(new Set())
  const [recargarExcepciones, setRecargarExcepciones] = useState(0)
  const [configEditada, setConfigEditada] = useState<ConfigSemana | null>(null)
  /* La semana como está en la base. Si todavía no está (o está vacía), queda
     null y manda la del código. */
  const [configSemana, setConfigSemana] = useState<ConfigSemana | null>(null)
  const [guardandoSemana, setGuardandoSemana] = useState(false)
  const [configAbierta, setConfigAbierta] = useState(false)
  const [rotacion, setRotacion] = useState<Map<string, RotacionDeTerritorio>>(new Map())
  const [cargandoRotacion, setCargandoRotacion] = useState(true)
  const [salidasEnAgenda, setSalidasEnAgenda] = useState<
    Array<{
      scheduled_for: string
      territory_id: string | null
      driver_id: string | null
      tipo: string | null
      meeting_point_name: string | null
    }>
  >([])
  const [propuestaHecha, setPropuestaHecha] = useState(false)
  const [recargarSalidas, setRecargarSalidas] = useState(0)
  const [guardando, setGuardando] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [mensaje, setMensaje] = useState<string | null>(null)
  const [arrastrando, setArrastrando] = useState<string | null>(null)
  const [destino, setDestino] = useState<{ clave: string; antes: boolean } | null>(null)
  const [semanaMovil, setSemanaMovil] = useState(0)
  const [periodoMovilAbierto, setPeriodoMovilAbierto] = useState(false)
  const [hojaMovil, setHojaMovil] = useState<HojaMovil | null>(null)
  const focoAnterior = useRef<HTMLElement | null>(null)
  const hojaRef = useRef<HTMLDivElement | null>(null)

  useEffect(() => setSemanaMovil(0), [periodo.desde, periodo.hasta])

  useEffect(() => {
    if (!hojaMovil) return
    const overflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    const enfocar = requestAnimationFrame(() => hojaRef.current?.querySelector<HTMLElement>('[data-hoja-cerrar]')?.focus())
    const teclado = (evento: KeyboardEvent) => {
      if (evento.key === 'Escape') {
        evento.preventDefault()
        setHojaMovil(null)
        focoAnterior.current?.focus()
      }
      if (evento.key !== 'Tab' || !hojaRef.current) return
      const focos = [...hojaRef.current.querySelectorAll<HTMLElement>('button:not(:disabled), a[href], input:not(:disabled)')]
      const primero = focos[0]
      const ultimo = focos.at(-1)
      if (!primero || !ultimo) return
      if (evento.shiftKey && document.activeElement === primero) {
        evento.preventDefault()
        ultimo.focus()
      } else if (!evento.shiftKey && document.activeElement === ultimo) {
        evento.preventDefault()
        primero.focus()
      }
    }
    document.addEventListener('keydown', teclado)
    return () => {
      cancelAnimationFrame(enfocar)
      document.body.style.overflow = overflow
      document.removeEventListener('keydown', teclado)
    }
  }, [hojaMovil])

  const { filas: filasBorrador, extras, dias: diasBorrador, orden, guardadoEn } = borrador
  const borradorSinSincronizar = revisionBorrador > revisionGuardada.current
  const estadoBorrador = errorBorrador
    ? 'Borrador sin sincronizar'
    : borradorSinSincronizar ? 'Guardando borrador compartido…' : textoDelBorrador(guardadoEn)

  const configBase = useMemo(() => configDeLaCongregacion(conductores), [conductores])
  const config = configEditada ?? configSemana ?? configBase
  const dias = useMemo(() => {
    const unidos = { ...diasGuardados }
    for (const [fecha, motivo] of Object.entries(diasBorrador)) {
      if (motivo) unidos[fecha] = motivo
      else delete unidos[fecha]
    }
    return unidos
  }, [diasGuardados, diasBorrador])
  const filas = useMemo(() => {
    const unidas: Record<string, Fila> = {}
    for (const clave of filasGuardadasSinSalida) {
      const [, , , turno] = clave.split('-')
      const fecha = clave.slice(0, 10)
      unidas[clave] = {
        tildada: false, sinSalida: true, territorioId: '', puntoId: '', puntoNombre: '',
        lat: null, lng: null, conductorId: '',
        hora: horaHabitual(config, deClaveFecha(fecha).getDay(), turno as Turno) ?? '',
        motivo: '', propuesta: false,
      }
    }
    return { ...unidas, ...filasBorrador }
  }, [filasGuardadasSinSalida, filasBorrador, config])

  useEffect(() => {
    setBorrador((actual) => ({ ...actual, periodo }))
  }, [periodo])

  const marcarBorradorPendiente = () => {
    revisionActual.current += 1
    setRevisionBorrador(revisionActual.current)
  }

  const tocarBorrador = (cambios: Partial<Borrador>) => {
    setBorrador((actual) => ({ ...actual, ...cambios, guardadoEn: Date.now() }))
    marcarBorradorPendiente()
  }

  useEffect(() => {
    if (!client) {
      setErrorBorrador({ texto: 'No hay conexión con la base de datos.', conflicto: false })
      return
    }
    let vivo = true
    void client.from('programa_borrador').select('contenido, version').eq('id', 1).single()
      .then(({ data, error: errorLectura }) => {
        if (!vivo) return
        if (errorLectura || !data) {
          setErrorBorrador({ texto: decirElError(errorLectura, 'No se pudo leer el borrador compartido.'), conflicto: false })
          return
        }
        const local = leerBorrador()
        const version = Number(data.version)
        const hayLocal = Object.keys(local.filas).length > 0 || Object.values(local.extras).some((lista) => lista.length > 0)
          || Object.keys(local.dias).length > 0 || Object.keys(local.orden).length > 0
        const cargado = version === 0 && hayLocal
          ? { ...local, guardadoEn: Date.now() }
          : normalizarBorrador(data.contenido as Partial<Borrador>)
        revisionActual.current = 0
        revisionGuardada.current = 0
        setRevisionBorrador(0)
        setVersionBorrador(version)
        setBorrador(cargado)
        setPeriodo(cargado.periodo ?? local.periodo ?? crearEstadoPrograma())
        setErrorBorrador(null)
        setBorradorCargado(true)
        if (version === 0 && hayLocal) {
          revisionActual.current = 1
          setRevisionBorrador(1)
        }
      })
    return () => { vivo = false }
  }, [client, recargarBorrador])

  useEffect(() => {
    if (!client || !borradorCargado || versionBorrador === null || errorBorrador
      || revisionBorrador <= revisionGuardada.current) return
    const temporizador = window.setTimeout(() => {
      if (guardandoBorrador.current) return
      guardandoBorrador.current = true
      const revisionEnviada = revisionBorrador
      void (async () => {
        try {
          const { data, error: errorGuardado } = await client.rpc('guardar_borrador_programa', {
            p_contenido: borrador,
            p_version: versionBorrador,
          })
          if (errorGuardado) {
            setErrorBorrador({
              texto: decirElError(errorGuardado, 'No se pudo sincronizar el borrador.'),
              conflicto: errorGuardado.code === '40001',
            })
            return
          }
          revisionGuardada.current = revisionEnviada
          setVersionBorrador(Number(data))
        } catch (caught) {
          setErrorBorrador({ texto: decirElError(
            caught instanceof Error ? { message: caught.message } : (caught as { message?: string }),
            'No se pudo sincronizar el borrador.',
          ), conflicto: false })
        } finally {
          guardandoBorrador.current = false
        }
      })()
    }, 700)
    return () => window.clearTimeout(temporizador)
  }, [client, borrador, borradorCargado, versionBorrador, revisionBorrador, errorBorrador])

  /* La rotación se pide una vez: son las salidas que ya pasaron, con cuatro
     columnas. De acá sale "hace 96 días" y de qué turno fue la última vez. */
  useEffect(() => {
    if (!client) {
      setCargandoRotacion(false)
      return
    }
    let vivo = true
    const finDeHoy = aClaveFecha(new Date())
    void readAllRows<SalidaParaRotacion>((from, to) =>
      client
        .from('salidas')
        .select('territory_id, scheduled_for, tipo, meeting_point_name')
        .lt('scheduled_for', `${finDeHoy}T23:59:59-03:00`)
        .order('scheduled_for', { ascending: false })
        .range(from, to),
    )
      .then((salidas) => {
        if (vivo) setRotacion(rotacionPorTerritorio(salidas))
      })
      .catch(() => {
        /* Sin rotación la pantalla sigue sirviendo: solo no puede decir hace
           cuánto que no se trabaja cada territorio. */
        if (vivo) setRotacion(new Map())
      })
      .finally(() => {
        if (vivo) setCargandoRotacion(false)
      })
    return () => {
      vivo = false
    }
  }, [client])

  useEffect(() => {
    if (!client) return
    let vivo = true
    void cargarConfigSemana(client)
      .then((cargada) => {
        if (vivo) setConfigSemana(cargada)
      })
      .catch(() => {
        /* Si la lectura falla, la semana del código sigue siendo válida. */
      })
    return () => {
      vivo = false
    }
  }, [client])

  /* Lo que ya está guardado en el período: el motor no lo pisa y la cabecera
     de cada semana lo cuenta. */
  useEffect(() => {
    if (!client) return
    let vivo = true
    void client
      .from('salidas')
      .select('scheduled_for, territory_id, driver_id, tipo, meeting_point_name')
      .gte('scheduled_for', `${periodo.desde}T00:00:00-03:00`)
      .lt('scheduled_for', `${periodo.hasta}T23:59:59-03:00`)
      .then(({ data }) => {
        if (vivo) setSalidasEnAgenda(data ?? [])
      })
    return () => {
      vivo = false
    }
  }, [client, periodo.desde, periodo.hasta, recargarSalidas])

  useEffect(() => {
    if (!client) return
    let vivo = true
    void Promise.all([
      client.from('programa_dias').select('fecha, motivo')
        .gte('fecha', periodo.desde).lte('fecha', periodo.hasta),
      client.from('programa_filas_sin_salida').select('fecha, turno')
        .gte('fecha', periodo.desde).lte('fecha', periodo.hasta),
    ]).then(([respuestaDias, respuestaFilas]) => {
      if (!vivo) return
      if (!respuestaDias.error) {
        setDiasGuardados(Object.fromEntries((respuestaDias.data ?? []).map((fila) => [fila.fecha, fila.motivo])))
      }
      if (!respuestaFilas.error) {
        setFilasGuardadasSinSalida(new Set((respuestaFilas.data ?? []).map((fila) =>
          claveFila(fila.fecha, fila.turno as Turno),
        )))
      }
    })
    return () => { vivo = false }
  }, [client, periodo.desde, periodo.hasta, recargarExcepciones])

  useEffect(() => {
    try {
      localStorage.setItem(CLAVE_BORRADOR, JSON.stringify(borrador))
    } catch {
      /* Sin localStorage el borrador vive solo en memoria. */
    }
  }, [borrador])

  const diasDelPeriodo = useMemo(() => {
    const lista: Array<{ clave: string; dow: number }> = []
    const fin = deClaveFecha(periodo.hasta)
    for (let d = deClaveFecha(periodo.desde); d.getTime() <= fin.getTime(); ) {
      lista.push({ clave: aClaveFecha(d), dow: d.getDay() })
      d = new Date(d.getFullYear(), d.getMonth(), d.getDate() + 1)
    }
    return lista
  }, [periodo.desde, periodo.hasta])

  /* Las filas del período: los turnos de la semana más las que se agregaron a
     mano, sin los días que quedaron marcados como asamblea, y en el orden que
     el usuario haya elegido. */
  const filasDelPeriodo = useMemo<FilaDelPrograma[]>(() => {
    const lista: FilaDelPrograma[] = []
    for (const dia of diasDelPeriodo) {
      if (dias[dia.clave]) continue
      const turnosBase = turnosDelDia(config, dia.dow)
      /* Las de siempre y las agregadas a mano se arman por separado: una
         segunda salida de la mañana comparte el turno con la primera, y la
         clave tiene que seguir siendo distinta. */
      const deLaFecha = [
        ...turnosBase.map((turno) => ({ turno, esExtra: false, extraId: undefined as string | undefined })),
        ...(extras[dia.clave] ?? []).map((extra) => ({ turno: extra.turno, esExtra: true, extraId: extra.id })),
      ].map(({ turno, esExtra, extraId }) => {
        const fila: FilaDelPeriodo = { fecha: dia.clave, dow: dia.dow, turno, esExtra, extraId }
        return { ...fila, clave: claveDeFila(fila) }
      })
      const guardado = orden[dia.clave]
      const ordenadas = guardado
        ? [
            ...guardado.map((clave) => deLaFecha.find((f) => f.clave === clave)).filter((f): f is FilaDelPrograma => Boolean(f)),
            ...deLaFecha.filter((f) => !guardado.includes(f.clave)),
          ]
        : deLaFecha
      lista.push(...ordenadas)
    }
    return lista
  }, [diasDelPeriodo, config, extras, dias, orden])

  const semanas = useMemo(
    () => semanasDelRango(deClaveFecha(periodo.desde), deClaveFecha(periodo.hasta)),
    [periodo.desde, periodo.hasta],
  )

  const puntosDe = (territorioId: string) =>
    puntos
      .filter((p) => p.activo && p.territory_id === territorioId)
      .sort((a, b) => (a.codigo ?? '').localeCompare(b.codigo ?? '', 'es', { numeric: true }))

  const filaDe = (f: FilaDelPrograma): Fila =>
    filas[f.clave] ?? {
      tildada: false,
      sinSalida: false,
      territorioId: '',
      puntoId: '',
      puntoNombre: '',
      lat: null,
      lng: null,
      conductorId: titularDeLaSemana(config, f.dow, f.turno, deClaveFecha(f.fecha))?.id ?? '',
      hora: horaHabitual(config, f.dow, f.turno) ?? '',
      motivo: '',
      propuesta: false,
    }

  const cambiar = (f: FilaDelPrograma, cambios: Partial<Fila>) =>
    tocarBorrador({
      filas: { ...filasBorrador, [f.clave]: {
        ...filaDe(f), ...cambios,
        propuesta: cambios.propuesta ?? (['territorioId', 'puntoId', 'conductorId', 'hora', 'sinSalida']
          .some((campo) => campo in cambios) ? false : filaDe(f).propuesta),
      } },
    })

  const esHoy = (clave: string) => clave === aClaveFecha(new Date())

  const nombreConductor = (id: string) =>
    conductores.find((c) => c.id === id)?.full_name ?? 'Ese conductor'

  const esTitular = (dow: number, turno: Turno, conductorId: string) =>
    (config.titulares[claveFila(String(dow), turno)] ?? []).includes(conductorId)

  const conductorDisponibleEn = (conductor: Conductor, fila: FilaDelPrograma) => {
    const ficha = paraProponer(conductor)
    const turno = turnoParaDisponibilidad(fila.turno)
    if (!ficha || !turno) return false
    const delDia = ficha.porDia?.[fila.dow]
    return delDia ? delDia.includes(turno) : ficha.dias.includes(fila.dow) && ficha.turnos.includes(turno)
  }
  const conductorOcupadoEn = (conductorId: string, fila: FilaDelPrograma) =>
    filasDelPeriodo.some((otra) => otra.clave !== fila.clave && otra.fecha === fila.fecha
      && filas[otra.clave]?.tildada && filas[otra.clave]?.conductorId === conductorId)
    || salidasEnAgenda.some((salida) => aClaveFecha(new Date(salida.scheduled_for)) === fila.fecha
      && salida.driver_id === conductorId)
  const territorioUsadoEn = (territorioId: string, fila: FilaDelPrograma) =>
    filasDelPeriodo.some((otra) => otra.clave !== fila.clave && filas[otra.clave]?.tildada
      && filas[otra.clave]?.territorioId === territorioId)
    || salidasEnAgenda.some((salida) => salida.territory_id === territorioId)

  /* ---------- lo que se guarda ---------- */
  const tildadas = filasDelPeriodo.filter((f) => filas[f.clave]?.tildada)
  const cambiosDias = Object.entries(diasBorrador)
    .filter(([fecha, motivo]) => fecha >= periodo.desde && fecha <= periodo.hasta
      && (motivo || null) !== (diasGuardados[fecha] ?? null))
    .map(([fecha, motivo]) => ({ fecha, motivo }))
  const cambiosFilas = Object.entries(filasBorrador)
    .filter(([clave, fila]) => clave.slice(0, 10) >= periodo.desde && clave.slice(0, 10) <= periodo.hasta
      && !clave.includes('-extra') && !clave.endsWith('-grupos')
      && fila.sinSalida !== filasGuardadasSinSalida.has(clave))
    .map(([clave, fila]) => ({ clave, fecha: clave.slice(0, 10), turno: clave.slice(11) as Turno, sin_salida: fila.sinSalida }))
  const hayCambiosParaGuardar = tildadas.length > 0 || cambiosDias.length > 0 || cambiosFilas.length > 0
  const sinCompletar = tildadas.filter((f) => {
    const fila = filas[f.clave]!
    return !fila.territorioId && f.turno !== 'telefono'
  }).length
  const sinConductor = tildadas.filter((f) => !filas[f.clave]?.conductorId).length
  const sinPunto = tildadas.filter((f) => {
    const fila = filas[f.clave]!
    return !fila.puntoId && f.turno !== 'telefono'
  }).length
  const sinUbicacion = tildadas.filter((f) => {
    const punto = puntos.find((p) => p.id === filas[f.clave]?.puntoId)
    return Boolean(punto) && (punto!.lat === null || punto!.lng === null)
  }).length

  /* ---------- avisos de una fila ---------- */
  const avisosDe = (f: FilaDelPrograma): Array<{ clase: string; texto: string }> => {
    const fila = filas[f.clave]
    if (!fila?.tildada) return []
    const avisos: Array<{ clase: string; texto: string }> = []
    const esTelefono = f.turno === 'telefono'
    const esGrupos = f.turno === 'grupos'
    if (esGrupos) return avisos
    if (!esTelefono && !fila.territorioId) {
      avisos.push({ clase: 'prog-pastilla aviso', texto: 'Falta el territorio' })
    }
    if (!esTelefono && !fila.puntoId) {
      avisos.push({ clase: 'prog-pastilla aviso', texto: 'Falta el punto de encuentro' })
    }
    if (!fila.conductorId) {
      avisos.push({ clase: 'prog-pastilla aviso', texto: 'Falta el conductor' })
    }
    const punto = puntos.find((p) => p.id === fila.puntoId)
    if (punto && (punto.lat === null || punto.lng === null)) {
      avisos.push({
        clase: 'prog-pastilla aviso',
        texto: 'El punto no está en el mapa (se marca desde Mapas)',
      })
    }
    if (fila.conductorId) {
      const repetido = filasDelPeriodo.find(
        (otra) =>
          otra.clave !== f.clave &&
          otra.fecha === f.fecha &&
          filas[otra.clave]?.tildada &&
          filas[otra.clave]?.conductorId === fila.conductorId,
      )
      if (repetido) {
        avisos.push({
          clase: 'prog-pastilla mal',
          texto: `${nombreConductor(fila.conductorId)} ya está en otra salida de ese día`,
        })
      }
      const enLaAgenda = salidasEnAgenda.some(
        (s) => aClaveFecha(new Date(s.scheduled_for)) === f.fecha && s.driver_id === fila.conductorId,
      )
      if (enLaAgenda) {
        avisos.push({
          clase: 'prog-pastilla mal',
          texto: `${nombreConductor(fila.conductorId)} ya conduce una salida de ese día en la agenda`,
        })
      }
    }
    if (fila.territorioId) {
      const repetido = filasDelPeriodo.find(
        (otra) =>
          otra.clave !== f.clave &&
          filas[otra.clave]?.tildada &&
          filas[otra.clave]?.territorioId === fila.territorioId,
      )
      if (repetido) {
        avisos.push({ clase: 'prog-pastilla aviso', texto: 'Ese territorio ya está en otra salida del período' })
      }
    }
    return avisos
  }

  const chipDe = (fila: Fila, turno: Turno) => {
    if (!fila.tildada) return null
    const lista =
      (Boolean(fila.territorioId) && Boolean(fila.conductorId)) ||
      (turno === 'telefono' && Boolean(fila.conductorId))
    /* Cuando falta algo, el aviso de la fila ya dice qué falta: un chip
       "Falta" al lado de "Falta el conductor" repetía la noticia dos veces. */
    return lista ? { clase: 'prog-pastilla bien', texto: 'Lista' } : null
  }

  /* ---------- mover una fila ---------- */
  const moverFila = (clave: string, destinoFila: { clave: string; antes: boolean }) => {
    const fila = filasDelPeriodo.find((f) => f.clave === clave)
    if (!fila) return
    const deLaFecha = filasDelPeriodo.filter((f) => f.fecha === fila.fecha).map((f) => f.clave)
    const sinLaQueMuevo = deLaFecha.filter((k) => k !== clave)
    let indice = sinLaQueMuevo.indexOf(destinoFila.clave)
    if (indice < 0) indice = sinLaQueMuevo.length
    if (!destinoFila.antes) indice += 1
    sinLaQueMuevo.splice(indice, 0, clave)
    tocarBorrador({ orden: { ...orden, [fila.fecha]: sinLaQueMuevo } })
  }

  const moverUnLugar = (fila: FilaDelPrograma, salto: number) => {
    const deLaFecha = filasDelPeriodo.filter((f) => f.fecha === fila.fecha).map((f) => f.clave)
    const i = deLaFecha.indexOf(fila.clave)
    const j = i + salto
    if (i < 0 || j < 0 || j >= deLaFecha.length) return
    const copia = [...deLaFecha]
    copia.splice(i, 1)
    copia.splice(j, 0, fila.clave)
    tocarBorrador({ orden: { ...orden, [fila.fecha]: copia } })
  }

  const alBajarElAsa = (evento: React.PointerEvent, fila: FilaDelPrograma) => {
    if (evento.button !== 0 || !puedeEscribir) return
    const inicioY = evento.clientY
    let activo = false
    let destinoActual: { clave: string; antes: boolean } | null = null
    const alMover = (e: PointerEvent) => {
      if (!activo) {
        if (Math.abs(e.clientY - inicioY) < 6) return
        activo = true
        setArrastrando(fila.clave)
      }
      const bajo = document.elementFromPoint(e.clientX, e.clientY)
      const objetivo = bajo?.closest?.('[data-clave]') as HTMLElement | null
      const claveObjetivo = objetivo?.dataset.clave
      const otra = filasDelPeriodo.find((f) => f.clave === claveObjetivo)
      if (otra && otra.clave !== fila.clave && otra.fecha === fila.fecha) {
        const caja = objetivo!.getBoundingClientRect()
        destinoActual = { clave: otra.clave, antes: e.clientY < caja.top + caja.height / 2 }
        setDestino(destinoActual)
      } else {
        destinoActual = null
        setDestino(null)
      }
    }
    const alSoltar = () => {
      window.removeEventListener('pointermove', alMover)
      setArrastrando(null)
      setDestino(null)
      if (activo && destinoActual) moverFila(fila.clave, destinoActual)
    }
    window.addEventListener('pointermove', alMover)
    window.addEventListener('pointerup', alSoltar, { once: true })
  }

  /* ---------- cambiar por el siguiente ---------- */
  const siguienteTerritorio = (fila: FilaDelPrograma) => {
    const usados = new Set(
      filasDelPeriodo
        .filter((otra) => otra.clave !== fila.clave && filas[otra.clave]?.tildada)
        .map((otra) => filas[otra.clave]?.territorioId),
    )
    const candidatos = [...territorios]
      .filter((t) => !usados.has(t.id))
      .sort(
        (a, b) =>
          (rotacion.get(b.id)?.diasSinTrabajar ?? 99_999) -
          (rotacion.get(a.id)?.diasSinTrabajar ?? 99_999),
      )
    if (candidatos.length === 0) {
      setMensaje('No queda otro territorio libre en la cola.')
      return
    }
    const actual = candidatos.findIndex((t) => t.id === filas[fila.clave]?.territorioId)
    const siguiente = candidatos[(actual + 1) % candidatos.length]
    const punto = puntosDe(siguiente.id)[0]
    cambiar(fila, {
      territorioId: siguiente.id,
      puntoId: punto?.id ?? '',
      puntoNombre: punto?.nombre ?? '',
      lat: punto?.lat ?? null,
      lng: punto?.lng ?? null,
      tildada: true,
      propuesta: true,
      motivo: `Cambiado a mano: ${comoSeDijoLaUltimaVez(rotacion.get(siguiente.id))}${
        punto ? ` · sale de ${punto.nombre}` : ' · sin punto de encuentro cargado'
      }.`,
    })
  }

  /* ---------- el día: excepciones ---------- */
  const cerrarElMenu = (evento: React.MouseEvent) => {
    const detalles = (evento.currentTarget as HTMLElement).closest('details')
    detalles?.removeAttribute('open')
  }

  const agregarExtra = (evento: React.MouseEvent | null, dia: { clave: string; dow: number }, turno: Turno) => {
    if (evento) cerrarElMenu(evento)
    tocarBorrador({ extras: { ...extras, [dia.clave]: [
      ...(extras[dia.clave] ?? []), { id: crypto.randomUUID(), turno },
    ] } })
    setMensaje('Salida agregada. Podés cambiar su posición desde la ficha.')
  }

  const quitarFila = (fila: FilaDelPrograma) => {
    if (!fila.esExtra) {
      cambiar(fila, { sinSalida: true, tildada: false })
      return
    }
    const siguientesFilas = { ...filasBorrador }
    delete siguientesFilas[fila.clave]
    tocarBorrador({
      filas: siguientesFilas,
      extras: { ...extras, [fila.fecha]: (extras[fila.fecha] ?? []).filter((extra) => extra.id !== fila.extraId) },
      orden: { ...orden, [fila.fecha]: (orden[fila.fecha] ?? []).filter((clave) => clave !== fila.clave) },
    })
  }

  const marcarSinSalidaElDia = (evento: React.MouseEvent | null, dia: { clave: string }) => {
    if (evento) cerrarElMenu(evento)
    tocarBorrador({
      dias: { ...diasBorrador, [dia.clave]: 'Sin salida' },
    })
    setMensaje('Ese día queda sin salida. Guardá el programa para que valga para todos.')
  }

  const alternarAsamblea = (evento: React.MouseEvent | null, dia: { clave: string }) => {
    if (evento) cerrarElMenu(evento)
    tocarBorrador({ dias: { ...diasBorrador, [dia.clave]: dias[dia.clave] ? null : 'Asamblea regional' } })
  }

  /* ---------- proponer y guardar ---------- */
  const agendaParaElMotor = salidasEnAgenda.map((s) => {
    const fecha = new Date(s.scheduled_for)
    const esGrupos = /salidas? de grupos?/i.test(s.meeting_point_name ?? '')
    const turno: Turno =
      s.tipo === 'telefonica'
        ? 'telefono'
        : esGrupos
          ? 'grupos'
          : fecha.getHours() < 13
            ? 'manana'
            : 'tarde'
    return {
      fecha: aClaveFecha(fecha),
      turno,
      territorioId: s.territory_id,
      conductorId: s.driver_id,
    }
  })

  const proponer = (rehacer = false) => {
    const filasBase = Object.fromEntries(Object.entries(filas).filter(([, fila]) => !rehacer || !fila.propuesta))
    const territoriosParaProponer: TerritorioParaProponer[] = territorios.map((t) => ({
      id: t.id,
      nombre: t.name,
      diasSinTrabajar: rotacion.get(t.id)?.diasSinTrabajar ?? null,
      ultimoTurno: rotacion.get(t.id)?.ultimoTurno ?? null,
      puntos: puntosDe(t.id).map((p) => ({
        id: p.id,
        codigo: p.codigo ?? '',
        nombre: p.nombre,
        lat: p.lat,
        lng: p.lng,
      })),
    }))
    const conductoresParaProponer = conductores
      .map(paraProponer)
      .filter((c): c is ConductorParaProponer => c !== null)

    const propuestas = proponerPrograma({
      filas: filasDelPeriodo.map(({ fecha, dow, turno, esExtra, extraId }) => ({ fecha, dow, turno, esExtra, extraId })),
      config,
      territorios: territoriosParaProponer,
      conductores: conductoresParaProponer,
      agenda: [
        ...agendaParaElMotor,
        ...filasDelPeriodo.filter((f) => filasBase[f.clave]?.tildada).map((f) => ({
          fecha: f.fecha, turno: f.turno,
          territorioId: filasBase[f.clave].territorioId || null,
          conductorId: filasBase[f.clave].conductorId || null,
        })),
      ],
      soloVacias: true,
      yaArmadas: filasDelPeriodo
        .filter((f) => Boolean(filasBase[f.clave]?.territorioId || filasBase[f.clave]?.tildada))
        .map((f) => f.clave),
      sinSalida: filasDelPeriodo.filter((f) => Boolean(filasBase[f.clave]?.sinSalida)).map((f) => f.clave),
    })

    const siguientes = { ...filasBorrador }
    if (rehacer) for (const [clave, fila] of Object.entries(siguientes)) if (fila.propuesta) delete siguientes[clave]
    for (const propuesta of propuestas) {
      const fila = filasDelPeriodo.find((f) => f.clave === propuesta.clave)
      if (!fila) continue
      const punto = propuesta.puntoId ? puntos.find((p) => p.id === propuesta.puntoId) : undefined
      siguientes[fila.clave] = {
        tildada: true,
        sinSalida: false,
        territorioId: propuesta.territorioId ?? '',
        puntoId: propuesta.puntoId ?? '',
        puntoNombre: punto?.nombre ?? '',
        lat: punto?.lat ?? null,
        lng: punto?.lng ?? null,
        conductorId: propuesta.conductorId ?? '',
        hora: propuesta.hora,
        motivo: propuesta.motivo,
        propuesta: true,
      }
    }
    tocarBorrador({ filas: siguientes })
    setPropuestaHecha(true)
    setError(null)
    setMensaje(
      propuestas.length === 0
        ? 'No quedó ninguna fila para proponer: ya está todo armado.'
        : `${propuestas.length} salidas propuestas. Nada se guardó todavía.`,
    )
  }

  const guardar = async () => {
    if (!client || !puedeEscribir || !hayCambiosParaGuardar) return
    if (borradorSinSincronizar || errorBorrador) {
      setError('Esperá a que se sincronice el borrador antes de guardar el programa.')
      return
    }
    setError(null)
    setMensaje(null)
    if (scope === 'grupo' && !grupoId) {
      setError('Elegí el grupo de servicio antes de guardar.')
      return
    }
    const incompleta = tildadas.find((f) => {
      const fila = filas[f.clave]
      return !fila?.hora || !fila.conductorId || (f.turno !== 'telefono' &&
        (!fila.territorioId || !fila.puntoId || !fila.puntoNombre))
    })
    if (incompleta) {
      setError(`Completá horario, conductor${incompleta.turno === 'telefono' ? '' : ', territorio y punto'} en ${NOMBRE_DIA[incompleta.dow]} ${incompleta.fecha} antes de guardar.`)
      return
    }
    const conflicto = tildadas.find((f) => avisosDe(f).some((aviso) =>
      aviso.clase.includes('mal') || aviso.texto.includes('ya está en otra salida del período'),
    ))
    if (conflicto) {
      setError(`Revisá los avisos de ${NOMBRE_DIA[conflicto.dow]} ${conflicto.fecha}: hay conductor o territorio repetido.`)
      return
    }
    setGuardando(true)
    try {
      const payload = tildadas.map((f) => {
        const fila = filas[f.clave]!
        const territorio = territorios.find((t) => t.id === fila.territorioId)
        return {
          tipo: f.turno === 'telefono' ? 'telefonica' : 'territorial',
          title:
            f.turno === 'telefono'
              ? 'PREDICACION TELEFONICA'
              : `${territorio?.name ?? 'Salida'} ${NOMBRE_DIA[f.dow]} ${fila.hora}`,
          territory_id: fila.territorioId || null,
          driver_id: fila.conductorId || null,
          group_id: grupoId,
          meeting_point_id: fila.puntoId || null,
          meeting_point_name: fila.puntoNombre || null,
          meeting_point_lat: fila.lat,
          meeting_point_lng: fila.lng,
          scheduled_for: new Date(`${f.fecha}T${fila.hora}:00`).toISOString(),
          programa_orden: filasDelPeriodo.filter((delDia) => delDia.fecha === f.fecha)
            .findIndex((delDia) => delDia.clave === f.clave) + 1,
          notes: null,
        }
      })
      const { error: errorGuardado } = await client.rpc('guardar_programa_periodo', {
        p_salidas: payload,
        p_dias: cambiosDias,
        p_filas_sin_salida: cambiosFilas.map(({ fecha, turno, sin_salida }) => ({ fecha, turno, sin_salida })),
      })
      if (errorGuardado) {
        setError(decirElError(errorGuardado, 'No se pudieron guardar las salidas.'))
        return
      }
      const guardadas = new Set(tildadas.map((f) => f.clave))
      const excepcionesGuardadas = new Set(cambiosFilas.map((f) => f.clave))
      const diasSinSalidaGuardados = new Set(cambiosDias.filter(({ motivo }) => Boolean(motivo)).map(({ fecha }) => fecha))
      setBorrador((actual) => {
        const siguientesFilas = { ...actual.filas }
        for (const clave of [...guardadas, ...excepcionesGuardadas]) delete siguientesFilas[clave]
        for (const clave of Object.keys(siguientesFilas)) {
          if (diasSinSalidaGuardados.has(clave.slice(0, 10))) delete siguientesFilas[clave]
        }
        const siguientesDias = { ...actual.dias }
        for (const { fecha } of cambiosDias) delete siguientesDias[fecha]
        const siguientesExtras = { ...actual.extras }
        for (const fecha of diasSinSalidaGuardados) delete siguientesExtras[fecha]
        for (const f of tildadas.filter((fila) => fila.esExtra)) {
          siguientesExtras[f.fecha] = (siguientesExtras[f.fecha] ?? []).filter((extra) => extra.id !== f.extraId)
        }
        const siguienteOrden = { ...actual.orden }
        for (const fecha of diasSinSalidaGuardados) delete siguienteOrden[fecha]
        for (const f of tildadas.filter((fila) => fila.esExtra)) {
          siguienteOrden[f.fecha] = (siguienteOrden[f.fecha] ?? []).filter((clave) => clave !== f.clave)
        }
        return { ...actual, filas: siguientesFilas, dias: siguientesDias, extras: siguientesExtras, orden: siguienteOrden,
          guardadoEn: Object.keys(siguientesFilas).length || Object.keys(siguientesDias).length ? Date.now() : null }
      })
      marcarBorradorPendiente()
      setDiasGuardados((actual) => {
        const siguientes = { ...actual }
        for (const { fecha, motivo } of cambiosDias) {
          if (motivo) siguientes[fecha] = motivo
          else delete siguientes[fecha]
        }
        return siguientes
      })
      setFilasGuardadasSinSalida((actual) => {
        const siguientes = new Set(actual)
        for (const { clave, sin_salida } of cambiosFilas) {
          if (sin_salida) siguientes.add(clave)
          else siguientes.delete(clave)
        }
        return siguientes
      })
      setPropuestaHecha(false)
      setRecargarSalidas((n) => n + 1)
      setRecargarExcepciones((n) => n + 1)
      setMensaje(payload.length
        ? `${payload.length} ${payload.length === 1 ? 'salida guardada' : 'salidas guardadas'}. Las excepciones del día también quedaron guardadas.`
        : 'Los días y turnos sin salida quedaron guardados para todos.')
      onGuardado()
    } catch (caught) {
      setError(
        decirElError(
          caught instanceof Error ? { message: caught.message } : (caught as { message?: string }),
          'No se pudieron guardar las salidas.',
        ),
      )
    } finally {
      setGuardando(false)
    }
  }

  const guardarLaSemana = async () => {
    if (!client || !puedeEscribir) return
    setGuardandoSemana(true)
    setError(null)
    try {
      await guardarConfigSemana(client, config)
      setConfigSemana(config)
      setConfigEditada(null)
      setMensaje('La semana quedó guardada: vale para todos.')
      setConfigAbierta(false)
    } catch (caught) {
      setError(
        caught instanceof FaltaLaMigracion
          ? caught.message
          : decirElError(
              caught instanceof Error ? { message: caught.message } : (caught as { message?: string }),
              'No se pudo guardar la semana.',
            ),
      )
    } finally {
      setGuardandoSemana(false)
    }
  }

  const descartar = () => {
    if (!window.confirm('Se descarta todo lo armado en este período. La agenda no se toca.')) return
    setBorrador((actual) => {
      const enPeriodo = (fecha: string) => fecha >= periodo.desde && fecha <= periodo.hasta
      const filasRestantes = Object.fromEntries(Object.entries(actual.filas).filter(([clave]) => !enPeriodo(clave.slice(0, 10))))
      const extrasRestantes = Object.fromEntries(Object.entries(actual.extras).filter(([fecha]) => !enPeriodo(fecha)))
      const diasRestantes = Object.fromEntries(Object.entries(actual.dias).filter(([fecha]) => !enPeriodo(fecha)))
      const ordenRestante = Object.fromEntries(Object.entries(actual.orden).filter(([fecha]) => !enPeriodo(fecha)))
      return { ...actual, filas: filasRestantes, extras: extrasRestantes, dias: diasRestantes,
        orden: ordenRestante, guardadoEn: Date.now(), periodo }
    })
    marcarBorradorPendiente()
    setPropuestaHecha(false)
    setMensaje('Borrador descartado.')
  }

  const deshacerPropuesta = () => {
    const siguientes = { ...filasBorrador }
    for (const [clave, fila] of Object.entries(siguientes)) if (fila.propuesta) delete siguientes[clave]
    tocarBorrador({ filas: siguientes })
    setPropuestaHecha(false)
  }

  /* ---------- período ---------- */
  const aplicarPreset = (preset: PresetPrograma) => {
    const visita =
      preset === 'semana-del-super'
        ? diaVisita
          ? deClaveFecha(diaVisita)
          : new Date()
        : undefined
    const rango = rangoPorPreset(preset, new Date(), visita)
    if ('error' in rango) {
      setError(rango.error)
      return
    }
    const desde = aClaveFecha(rango.desde)
    const hasta = aClaveFecha(rango.hasta)
    const problema = validarRango(deClaveFecha(desde), deClaveFecha(hasta))
    if (problema) {
      setError(problema)
      return
    }
    setError(null)
    setPeriodo({ preset, desde, hasta })
  }

  const cambiarDiaVisita = (valor: string) => {
    setDiaVisita(valor)
    if (!valor) return
    const rango = rangoPorPreset('semana-del-super', new Date(), deClaveFecha(valor))
    if ('error' in rango) {
      setError(rango.error)
      return
    }
    setError(null)
    setPeriodo({
      preset: 'semana-del-super',
      desde: aClaveFecha(rango.desde),
      hasta: aClaveFecha(rango.hasta),
    })
  }

  const cambiarFecha = (campo: 'desde' | 'hasta', valor: string) => {
    if (!valor) return
    const siguiente = { ...periodo, [campo]: valor, preset: 'personalizado' as PresetPrograma }
    const problema = validarRango(deClaveFecha(siguiente.desde), deClaveFecha(siguiente.hasta))
    if (problema) {
      setError(problema)
      return
    }
    setError(null)
    setPeriodo(siguiente)
  }

  const salidasEnLaSemana = (semana: { desdeClave: string; hastaClave: string }) =>
    salidasEnAgenda.filter((s) => {
      const fecha = aClaveFecha(new Date(s.scheduled_for))
      return fecha >= semana.desdeClave && fecha <= semana.hastaClave
    }).length

  const turnosDeLaSemana =
    Object.keys(config.horarios).length + config.telefono.length + config.grupos.length
  const turnosConTitular = Object.keys(config.titulares).length
  const asaRef = useRef<HTMLSpanElement | null>(null)

  const semanaVisible = semanas[Math.min(semanaMovil, semanas.length - 1)]
  const diasVisibles = semanaVisible
    ? diasDelPeriodo.filter((dia) => dia.clave >= semanaVisible.desdeClave && dia.clave <= semanaVisible.hastaClave)
    : []
  const fechaCorta = (clave: string) =>
    new Intl.DateTimeFormat('es-AR', { day: 'numeric', month: 'short' })
      .format(deClaveFecha(clave)).replace('.', '')
  const turnoEnAgenda = (salida: (typeof salidasEnAgenda)[number]): Turno => {
    if (salida.tipo === 'telefonica') return 'telefono'
    if (/salidas? de grupos?/i.test(salida.meeting_point_name ?? '')) return 'grupos'
    return new Date(salida.scheduled_for).getHours() < 13 ? 'manana' : 'tarde'
  }
  const abrirHojaMovil = (siguiente: HojaMovil) => {
    focoAnterior.current = document.activeElement as HTMLElement | null
    setHojaMovil(siguiente)
  }
  const cerrarHojaMovil = () => {
    setHojaMovil(null)
    requestAnimationFrame(() => focoAnterior.current?.focus())
  }
  const filaAbierta = hojaMovil?.tipo === 'fila'
    ? filasDelPeriodo.find((fila) => fila.clave === hojaMovil.clave)
    : undefined
  const datoAbierto = filaAbierta ? filaDe(filaAbierta) : undefined
  const diaAbierto = hojaMovil?.tipo === 'dia'
    ? diasDelPeriodo.find((dia) => dia.clave === hojaMovil.clave)
    : undefined
  const tituloSalida = (fila: FilaDelPrograma) =>
    `${NOMBRE_DIA[fila.dow].charAt(0).toUpperCase() + NOMBRE_DIA[fila.dow].slice(1)} ${Number(fila.fecha.slice(8))} · ${NOMBRE_TURNO[fila.turno]}`
  const filaGuardadaMovil = (salida: (typeof salidasEnAgenda)[number], clave: string) => {
    const territorio = territorios.find((t) => t.id === salida.territory_id)
    const conductor = conductores.find((c) => c.id === salida.driver_id)
    const turno = turnoEnAgenda(salida)
    return (
      <div key={clave} className="prog-m-fila guardada">
        <span className="prog-m-hora">{new Intl.DateTimeFormat('es-AR', { hour: '2-digit', minute: '2-digit', hour12: false }).format(new Date(salida.scheduled_for))}</span>
        <span className="prog-m-datos"><strong>{territorio ? `Territorio ${territorio.name}` : turno === 'telefono' ? 'Predicación telefónica' : turno === 'grupos' ? 'Salidas de Grupos' : 'Salida'}</strong><small>{[salida.meeting_point_name, conductor?.full_name].filter(Boolean).join(' · ') || 'Ya programada'}</small></span>
        <span className="prog-m-chip">En la agenda</span>
      </div>
    )
  }

  if (!borradorCargado) return (
    <section className="prog-panel" aria-label="Programa del período">
      <div className="prog-banda">
        <strong>{errorBorrador?.texto ?? 'Cargando borrador compartido…'}</strong>
        {errorBorrador ? <button type="button" className="prog-enlace" onClick={() => {
          setErrorBorrador(null)
          setRecargarBorrador((n) => n + 1)
        }}>Reintentar</button> : null}
      </div>
    </section>
  )

  return (
    <section className="prog-panel" aria-label="Programa del período">
      {errorBorrador ? <div className="prog-banda" role="alert">
        <strong>{errorBorrador.texto}</strong>
        <button type="button" className="prog-enlace" onClick={() => {
          if (errorBorrador.conflicto) {
            if (!window.confirm('Se cargarán los cambios de la otra sesión y se descartarán los cambios de esta pestaña.')) return
            setBorradorCargado(false)
            setRecargarBorrador((n) => n + 1)
          } else setErrorBorrador(null)
        }}>{errorBorrador.conflicto ? 'Cargar versión compartida' : 'Reintentar guardado'}</button>
      </div> : null}
      <div className="prog-cabecera">
        <div className="prog-cabecera-titulo">
          <p className="eyebrow">Armar programa</p>
          <h3>Salidas por día y horario</h3>
        </div>
        <div className="prog-acciones">
          <button
            type="button"
            className="primary-button"
            onClick={() => void guardar()}
            disabled={!puedeEscribir || guardando || !hayCambiosParaGuardar || borradorSinSincronizar || Boolean(errorBorrador)}
          >
            <Icono nombre="guardar" tamaño={18} />
            {guardando ? 'Guardando…' : 'Guardar programa'}
          </button>
        </div>
        <p className="table-hint prog-cabecera-hint">
          Tildá los horarios, completá territorio y conductor, y guardá.
        </p>
      </div>

      <div className="prog-periodo">
        <button
          type="button"
          className="prog-m-periodo-toggle"
          aria-expanded={periodoMovilAbierto}
          onClick={() => setPeriodoMovilAbierto((abierto) => !abierto)}
        >
          <span>Período</span>
          <strong>{PRESETS_PROGRAMA.find((p) => p.id === periodo.preset)?.etiqueta ?? 'Personalizado'} · {fechaCorta(periodo.desde)} – {fechaCorta(periodo.hasta)}</strong>
          <span aria-hidden="true">{periodoMovilAbierto ? '⌃' : '⌄'}</span>
        </button>
        <div className={periodoMovilAbierto ? 'prog-periodo-opciones abierto' : 'prog-periodo-opciones'}>
        <p className="eyebrow">Período</p>
        <div className="prog-presets" role="group" aria-label="Período del programa">
          {PRESETS_PROGRAMA.map((opcion) => (
            <button
              key={opcion.id}
              type="button"
              aria-pressed={periodo.preset === opcion.id}
              className={periodo.preset === opcion.id ? 'prog-preset activa' : 'prog-preset'}
              onClick={() => aplicarPreset(opcion.id)}
            >
              {opcion.etiqueta}
            </button>
          ))}
        </div>
        <div className="prog-fechas">
          {periodo.preset === 'semana-del-super' ? (
            <label>
              Día de la visita
              <input
                type="date"
                value={diaVisita}
                onChange={(e) => cambiarDiaVisita(e.target.value)}
              />
            </label>
          ) : null}
          <label>
            Desde
            <input type="date" value={periodo.desde} onChange={(e) => cambiarFecha('desde', e.target.value)} />
          </label>
          <label>
            Hasta
            <input type="date" value={periodo.hasta} onChange={(e) => cambiarFecha('hasta', e.target.value)} />
          </label>
        </div>
        <div className="prog-resumen">
          <span>
            {contarDiasInclusive(deClaveFecha(periodo.desde), deClaveFecha(periodo.hasta))} días,{' '}
            {fraseDelRango(deClaveFecha(periodo.desde), deClaveFecha(periodo.hasta))} ·{' '}
            <strong>{tildadas.length} {tildadas.length === 1 ? 'tildada' : 'tildadas'} para guardar{cambiosDias.length + cambiosFilas.length ? ` · ${cambiosDias.length + cambiosFilas.length} ${cambiosDias.length + cambiosFilas.length === 1 ? 'excepción' : 'excepciones'}` : ''}</strong>
            {sinCompletar > 0 ? ` · ${sinCompletar} sin completar` : ''}
            {sinConductor > 0 ? ` · ${sinConductor} sin conductor` : ''}
          </span>
          <span className="prog-borrador">
            <span className="prog-punto-vivo" aria-hidden="true" />
            {estadoBorrador}
          </span>
          {guardadoEn ? (
            <button type="button" className="prog-enlace" onClick={descartar}>
              Descartar borrador
            </button>
          ) : null}
        </div>
        </div>
      </div>

      <div className="prog-strip">
        <span className="eyebrow">La semana de siempre</span>
        <span className="prog-pastilla oliva">{turnosDeLaSemana} turnos con horario fijo</span>
        <span className="prog-pastilla oliva">{turnosConTitular} con titular</span>
        <button type="button" className="prog-enlace" onClick={() => setConfigAbierta(true)}>
          Ver y editar
        </button>
      </div>

      {error ? <div className="form-feedback error">{error}</div> : null}
      {mensaje ? <div className="form-feedback success">{mensaje}</div> : null}

      {tildadas.length === 0 && !propuestaHecha ? (
        <div className="prog-invitacion">
          <div>
            <strong>Este período se puede armar solo</strong>
            <p>
              El sistema propone territorios por rotación —los que hace más que no se trabajan
              primero—, alterna el turno, rota el punto de encuentro y respeta los titulares de cada
              turno. Después lo revisás fila por fila.{' '}
              <b>Nada se guarda hasta que aprietes Guardar.</b>
            </p>
          </div>
          <button
            type="button"
            className="prog-boton-propuesta"
            onClick={() => proponer()}
            disabled={!puedeEscribir || cargandoRotacion}
          >
            ✦ Proponer el programa
          </button>
        </div>
      ) : null}

      {propuestaHecha ? (
        <div className="prog-resumen-propuesta">
          <div className="prog-cifras">
            <strong>{tildadas.length} propuestas</strong>
            <span>
              · {tildadas.filter((f) => f.turno === 'manana').length} de mañana,{' '}
              {tildadas.filter((f) => f.turno === 'tarde').length} de tarde
            </span>
            {sinConductor > 0 ? <span className="prog-pastilla aviso">{sinConductor} sin conductor</span> : null}
            {sinPunto > 0 ? <span className="prog-pastilla aviso">{sinPunto} sin punto</span> : null}
            {sinUbicacion > 0 ? (
              <span className="prog-pastilla aviso">{sinUbicacion} sin ubicación</span>
            ) : null}
            {sinConductor === 0 && sinPunto === 0 && sinUbicacion === 0 ? (
              <span className="prog-pastilla bien">Todas listas</span>
            ) : null}
          </div>
          <button type="button" className="prog-enlace" onClick={() => proponer(true)} disabled={!puedeEscribir}>
            Volver a proponer
          </button>
          <button type="button" className="prog-enlace" onClick={deshacerPropuesta}>
            Deshacer
          </button>
        </div>
      ) : null}

      <div className="prog-movil">
        <div className="prog-m-semanas" role="tablist" aria-label="Semana del programa">
          {semanas.map((semana, indice) => (
            <button
              type="button"
              role="tab"
              key={semana.clave}
              aria-selected={indice === Math.min(semanaMovil, semanas.length - 1)}
              className="prog-m-semana"
              onClick={() => setSemanaMovil(indice)}
            >
              {fechaCorta(semana.desdeClave)} – {fechaCorta(semana.hastaClave)}
            </button>
          ))}
        </div>
        <div className="prog-m-resumen" role="status">
          <strong>{tildadas.length} {tildadas.length === 1 ? 'salida' : 'salidas'}{cambiosDias.length + cambiosFilas.length ? ` · ${cambiosDias.length + cambiosFilas.length} ${cambiosDias.length + cambiosFilas.length === 1 ? 'excepción' : 'excepciones'}` : ''} para guardar</strong>
          {sinCompletar > 0 ? <span>· {sinCompletar} sin territorio</span> : null}
          {sinConductor > 0 ? <span className="prog-m-chip aviso">{sinConductor} sin conductor</span> : null}
          {sinPunto > 0 ? <span className="prog-m-chip aviso">{sinPunto} sin punto</span> : null}
          <span className="prog-m-borrador">{estadoBorrador}</span>
        </div>
        <div className="prog-m-dias" role="tabpanel">
          {diasVisibles.map((dia) => {
            const salidasDelDia = filasDelPeriodo.filter((fila) => fila.fecha === dia.clave)
            const agendaDelDia = salidasEnAgenda.filter((salida) => aClaveFecha(new Date(salida.scheduled_for)) === dia.clave)
            const vivas = salidasDelDia.filter((fila) => !filaDe(fila).sinSalida).length
            const asamblea = dias[dia.clave]
            return (
              <section key={dia.clave} className="prog-m-dia" aria-label={`${NOMBRE_DIA[dia.dow]} ${Number(dia.clave.slice(8))}`}>
                <header className="prog-m-dia-cab">
                  <h4>{esHoy(dia.clave) ? 'Hoy · ' : ''}{NOMBRE_DIA[dia.dow].charAt(0).toUpperCase() + NOMBRE_DIA[dia.dow].slice(1)} {Number(dia.clave.slice(8))}</h4>
                  <span>{asamblea ? '' : salidasDelDia.length ? `${vivas} de ${salidasDelDia.length}` : agendaDelDia.length ? `${agendaDelDia.length} en la agenda` : 'Sin salidas'}</span>
                  <button type="button" aria-label={`Opciones del ${NOMBRE_DIA[dia.dow]} ${Number(dia.clave.slice(8))}`} onClick={() => abrirHojaMovil({ tipo: 'dia', clave: dia.clave })}>⋯</button>
                </header>
                {asamblea ? (
                  <div className="prog-m-asamblea">
                    <span className="prog-m-chip aviso">Sin salidas</span>
                    <strong>{asamblea}</strong>
                    <button type="button" onClick={() => {
                      tocarBorrador({ dias: { ...diasBorrador, [dia.clave]: null } })
                    }}>Quitar</button>
                  </div>
                ) : (
                  <>
                    {salidasDelDia.map((fila, indice) => {
                      const dato = filaDe(fila)
                      const territorio = territorios.find((t) => t.id === dato.territorioId)
                      const conductor = conductores.find((c) => c.id === dato.conductorId)
                      const indiceDelTurno = salidasDelDia.slice(0, indice).filter((anterior) =>
                        anterior.turno === fila.turno && !filaDe(anterior).tildada && !filaDe(anterior).sinSalida,
                      ).length
                      const guardada = agendaDelDia.filter((salida) => turnoEnAgenda(salida) === fila.turno)[indiceDelTurno]
                      if (guardada && !dato.tildada && !dato.sinSalida) {
                        return filaGuardadaMovil(guardada, fila.clave)
                      }
                      if (dato.sinSalida) return (
                        <div key={fila.clave} className="prog-m-fila sin-salida">
                          <span className="prog-m-hora">{NOMBRE_TURNO[fila.turno]}</span>
                          <span className="prog-m-datos"><strong>Sin salida</strong><small>No se programa</small></span>
                          <button type="button" className="prog-m-reponer" onClick={() => cambiar(fila, { sinSalida: false })}>Poner</button>
                        </div>
                      )
                      const lista = dato.tildada && (fila.turno === 'telefono' || Boolean(dato.territorioId && dato.puntoId)) && Boolean(dato.conductorId)
                      return (
                        <button
                          key={fila.clave}
                          type="button"
                          className={`prog-m-fila${dato.tildada ? ' elegida' : ''}`}
                          onClick={() => abrirHojaMovil({ tipo: 'fila', clave: fila.clave, paso: 'editar' })}
                          aria-label={`${tituloSalida(fila)}. ${fila.turno === 'grupos' ? 'Salidas de Grupos' : fila.turno === 'telefono' ? 'Predicación telefónica' : territorio ? `Territorio ${territorio.name}` : 'Sin territorio'}. ${fila.turno === 'grupos' ? 'Cada grupo por su lado' : `${fila.turno === 'telefono' ? 'Cada uno desde su casa' : dato.puntoNombre || 'Falta el punto'}. ${conductor?.full_name || 'Falta el conductor'}`}`}
                        >
                          <span className="prog-m-hora">{dato.hora || '—'}</span>
                          <span className="prog-m-datos">
                            <strong>{fila.turno === 'telefono' ? 'Predicación telefónica' : fila.turno === 'grupos' ? 'Salidas de Grupos' : territorio ? `Territorio ${territorio.name}` : 'Sin territorio'}</strong>
                            <small>{fila.turno === 'telefono' ? 'Cada uno desde su casa' : fila.turno === 'grupos' ? 'Cada grupo por su lado' : dato.puntoNombre || 'Falta el punto'}{fila.turno === 'grupos' ? '' : ` · ${conductor?.full_name ?? 'Falta el conductor'}`}</small>
                          </span>
                          <span className={`prog-m-chip${lista ? ' bien' : dato.tildada ? ' aviso' : ''}`}>{fila.turno === 'grupos' ? 'Grupos' : lista ? 'Lista' : dato.tildada ? 'Falta' : 'Pendiente'}</span>
                          <span className="prog-m-flecha" aria-hidden="true">›</span>
                        </button>
                      )
                    })}
                    {agendaDelDia.map((salida, indice) => {
                      const turno = turnoEnAgenda(salida)
                      const anteriores = agendaDelDia.slice(0, indice).filter((otra) => turnoEnAgenda(otra) === turno).length
                      const representadas = salidasDelDia.filter((fila) =>
                        fila.turno === turno && !filaDe(fila).tildada && !filaDe(fila).sinSalida,
                      ).length
                      return anteriores >= representadas ? filaGuardadaMovil(salida, `agenda-${dia.clave}-${indice}`) : null
                    })}
                    {salidasDelDia.length === 0 && agendaDelDia.length === 0 ? <p className="prog-m-sin-filas">Sin salidas programadas. Podés agregar una desde ⋯</p> : null}
                  </>
                )}
              </section>
            )
          })}
        </div>
        <div className="prog-m-barra">
          <button type="button" className="prog-m-proponer" onClick={() => proponer()} disabled={!puedeEscribir || cargandoRotacion}>✦ {tildadas.length ? 'Completar' : 'Proponer'}</button>
          <button type="button" className="primary-button" onClick={() => void guardar()} disabled={!puedeEscribir || guardando || !hayCambiosParaGuardar || borradorSinSincronizar || Boolean(errorBorrador)}>{guardando ? 'Guardando…' : 'Guardar'}</button>
        </div>
      </div>

      <div className="prog-grilla">
        {semanas.map((semana) => (
          <div key={semana.clave} className="prog-semana">
            <div className="prog-semana-rotulo">
              <strong>{semana.rotulo}</strong>
              <span>{salidasEnLaSemana(semana)} en la agenda</span>
            </div>
            <div className="prog-grilla-cab" aria-hidden="true">
              <span>Tildar</span>
              <span>Territorio</span>
              <span>Punto de encuentro</span>
              <span>Conductor</span>
              <span>Horario</span>
              <span className="prog-cab-mapa">Cómo llegar</span>
              <span />
            </div>
            {diasDelPeriodo
              .filter((dia) => dia.clave >= semana.desdeClave && dia.clave <= semana.hastaClave)
              .map((dia) => {
                const deLaFecha = filasDelPeriodo.filter((f) => f.fecha === dia.clave)
                const asamblea = dias[dia.clave]
                return (
                  <div key={dia.clave} className="prog-dia">
                    <div className="prog-dia-cab">
                      <strong>
                        {esHoy(dia.clave) ? 'Hoy · ' : ''}
                        {NOMBRE_DIA[dia.dow].charAt(0).toUpperCase() + NOMBRE_DIA[dia.dow].slice(1)}{' '}
                        {Number(dia.clave.slice(8))}
                      </strong>
                      <details className="prog-menu-dia">
                        <summary aria-label={`Opciones del ${NOMBRE_DIA[dia.dow]}`}>⋯ Día</summary>
                        <div className="prog-menu-caja">
                          <button type="button" onClick={(e) => agregarExtra(e, dia, 'manana')}>
                            Agregar una salida a la mañana
                          </button>
                          <button type="button" onClick={(e) => agregarExtra(e, dia, 'tarde')}>
                            Agregar una salida a la tarde
                          </button>
                          <button type="button" onClick={(e) => marcarSinSalidaElDia(e, dia)}>
                            Sin salida ese día
                          </button>
                          <button type="button" onClick={(e) => alternarAsamblea(e, dia)}>
                            {asamblea ? 'Quitar el motivo' : 'Marcar asamblea u otro motivo'}
                          </button>
                        </div>
                      </details>
                    </div>

                    {asamblea ? (
                      <div className="prog-banda">
                        <span className="prog-pastilla aviso">Sin salidas</span>
                        <input
                          className="prog-banda-nota"
                          value={asamblea}
                          aria-label="Motivo del día sin salidas"
                          onChange={(e) => tocarBorrador({ dias: { ...diasBorrador, [dia.clave]: e.target.value } })}
                        />
                        <span className="prog-rotacion">Ese día no se programa nada.</span>
                        <button
                          type="button"
                          className="prog-enlace"
                          onClick={() => {
                            tocarBorrador({ dias: { ...diasBorrador, [dia.clave]: null } })
                          }}
                        >
                          Quitar
                        </button>
                      </div>
                    ) : deLaFecha.length === 0 ? (
                      <div className="prog-banda">
                        <span className="prog-pastilla punteada">Sin salida habitual</span>
                        <span className="prog-rotacion">Podés agregar una desde ⋯ Día.</span>
                      </div>
                    ) : (
                      deLaFecha.map((filaDelPrograma) => {
                        const clave = filaDelPrograma.clave
                        const fila = filaDe(filaDelPrograma)
                        const esTelefono = filaDelPrograma.turno === 'telefono'
                        const esGrupos = filaDelPrograma.turno === 'grupos'
                        const opcionesDePunto = puntosDe(fila.territorioId)
                        const chip = chipDe(fila, filaDelPrograma.turno)
                        const avisos = avisosDe(filaDelPrograma)
                        if (fila.sinSalida) {
                          return (
                            <div key={clave} className="prog-fila sin-salida">
                              <span className="prog-pastilla punteada">Sin salida</span>
                              <span className="prog-rotacion">
                                {NOMBRE_TURNO[filaDelPrograma.turno]} del{' '}
                                {NOMBRE_DIA[filaDelPrograma.dow]} {Number(clave.slice(8, 10))} · no se
                                programa
                              </span>
                              <button
                                type="button"
                                className="prog-enlace"
                                onClick={() => cambiar(filaDelPrograma, { sinSalida: false })}
                              >
                                Volver a poner
                              </button>
                            </div>
                          )
                        }
                        return (
                          <div
                            key={clave}
                            data-clave={clave}
                            className={[
                              'prog-fila',
                              fila.tildada ? 'tildada' : '',
                              arrastrando === clave ? 'arrastrando' : '',
                              destino?.clave === clave ? (destino.antes ? 'drop-antes' : 'drop-despues') : '',
                            ]
                              .filter(Boolean)
                              .join(' ')}
                          >
                            <span className="prog-celda-tilde">
                              <input
                                type="checkbox"
                                checked={fila.tildada}
                                disabled={!puedeEscribir || esGrupos}
                                aria-label={`Tildar el ${NOMBRE_DIA[filaDelPrograma.dow]} a la ${NOMBRE_TURNO[filaDelPrograma.turno]}`}
                                onChange={(e) => cambiar(filaDelPrograma, { tildada: e.target.checked })}
                              />
                            </span>

                            <span className="prog-celda-terr">
                              {esGrupos ? (
                                <span className="prog-pastilla oliva">Salidas de Grupos</span>
                              ) : (
                                <Desplegable
                                  etiqueta="Elegir territorio"
                                  className="prog-desplegable"
                                  valor={fila.territorioId}
                                  deshabilitado={!puedeEscribir || esTelefono}
                                  alElegir={(valor) => {
                                    const primero = puntosDe(valor)[0]
                                    cambiar(filaDelPrograma, {
                                      territorioId: valor,
                                      puntoId: primero?.id ?? '',
                                      puntoNombre: primero?.nombre ?? '',
                                      lat: primero?.lat ?? null,
                                      lng: primero?.lng ?? null,
                                      motivo: '',
                                      propuesta: false,
                                      tildada: Boolean(valor),
                                    })
                                  }}
                                  opciones={[
                                    { valor: '', texto: 'Elegir territorio' },
                                    ...territorios.map((t) => ({
                                      valor: t.id,
                                      texto: t.name,
                                      detalle: territorioUsadoEn(t.id, filaDelPrograma)
                                        ? 'Ya está en este programa o en la agenda'
                                        : comoSeDijoLaUltimaVez(rotacion.get(t.id)),
                                      deshabilitada: territorioUsadoEn(t.id, filaDelPrograma) && t.id !== fila.territorioId,
                                    })),
                                  ]}
                                />
                              )}
                              {esTelefono ? (
                                <span className="prog-rotacion">Cada uno desde su casa</span>
                              ) : null}
                              {filaDelPrograma.esExtra ? (
                                <span className="prog-pastilla">2ª salida</span>
                              ) : null}
                            </span>

                            <span className="prog-celda-punto">
                              {esTelefono || esGrupos ? (
                                <span className="prog-rotacion">
                                  {esGrupos ? 'Cada grupo por su lado' : 'Por teléfono'}
                                </span>
                              ) : (
                                <Desplegable
                                  etiqueta="Elegir el punto"
                                  className="prog-desplegable"
                                  valor={fila.puntoId}
                                  deshabilitado={!puedeEscribir || !fila.territorioId}
                                  alElegir={(valor) => {
                                    const punto = opcionesDePunto.find((p) => p.id === valor)
                                    cambiar(filaDelPrograma, {
                                      puntoId: valor,
                                      puntoNombre: punto?.nombre ?? '',
                                      lat: punto?.lat ?? null,
                                      lng: punto?.lng ?? null,
                                    })
                                  }}
                                  opciones={[
                                    { valor: '', texto: 'Elegir el punto' },
                                    ...opcionesDePunto.map((p, indice) => ({
                                      valor: p.id,
                                      texto: p.nombre,
                                      detalle: `Punto ${indice + 1}${
                                        p.lat === null ? ' · sin ubicación en el mapa' : ''
                                      }`,
                                    })),
                                  ]}
                                />
                              )}
                            </span>

                            <span className="prog-celda-cond">
                              {esGrupos ? (
                                <span className="prog-rotacion">Lo coordina cada grupo</span>
                              ) : (
                                <Desplegable
                                  etiqueta="Elegir conductor"
                                  className="prog-desplegable"
                                  valor={fila.conductorId}
                                  deshabilitado={!puedeEscribir}
                                  alElegir={(valor) => cambiar(filaDelPrograma, { conductorId: valor })}
                                  opciones={[
                                    { valor: '', texto: 'Elegir conductor' },
                                    ...conductores
                                      .filter((c) => c.status === 'activo')
                                      .map((c) => ({
                                        valor: c.id,
                                        texto: c.full_name,
                                        detalle: conductorOcupadoEn(c.id, filaDelPrograma)
                                          ? 'Ya conduce ese día'
                                          : !conductorDisponibleEn(c, filaDelPrograma)
                                            ? 'No disponible ese día y turno'
                                            : esTitular(filaDelPrograma.dow, filaDelPrograma.turno, c.id)
                                              ? 'Titular de este turno' : 'Disponible',
                                        deshabilitada: c.id !== fila.conductorId
                                          && (conductorOcupadoEn(c.id, filaDelPrograma)
                                            || !conductorDisponibleEn(c, filaDelPrograma)),
                                      })),
                                  ]}
                                />
                              )}
                            </span>

                            <span className="prog-celda-hora">
                              {esGrupos ? (
                                <span className="prog-hora">{fila.hora}</span>
                              ) : (
                                <Desplegable
                                  etiqueta="Horario"
                                  className="prog-desplegable"
                                  valor={fila.hora}
                                  deshabilitado={!puedeEscribir}
                                  alElegir={(valor) => cambiar(filaDelPrograma, { hora: valor })}
                                  opciones={[
                                    { valor: '', texto: 'Elegir' },
                                    ...(filaDelPrograma.turno === 'manana'
                                      ? HORAS_MANANA
                                      : HORAS_TARDE
                                    ).map((h) => ({ valor: h, texto: h })),
                                  ]}
                                />
                              )}
                            </span>

                            <span className="prog-celda-mapa">
                              {fila.lat !== null && fila.lng !== null ? (
                                <a
                                  className="prog-como-llegar"
                                  href={`https://www.google.com/maps?q=${fila.lat},${fila.lng}`}
                                  target="_blank"
                                  rel="noreferrer"
                                >
                                  Cómo llegar
                                </a>
                              ) : esTelefono || esGrupos ? (
                                <span className="prog-rotacion">—</span>
                              ) : (
                                <span className="prog-rotacion">Sin ubicación</span>
                              )}
                            </span>

                            <span className="prog-celda-acc">
                              {esGrupos ? null : (
                                <>
                                  <span
                                    ref={asaRef}
                                    className="prog-asa"
                                    role="button"
                                    tabIndex={0}
                                    title="Arrastrá para moverla de lugar"
                                    aria-label={`Mover la salida del ${NOMBRE_DIA[filaDelPrograma.dow]} a la ${NOMBRE_TURNO[filaDelPrograma.turno]}`}
                                    onPointerDown={(e) => alBajarElAsa(e, filaDelPrograma)}
                                    onKeyDown={(e) => {
                                      if (e.key === 'ArrowUp') {
                                        e.preventDefault()
                                        moverUnLugar(filaDelPrograma, -1)
                                      }
                                      if (e.key === 'ArrowDown') {
                                        e.preventDefault()
                                        moverUnLugar(filaDelPrograma, 1)
                                      }
                                    }}
                                  >
                                    <svg viewBox="0 0 10 16" width="10" height="16" aria-hidden="true">
                                      <circle cx="2" cy="3" r="1.3" />
                                      <circle cx="8" cy="3" r="1.3" />
                                      <circle cx="2" cy="8" r="1.3" />
                                      <circle cx="8" cy="8" r="1.3" />
                                      <circle cx="2" cy="13" r="1.3" />
                                      <circle cx="8" cy="13" r="1.3" />
                                    </svg>
                                  </span>
                                  <button
                                    type="button"
                                    className="prog-quitar"
                                    title="Sin salida esa vez"
                                    aria-label={`Sin salida el ${NOMBRE_DIA[filaDelPrograma.dow]} a la ${NOMBRE_TURNO[filaDelPrograma.turno]}`}
                                    onClick={() => quitarFila(filaDelPrograma)}
                                  >
                                    <Icono nombre="cerrar" tamaño={16} />
                                  </button>
                                </>
                              )}
                            </span>

                            {fila.motivo || chip || avisos.length > 0 ? (
                              <div className="prog-motivo">
                                {fila.motivo ? <span className="prog-porque">{fila.motivo}</span> : null}
                                {chip ? <span className={chip.clase}>{chip.texto}</span> : null}
                                {avisos.map((aviso, indice) => (
                                  <span key={`${aviso.texto}-${indice}`} className={aviso.clase}>
                                    {aviso.texto}
                                  </span>
                                ))}
                                {fila.propuesta && puedeEscribir ? (
                                  <button
                                    type="button"
                                    className="prog-enlace"
                                    onClick={() => siguienteTerritorio(filaDelPrograma)}
                                  >
                                    Cambiar por el siguiente
                                  </button>
                                ) : null}
                              </div>
                            ) : null}
                          </div>
                        )
                      })
                    )}
                  </div>
                )
              })}
          </div>
        ))}
      </div>

      {cargandoRotacion ? <p className="table-hint">Leyendo la rotación de territorios…</p> : null}

      {hojaMovil && createPortal(
        <div className="prog-m-capa" onMouseDown={(evento) => {
          if (evento.target === evento.currentTarget) cerrarHojaMovil()
        }}>
          <div className="prog-m-hoja" ref={hojaRef} role="dialog" aria-modal="true" aria-labelledby="prog-m-hoja-titulo">
            <span className="prog-m-hoja-asa" aria-hidden="true" />
            <header className="prog-m-hoja-cab">
              {hojaMovil.tipo === 'fila' && hojaMovil.paso !== 'editar' ? (
                <button type="button" className="prog-m-hoja-icono" aria-label="Volver a la salida" onClick={() => setHojaMovil({ ...hojaMovil, paso: 'editar' })}>‹</button>
              ) : null}
              <h3 id="prog-m-hoja-titulo">
                {hojaMovil.tipo === 'dia' ? `Opciones del ${diaAbierto ? NOMBRE_DIA[diaAbierto.dow] : 'día'}` :
                  hojaMovil.paso === 'editar' ? filaAbierta ? tituloSalida(filaAbierta) : 'Salida' :
                  hojaMovil.paso === 'territorio' ? 'Elegir territorio' :
                  hojaMovil.paso === 'punto' ? 'Punto de encuentro' :
                  hojaMovil.paso === 'conductor' ? 'Elegir conductor' : 'Elegir horario'}
              </h3>
              <button type="button" className="prog-m-hoja-icono cerrar" data-hoja-cerrar aria-label="Cerrar" onClick={cerrarHojaMovil}>×</button>
            </header>
            {hojaMovil.tipo === 'dia' && diaAbierto ? (
              <div className="prog-m-hoja-cuerpo">
                <p className="prog-m-hoja-nota">Los cambios de este día quedan en el borrador hasta que guardes el programa.</p>
                <div className="prog-m-hoja-campos">
                  {(['manana', 'tarde', 'telefono'] as const).map((turno) => (
                    <button key={turno} type="button" onClick={() => {
                      agregarExtra(null, diaAbierto, turno)
                      cerrarHojaMovil()
                    }}>Agregar salida {turno === 'telefono' ? 'por teléfono' : `a la ${NOMBRE_TURNO[turno]}`} <span aria-hidden="true">＋</span></button>
                  ))}
                  <button type="button" onClick={() => {
                    marcarSinSalidaElDia(null, diaAbierto)
                    cerrarHojaMovil()
                  }}>Sin salida ese día <span aria-hidden="true">›</span></button>
                  <button type="button" onClick={() => {
                    alternarAsamblea(null, diaAbierto)
                    cerrarHojaMovil()
                  }}>{dias[diaAbierto.clave] ? 'Quitar la asamblea' : 'Asamblea regional'} <span aria-hidden="true">›</span></button>
                </div>
              </div>
            ) : hojaMovil.tipo === 'fila' && filaAbierta && datoAbierto ? (
              <>
                {hojaMovil.paso === 'editar' ? (
                  <div className="prog-m-hoja-cuerpo">
                    <div className="prog-m-hoja-resumen">
                      <span className={`prog-m-chip${datoAbierto.tildada ? ' bien' : ''}`}>{datoAbierto.tildada ? 'En este programa' : 'Pendiente'}</span>
                      <strong>{filaAbierta.turno === 'telefono' ? 'Predicación telefónica' : filaAbierta.turno === 'grupos' ? 'Salidas de Grupos' : datoAbierto.territorioId ? `Territorio ${territorios.find((t) => t.id === datoAbierto.territorioId)?.name ?? ''}` : 'Sin territorio'}</strong>
                      <span>{filaAbierta.turno === 'telefono' ? 'Cada uno desde su casa' : datoAbierto.puntoNombre || 'Sin punto de encuentro'}</span>
                    </div>
                    {filaAbierta.turno !== 'grupos' ? (
                      <>
                        <button type="button" className="prog-m-incluir" onClick={() => cambiar(filaAbierta, { tildada: !datoAbierto.tildada })} disabled={!puedeEscribir} aria-pressed={datoAbierto.tildada}>
                          <span className="prog-m-incluir-marca" aria-hidden="true">{datoAbierto.tildada ? '✓' : ''}</span>
                          Incluir esta salida en el programa
                        </button>
                        <div className="prog-m-hoja-campos">
                          <button type="button" onClick={() => setHojaMovil({ ...hojaMovil, paso: 'horario' })} disabled={!puedeEscribir}><span>Horario</span><strong>{datoAbierto.hora || 'Elegir'} <b aria-hidden="true">›</b></strong></button>
                          {filaAbierta.turno !== 'telefono' ? <>
                            <button type="button" onClick={() => setHojaMovil({ ...hojaMovil, paso: 'territorio' })} disabled={!puedeEscribir}><span>Territorio</span><strong>{territorios.find((t) => t.id === datoAbierto.territorioId)?.name ?? 'Elegir'} <b aria-hidden="true">›</b></strong></button>
                            <button type="button" onClick={() => setHojaMovil({ ...hojaMovil, paso: 'punto' })} disabled={!puedeEscribir || !datoAbierto.territorioId}><span>Punto de encuentro</span><strong>{datoAbierto.puntoNombre || 'Elegir'} <b aria-hidden="true">›</b></strong></button>
                          </> : null}
                          <button type="button" onClick={() => setHojaMovil({ ...hojaMovil, paso: 'conductor' })} disabled={!puedeEscribir}><span>Conductor</span><strong>{conductores.find((c) => c.id === datoAbierto.conductorId)?.full_name ?? 'Elegir'} <b aria-hidden="true">›</b></strong></button>
                        </div>
                        {datoAbierto.lat !== null && datoAbierto.lng !== null ? (
                          <a className="prog-m-hoja-accion" href={`https://www.google.com/maps?q=${datoAbierto.lat},${datoAbierto.lng}`} target="_blank" rel="noreferrer">Cómo llegar</a>
                        ) : null}
                        {avisosDe(filaAbierta).length > 0 ? (
                          <div className="prog-m-hoja-avisos">{avisosDe(filaAbierta).map((aviso) => <span key={aviso.texto}>{aviso.texto}</span>)}</div>
                        ) : null}
                        {datoAbierto.propuesta ? <button type="button" className="prog-m-hoja-accion" onClick={() => siguienteTerritorio(filaAbierta)}>Cambiar por el siguiente territorio</button> : null}
                        <div className="prog-m-hoja-mover">
                          <span>Posición en el día</span>
                          <button type="button" onClick={() => moverUnLugar(filaAbierta, -1)} disabled={filasDelPeriodo.filter((f) => f.fecha === filaAbierta.fecha)[0]?.clave === filaAbierta.clave}>↑ Subir</button>
                          <button type="button" onClick={() => moverUnLugar(filaAbierta, 1)} disabled={filasDelPeriodo.filter((f) => f.fecha === filaAbierta.fecha).at(-1)?.clave === filaAbierta.clave}>↓ Bajar</button>
                        </div>
                        <button type="button" className="prog-m-hoja-quitar" onClick={() => {
                          quitarFila(filaAbierta)
                          cerrarHojaMovil()
                        }}>{filaAbierta.esExtra ? 'Eliminar esta salida' : 'Sin salida esa vez'}</button>
                      </>
                    ) : <p className="prog-m-hoja-nota">Esta salida se coordina por grupos de servicio.</p>}
                  </div>
                ) : (
                  <div className="prog-m-hoja-cuerpo">
                    {hojaMovil.paso === 'territorio' ? (
                      <div className="prog-m-hoja-lista">
                        {[...territorios].sort((a, b) =>
                          (rotacion.get(b.id)?.diasSinTrabajar ?? 99_999) - (rotacion.get(a.id)?.diasSinTrabajar ?? 99_999)
                          || a.name.localeCompare(b.name, 'es', { numeric: true }),
                        ).map((territorio) => {
                          const rotada = rotacion.get(territorio.id)
                          const usado = territorioUsadoEn(territorio.id, filaAbierta)
                          return <button key={territorio.id} type="button" aria-selected={datoAbierto.territorioId === territorio.id}
                            disabled={usado && datoAbierto.territorioId !== territorio.id} onClick={() => {
                            const primero = puntosDe(territorio.id)[0]
                            cambiar(filaAbierta, { territorioId: territorio.id, puntoId: primero?.id ?? '', puntoNombre: primero?.nombre ?? '', lat: primero?.lat ?? null, lng: primero?.lng ?? null, tildada: true, propuesta: false, motivo: '' })
                            setHojaMovil({ ...hojaMovil, paso: 'editar' })
                          }}><span><strong>Territorio {territorio.name}</strong><small>{usado ? 'Ya está en este programa o en la agenda' : comoSeDijoLaUltimaVez(rotada)}</small></span><em>{puntosDe(territorio.id).length} {puntosDe(territorio.id).length === 1 ? 'punto' : 'puntos'}</em></button>
                        })}
                      </div>
                    ) : hojaMovil.paso === 'punto' ? (
                      <>{puntosDe(datoAbierto.territorioId).length ? <div className="prog-m-hoja-lista">
                        {puntosDe(datoAbierto.territorioId).map((punto, indice) => <button key={punto.id} type="button" aria-selected={datoAbierto.puntoId === punto.id} onClick={() => {
                          cambiar(filaAbierta, { puntoId: punto.id, puntoNombre: punto.nombre, lat: punto.lat, lng: punto.lng })
                          setHojaMovil({ ...hojaMovil, paso: 'editar' })
                        }}><span><strong>Punto {indice + 1}</strong><small>{punto.nombre}{punto.lat === null ? ' · sin ubicación en el mapa' : ''}</small></span><em>{punto.lat !== null ? 'En el mapa' : '—'}</em></button>) }
                      </div> : <p className="prog-m-hoja-nota">Este territorio todavía no tiene puntos. Se agregan desde Mapas y Territorios.</p>}</>
                    ) : hojaMovil.paso === 'conductor' ? (
                      <div className="prog-m-hoja-lista">
                        {conductores.filter((conductor) => conductor.status === 'activo').map((conductor) => {
                          const disponible = conductorDisponibleEn(conductor, filaAbierta)
                          const ocupado = conductorOcupadoEn(conductor.id, filaAbierta)
                          const titular = esTitular(filaAbierta.dow, filaAbierta.turno, conductor.id)
                          return <button key={conductor.id} type="button" aria-selected={datoAbierto.conductorId === conductor.id}
                            disabled={conductor.id !== datoAbierto.conductorId && (!disponible || ocupado)} onClick={() => {
                              cambiar(filaAbierta, { conductorId: conductor.id, tildada: true })
                              setHojaMovil({ ...hojaMovil, paso: 'editar' })
                            }}><span><strong>{conductor.full_name}</strong><small>{ocupado ? 'Ya conduce ese día' : !disponible ? 'No está disponible ese día y turno' : titular ? 'Titular de este turno' : 'Disponible'}</small></span>{titular ? <em>Fijo</em> : null}</button>
                        })}
                      </div>
                    ) : (
                      <><div className="prog-m-hoja-lista">
                        {(filaAbierta.turno === 'manana' ? HORAS_MANANA : filaAbierta.turno === 'tarde' ? HORAS_TARDE : [...HORAS_MANANA, ...HORAS_TARDE]).map((hora) => <button key={hora} type="button" aria-selected={datoAbierto.hora === hora} onClick={() => {
                          cambiar(filaAbierta, { hora })
                          setHojaMovil({ ...hojaMovil, paso: 'editar' })
                        }}><span><strong>{hora}</strong><small>{hora === horaHabitual(config, filaAbierta.dow, filaAbierta.turno) ? 'Horario habitual' : 'Solo esta semana'}</small></span></button>)}
                      </div><p className="prog-m-hoja-nota">El cambio de horario de esta salida vale solo para este programa. El horario habitual se edita en “La semana de siempre”.</p></>
                    )}
                  </div>
                )}
                {hojaMovil.paso === 'editar' ? <footer className="prog-m-hoja-pie"><button type="button" className="primary-button" onClick={cerrarHojaMovil}>Listo</button></footer> : null}
              </>
            ) : null}
          </div>
        </div>, document.body,
      )}

      {configAbierta ? (
        <div
          className="prog-capa"
          role="dialog"
          aria-modal="true"
          aria-label="Configuración de la semana"
          onMouseDown={(e) => {
            if (e.target === e.currentTarget) setConfigAbierta(false)
          }}
        >
          <div className="prog-cajon">
            <header>
              <div>
                <p className="eyebrow">La semana de siempre</p>
                <h3>Configuración de la semana</h3>
                <p className="table-hint">
                  Los horarios se cambian acá y valen para todo el armado. Los titulares salen de la
                  congregación: uno es siempre el mismo, dos alternan una semana cada uno.
                </p>
              </div>
              <button
                type="button"
                className="ghost-button"
                onClick={() => setConfigAbierta(false)}
                aria-label="Cerrar"
              >
                <Icono nombre="cerrar" tamaño={18} />
              </button>
            </header>
            <div className="prog-cajon-cuerpo">
              <h4>Horarios</h4>
              <div className="prog-horario-grilla">
                {[1, 2, 3, 4, 5, 6, 0].map((dow) => (
                  <div key={dow} className="prog-horario-fila">
                    <span className="prog-horario-dia">
                      {NOMBRE_DIA[dow].charAt(0).toUpperCase() + NOMBRE_DIA[dow].slice(1)}
                    </span>
                    {(['manana', 'tarde'] as const).map((turno) => {
                      const valor = config.horarios[claveFila(String(dow), turno)] ?? ''
                      return (
                        <select
                          key={turno}
                          className="prog-select"
                          aria-label={`${NOMBRE_DIA[dow]} a la ${NOMBRE_TURNO[turno]}`}
                          value={valor}
                          onChange={(e) => {
                            const horarios = { ...config.horarios }
                            if (e.target.value) horarios[claveFila(String(dow), turno)] = e.target.value
                            else delete horarios[claveFila(String(dow), turno)]
                            setConfigEditada({ ...config, horarios })
                          }}
                        >
                          <option value="">No se sale</option>
                          {(turno === 'manana' ? HORAS_MANANA : HORAS_TARDE).map((h) => (
                            <option key={h} value={h}>
                              {h}
                            </option>
                          ))}
                        </select>
                      )
                    })}
                    <span className="prog-rotacion">
                      {config.telefono.some((t) => t.dow === dow)
                        ? 'Teléfono'
                        : config.grupos.some((g) => g.dow === dow)
                          ? 'Salidas de Grupos'
                          : ''}
                    </span>
                  </div>
                ))}
              </div>
              <h4>Predicación por teléfono</h4>
              <p className="prog-config-ayuda">Estos días y horarios se repiten todas las semanas. Un feriado se cambia sólo en la grilla.</p>
              <div className="prog-telefono-lista">
                {config.telefono.map((item, indice) => (
                  <div className="prog-telefono-fila" key={`${item.dow}-${indice}`}>
                    <select className="prog-select" aria-label={`Día de teléfono ${indice + 1}`} value={item.dow}
                      onChange={(e) => setConfigEditada({ ...config, telefono: config.telefono.map((actual, i) =>
                        i === indice ? { ...actual, dow: Number(e.target.value) } : actual,
                      ) })}>
                      {[1, 2, 3, 4, 5, 6, 0].map((dow) => <option key={dow} value={dow}
                        disabled={config.telefono.some((otro, i) => i !== indice && otro.dow === dow)}>
                        {NOMBRE_DIA[dow].charAt(0).toUpperCase() + NOMBRE_DIA[dow].slice(1)}
                      </option>)}
                    </select>
                    <select className="prog-select" aria-label={`Horario de teléfono ${NOMBRE_DIA[item.dow]}`} value={item.hora}
                      onChange={(e) => setConfigEditada({ ...config, telefono: config.telefono.map((actual, i) =>
                        i === indice ? { ...actual, hora: e.target.value } : actual,
                      ) })}>
                      {[...HORAS_MANANA, ...HORAS_TARDE].map((hora) => <option key={hora} value={hora}>{hora}</option>)}
                    </select>
                    <button type="button" className="prog-enlace" aria-label={`Quitar teléfono del ${NOMBRE_DIA[item.dow]}`}
                      onClick={() => setConfigEditada({ ...config, telefono: config.telefono.filter((_, i) => i !== indice) })}>Quitar</button>
                  </div>
                ))}
              </div>
              <button type="button" className="secondary-button prog-config-agregar"
                disabled={config.telefono.length >= 7}
                onClick={() => {
                  const libre = [1, 2, 3, 4, 5, 6, 0].find((dow) => !config.telefono.some((item) => item.dow === dow))
                  if (libre !== undefined) setConfigEditada({ ...config, telefono: [...config.telefono, { dow: libre, hora: '16:00' }] })
                }}>＋ Agregar día de teléfono</button>

              <h4>Titulares</h4>
              <p className="prog-config-ayuda">Una persona conduce siempre. Si elegís dos, se alternan semana por semana.</p>
              <div className="prog-titular-lista">
                {[1, 2, 3, 4, 5, 6, 0].flatMap((dow) =>
                  (['manana', 'tarde', 'telefono'] as const).map((turno) => {
                    if (!horaHabitual(config, dow, turno)) return null
                    const clave = claveFila(String(dow), turno)
                    const lista = config.titulares[clave] ?? []
                    const opciones = conductores.filter((conductor) => conductor.status === 'activo' || lista.includes(conductor.id))
                      .sort((a, b) => a.full_name.localeCompare(b.full_name, 'es'))
                    const cambiarTitular = (indice: number, valor: string) => {
                      const titulares = { ...config.titulares }
                      const siguientes = [...lista]
                      if (indice === 0) {
                        if (!valor) delete titulares[clave]
                        else titulares[clave] = [valor, ...siguientes.slice(1).filter((id) => id !== valor)]
                      } else {
                        if (valor) titulares[clave] = [siguientes[0], valor]
                        else titulares[clave] = siguientes.slice(0, 1)
                      }
                      setConfigEditada({ ...config, titulares })
                    }
                    return (
                      <div key={`${dow}-${turno}`} className="prog-titular-fila">
                        <span>
                          {NOMBRE_DIA[dow].charAt(0).toUpperCase() + NOMBRE_DIA[dow].slice(1)}
                        </span>
                        <span className="prog-rotacion">{NOMBRE_TURNO[turno]}</span>
                        {[0, 1].map((indice) => <label key={indice} className="prog-titular-control">
                          <span>{indice === 0 ? 'Titular' : 'Alterna con'}</span>
                          <select className="prog-select" value={lista[indice] ?? ''}
                            aria-label={`${indice === 0 ? 'Titular' : 'Alterna con'} del ${NOMBRE_DIA[dow]} a la ${NOMBRE_TURNO[turno]}`}
                            disabled={indice === 1 && !lista[0]}
                            onChange={(e) => cambiarTitular(indice, e.target.value)}>
                            <option value="">{indice === 0 ? 'Elegir conductor' : 'No alterna'}</option>
                            {opciones.filter((conductor) => conductor.id !== lista[1 - indice]).map((conductor) =>
                              <option key={conductor.id} value={conductor.id}>{conductor.full_name}</option>,
                            )}
                          </select>
                        </label>)}
                      </div>
                    )
                  }),
                )}
              </div>
              <p className="prog-nota">
                {configSemana
                  ? 'La semana está guardada en la base: lo que cambies acá vale para todos, en todas las pantallas.'
                  : 'La semana todavía vive en el código. Guardala acá y va a pasar a la base, donde vale para todos.'}
              </p>
            </div>
            <footer className="prog-cajon-pie">
              <button
                type="button"
                className="secondary-button"
                onClick={() => setConfigAbierta(false)}
              >
                Cerrar
              </button>
              <button
                type="button"
                className="primary-button"
                onClick={() => void guardarLaSemana()}
                disabled={!puedeEscribir || guardandoSemana}
              >
                <Icono nombre="guardar" tamaño={18} />
                {guardandoSemana ? 'Guardando…' : 'Guardar la semana'}
              </button>
            </footer>
          </div>
        </div>
      ) : null}
    </section>
  )
}
