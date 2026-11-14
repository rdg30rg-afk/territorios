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
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useMenusMas } from '../../lib/useMenusMas'
import { periodoAlAbrir } from './periodoAlAbrir'
import { createPortal } from 'react-dom'
import { Link } from 'react-router-dom'
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
  desdeProgramable,
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
  /* La agenda de Salidas genera el PDF y necesita saber si hay algo sin
     guardar para avisarlo recién al pedir el PDF, no todo el tiempo. */
  alCambiarPendientes?: (pendientes: PendientesDelPrograma | null) => void
}

export type PendientesDelPrograma = {
  /* Salidas tildadas sin guardar; 0 con hayCambios = solo excepciones. */
  cuantas: number
  hayCambios: boolean
  puedeGuardar: boolean
  guardar: () => Promise<boolean>
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
  alCambiarPendientes,
}: Props) {
  useMenusMas()
  const client = supabase
  const [borrador, setBorrador] = useState<Borrador>(leerBorrador)
  const [periodo, setPeriodo] = useState(() => periodoAlAbrir(borrador.periodo, borrador))
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
  /* Si una lectura falla no se sigue con datos a medias: se muestra el error
     y se frena el proponer y el guardar hasta que vuelva a andar. */
  const [errorRotacion, setErrorRotacion] = useState<string | null>(null)
  const [errorAgenda, setErrorAgenda] = useState<string | null>(null)
  const [errorExcepciones, setErrorExcepciones] = useState<string | null>(null)
  const [errorSemana, setErrorSemana] = useState<string | null>(null)
  const [cargandoAgenda, setCargandoAgenda] = useState(true)
  const [recargarLecturas, setRecargarLecturas] = useState(0)
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
  const [indiceFalta, setIndiceFalta] = useState(0)
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

  const hoyClave = aClaveFecha(new Date())
  const desdeEfectivo = desdeProgramable(periodo.desde)
  const hayDiasPasadosEnElPeriodo = periodo.desde < hoyClave
  const configBase = useMemo(() => configDeLaCongregacion(conductores), [conductores])
  const config = configEditada ?? configSemana ?? configBase
  const dias = useMemo(() => {
    const unidos = { ...diasGuardados }
    for (const [fecha, motivo] of Object.entries(diasBorrador)) {
      /* Un motivo vacío sigue marcando el día: si no, al borrar el texto
         para escribir otro el día se desmarcaba mientras tipeabas. */
      if (motivo !== null && motivo !== undefined) unidos[fecha] = motivo
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
        setPeriodo(periodoAlAbrir(cargado.periodo ?? local.periodo, cargado))
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
    setCargandoRotacion(true)
    setErrorRotacion(null)
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
      .catch((caught) => {
        /* Sin la rotación todo figuraría como «Nunca se programó» y la
           propuesta saldría mal: se avisa y se frena. */
        if (!vivo) return
        setRotacion(new Map())
        setErrorRotacion(decirElError(
          caught instanceof Error ? { message: caught.message } : (caught as { message?: string }),
          'No se pudo leer qué territorios se trabajaron.',
        ))
      })
      .finally(() => {
        if (vivo) setCargandoRotacion(false)
      })
    return () => {
      vivo = false
    }
  }, [client, recargarLecturas])

  useEffect(() => {
    if (!client) return
    let vivo = true
    setErrorSemana(null)
    void cargarConfigSemana(client)
      .then((cargada) => {
        if (vivo) setConfigSemana(cargada)
      })
      .catch((caught) => {
        /* Con la lectura caída, la semana del código no es la real: guardarla
           pisaría la de todos. Se frena hasta que se pueda leer. */
        if (vivo) setErrorSemana(decirElError(
          caught instanceof Error ? { message: caught.message } : (caught as { message?: string }),
          'No se pudo leer la semana de siempre.',
        ))
      })
    return () => {
      vivo = false
    }
  }, [client, recargarLecturas])

  /* Lo que ya está guardado en el período: el motor no lo pisa y la cabecera
     de cada semana lo cuenta. */
  useEffect(() => {
    if (!client) return
    let vivo = true
    setCargandoAgenda(true)
    void client
      .from('salidas')
      .select('scheduled_for, territory_id, driver_id, tipo, meeting_point_name')
      .gte('scheduled_for', `${periodo.desde}T00:00:00-03:00`)
      .lt('scheduled_for', `${periodo.hasta}T23:59:59-03:00`)
      .then(({ data, error: errorLectura }) => {
        if (!vivo) return
        if (errorLectura) {
          /* Sin la agenda, «Proponer» rearmaría lo ya guardado y lo duplicaría. */
          setErrorAgenda(decirElError(errorLectura, 'No se pudo leer la agenda de esas fechas.'))
        } else {
          setErrorAgenda(null)
          setSalidasEnAgenda(data ?? [])
        }
        setCargandoAgenda(false)
      }, (caught) => {
        if (!vivo) return
        setErrorAgenda(decirElError(
          caught instanceof Error ? { message: caught.message } : (caught as { message?: string }),
          'No se pudo leer la agenda de esas fechas.',
        ))
        setCargandoAgenda(false)
      })
    return () => {
      vivo = false
    }
  }, [client, periodo.desde, periodo.hasta, recargarSalidas, recargarLecturas])

  /* Si alguien borra o cambia una salida desde la agenda, el programa se
     entera al volver a esta pestaña (si no, un conductor quedaba «ocupado»
     por una salida que ya no existe). */
  useEffect(() => {
    const alVolver = () => {
      if (document.visibilityState === 'visible') setRecargarSalidas((n) => n + 1)
    }
    document.addEventListener('visibilitychange', alVolver)
    window.addEventListener('focus', alVolver)
    return () => {
      document.removeEventListener('visibilitychange', alVolver)
      window.removeEventListener('focus', alVolver)
    }
  }, [])

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
      setErrorExcepciones(respuestaDias.error || respuestaFilas.error
        ? decirElError(respuestaDias.error ?? respuestaFilas.error, 'No se pudieron leer los días sin salida.')
        : null)
      if (!respuestaDias.error) {
        setDiasGuardados(Object.fromEntries((respuestaDias.data ?? []).map((fila) => [fila.fecha, fila.motivo])))
      }
      if (!respuestaFilas.error) {
        setFilasGuardadasSinSalida(new Set((respuestaFilas.data ?? []).map((fila) =>
          claveFila(fila.fecha, fila.turno as Turno),
        )))
      }
    }, (caught) => {
      if (vivo) setErrorExcepciones(decirElError(
        caught instanceof Error ? { message: caught.message } : (caught as { message?: string }),
        'No se pudieron leer los días sin salida.',
      ))
    })
    return () => { vivo = false }
  }, [client, periodo.desde, periodo.hasta, recargarExcepciones, recargarLecturas])

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
    /* Los días que ya pasaron no se programan: crearían salidas en el pasado
       que cuentan como trabajadas en la rotación. */
    for (let d = deClaveFecha(desdeEfectivo); d.getTime() <= fin.getTime(); ) {
      lista.push({ clave: aClaveFecha(d), dow: d.getDay() })
      d = new Date(d.getFullYear(), d.getMonth(), d.getDate() + 1)
    }
    return lista
  }, [desdeEfectivo, periodo.hasta])

  /* Las filas del período: los turnos de la semana más las que se agregaron a
     mano, sin los días que quedaron marcados como asamblea, y en el orden que
     el usuario haya elegido. */
  const filasDelPeriodo = useMemo<FilaDelPrograma[]>(() => {
    const lista: FilaDelPrograma[] = []
    for (const dia of diasDelPeriodo) {
      if (dias[dia.clave] !== undefined) continue
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
    () => deClaveFecha(desdeEfectivo).getTime() > deClaveFecha(periodo.hasta).getTime()
      ? []
      : semanasDelRango(deClaveFecha(desdeEfectivo), deClaveFecha(periodo.hasta)),
    [desdeEfectivo, periodo.hasta],
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

  const esSalidaDeGrupos = (salida: { meeting_point_name: string | null }) =>
    /salidas? de grupos?/i.test(salida.meeting_point_name ?? '')

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
      && !esSalidaDeGrupos(salida) && salida.driver_id === conductorId)
  const territorioUsadoEn = (territorioId: string, fila: FilaDelPrograma) =>
    filasDelPeriodo.some((otra) => otra.clave !== fila.clave && filas[otra.clave]?.tildada
      && filas[otra.clave]?.territorioId === territorioId)
    || salidasEnAgenda.some((salida) => salida.territory_id === territorioId)

  /* ---------- lo que se guarda ---------- */
  const tildadas = filasDelPeriodo.filter((f) => filas[f.clave]?.tildada)
  const motivoFinal = (motivo: string | null | undefined) =>
    motivo === null || motivo === undefined ? null : (motivo.trim() || 'Asamblea regional')
  const cambiosDias = Object.entries(diasBorrador)
    .map(([fecha, motivo]) => ({ fecha, motivo: motivoFinal(motivo) }))
    .filter(({ fecha, motivo }) => fecha >= desdeEfectivo && fecha <= periodo.hasta
      && motivo !== (diasGuardados[fecha] ?? null))
  const cambiosFilas = Object.entries(filasBorrador)
    .filter(([clave, fila]) => clave.slice(0, 10) >= desdeEfectivo && clave.slice(0, 10) <= periodo.hasta
      && !clave.includes('-extra') && !clave.endsWith('-grupos')
      && fila.sinSalida !== filasGuardadasSinSalida.has(clave))
    .map(([clave, fila]) => ({ clave, fecha: clave.slice(0, 10), turno: clave.slice(11) as Turno, sin_salida: fila.sinSalida }))
  const problemaDeLectura = errorSemana ?? errorAgenda ?? errorExcepciones ?? errorRotacion
  const lecturasListas = !problemaDeLectura && !cargandoRotacion && !cargandoAgenda
  const puedeProponer = puedeEscribir && lecturasListas
  const hayCambiosParaGuardar = tildadas.length > 0 || cambiosDias.length > 0 || cambiosFilas.length > 0

  /* ---------- avisos de una fila ---------- */
  const avisosDe = (f: FilaDelPrograma): Array<{ clase: string; texto: string; ir?: string; irTexto?: string }> => {
    const fila = filas[f.clave]
    if (!fila?.tildada) return []
    const avisos: Array<{ clase: string; texto: string; ir?: string; irTexto?: string }> = []
    const esTelefono = f.turno === 'telefono'
    const esGrupos = f.turno === 'grupos'
    if (esGrupos) return avisos
    if (!esTelefono && !fila.territorioId) {
      avisos.push({ clase: 'prog-pastilla aviso', texto: 'Falta el territorio' })
    }
    if (!esTelefono && !fila.puntoId) {
      avisos.push(fila.territorioId && puntosDe(fila.territorioId).length === 0
        ? { clase: 'prog-pastilla aviso', texto: 'Este territorio no tiene punto cargado', ir: `/mapas?territorio=${encodeURIComponent(fila.territorioId)}`, irTexto: 'Cargarlo en Mapas' }
        : { clase: 'prog-pastilla aviso', texto: 'Falta el punto de encuentro' })
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
        (s) => aClaveFecha(new Date(s.scheduled_for)) === f.fecha && !esSalidaDeGrupos(s)
          && s.driver_id === fila.conductorId,
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
      } else if (salidasEnAgenda.some((s) => s.territory_id === fila.territorioId)) {
        avisos.push({ clase: 'prog-pastilla aviso', texto: 'Ese territorio ya está en la agenda de este período' })
      }
    }
    return avisos
  }

  const chipDe = (fila: Fila, turno: Turno) => {
    if (!fila.tildada) return null
    const lista =
      (Boolean(fila.territorioId) && Boolean(fila.puntoId) && Boolean(fila.conductorId)) ||
      (turno === 'telefono' && Boolean(fila.conductorId))
    /* Cuando falta algo, el aviso de la fila ya dice qué falta: un chip
       "Falta" al lado de "Falta el conductor" repetía la noticia dos veces. */
    return lista ? { clase: 'prog-pastilla bien', texto: 'Lista' } : null
  }

  /* ---------- qué falta para guardar ----------
     Un problema repetido se dice una vez, con número; el detalle vive en la
     fila que lo tiene. */
  const filasConFalta = (() => {
    const lista: Array<{ clave: string; falta: string[] }> = []
    for (const f of tildadas) {
      const fila = filas[f.clave]!
      const falta: string[] = []
      if (!fila.hora) falta.push('horario')
      if (!fila.conductorId) falta.push('conductor')
      if (f.turno !== 'telefono') {
        if (!fila.territorioId) falta.push('territorio')
        else if (!fila.puntoId || !fila.puntoNombre) falta.push('punto')
      }
      if (!falta.length && avisosDe(f).some((aviso) => aviso.clase.includes('mal')
        || aviso.texto.includes('ya está en otra salida del período'))) falta.push('repetido')
      if (falta.length) lista.push({ clave: f.clave, falta })
    }
    return lista
  })()
  /* El servidor solo inserta lo que se le manda (no borra ni toca lo demás):
     por eso se pueden guardar las salidas completas y dejar las otras como
     borrador, sin trabar todo por una fila a medio armar. */
  const clavesConFalta = new Set(filasConFalta.map((f) => f.clave))
  const salidasListas = tildadas.filter((f) => !clavesConFalta.has(f.clave))
  const textoDeLoQueFalta = (() => {
    const n = filasConFalta.length
    if (!n) return ''
    const tipos = new Set(filasConFalta.flatMap((f) => f.falta))
    if (tipos.size > 1) return `Faltan datos en ${n} salidas`
    const [tipo] = [...tipos]
    const frases: Record<string, [string, string]> = {
      horario: ['Falta 1 horario', `Faltan ${n} horarios`],
      conductor: ['Falta 1 conductor', `Faltan ${n} conductores`],
      territorio: ['Falta 1 territorio', `Faltan ${n} territorios`],
      punto: ['Falta 1 punto de encuentro', `Faltan ${n} puntos de encuentro`],
      repetido: ['1 salida repite conductor o territorio', `${n} salidas repiten conductor o territorio`],
    }
    return frases[tipo!]![n === 1 ? 0 : 1]
  })()
  /* Lo que bloquea sin ser de una fila. Los errores de lectura y de borrador
     ya tienen su propio aviso arriba: no se repiten acá. */
  const estadoDelGuardado: { texto: string; falta: boolean } = (() => {
    if (!puedeEscribir) return { texto: 'No tenés permiso para guardar el programa.', falta: false }
    if (problemaDeLectura || errorBorrador) return { texto: '', falta: false }
    if (borradorSinSincronizar) return { texto: 'Sincronizando el borrador…', falta: false }
    if (scope === 'grupo' && !grupoId) return { texto: 'Elegí el grupo de servicio.', falta: false }
    if (!hayCambiosParaGuardar) return { texto: 'Tildá los horarios, completá territorio y conductor, y guardá.', falta: false }
    if (filasConFalta.length) {
      const pendientes = filasConFalta.length
      const resto = salidasListas.length
        ? `se guardan las ${salidasListas.length} completas y ${pendientes === 1 ? 'queda 1 pendiente' : `quedan ${pendientes} pendientes`}`
        : 'todavía no hay ninguna completa para guardar'
      return { texto: `${textoDeLoQueFalta} · ${resto}`, falta: true }
    }
    const n = tildadas.length
    return { texto: n ? `${n} ${n === 1 ? 'salida lista' : 'salidas listas'} para guardar` : 'Cambios listos para guardar', falta: false }
  })()
  const hayAlgoQueGuardarYa = salidasListas.length > 0 || cambiosDias.length > 0 || cambiosFilas.length > 0
  const puedeGuardar = puedeEscribir && !guardando && !problemaDeLectura && hayCambiosParaGuardar
    && hayAlgoQueGuardarYa && !borradorSinSincronizar && !errorBorrador
  const textoBotonGuardar = guardando
    ? 'Guardando…'
    : filasConFalta.length && salidasListas.length
      ? `Guardar las ${salidasListas.length} completas`
      : 'Guardar programa'

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
    tocarBorrador({ dias: { ...diasBorrador, [dia.clave]: dias[dia.clave] !== undefined ? null : 'Asamblea regional' } })
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
    if (problemaDeLectura || cargandoRotacion || cargandoAgenda) {
      setError(problemaDeLectura
        ? `No se propone nada hasta que se pueda leer todo: ${problemaDeLectura}`
        : 'Esperá un momento: todavía se está leyendo la agenda.')
      return
    }
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

  const guardar = async (): Promise<boolean> => {
    if (!client || !puedeEscribir || !hayCambiosParaGuardar) return false
    if (problemaDeLectura) {
      setError(`No se guarda hasta que se pueda leer todo: ${problemaDeLectura}`)
      return false
    }
    if (borradorSinSincronizar || errorBorrador) {
      setError('Esperá a que se sincronice el borrador antes de guardar el programa.')
      return false
    }
    setError(null)
    setMensaje(null)
    if (scope === 'grupo' && !grupoId) {
      setError('Elegí el grupo de servicio antes de guardar.')
      return false
    }
    if (!hayAlgoQueGuardarYa) {
      setError('Ninguna salida está completa todavía: falta horario, conductor, territorio o punto de encuentro.')
      return false
    }
    const quedanSinCompletar = tildadas.length - salidasListas.length
    setGuardando(true)
    try {
      const payload = salidasListas.map((f) => {
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
        return false
      }
      const guardadas = new Set(salidasListas.map((f) => f.clave))
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
        for (const f of salidasListas.filter((fila) => fila.esExtra)) {
          siguientesExtras[f.fecha] = (siguientesExtras[f.fecha] ?? []).filter((extra) => extra.id !== f.extraId)
        }
        const siguienteOrden = { ...actual.orden }
        for (const fecha of diasSinSalidaGuardados) delete siguienteOrden[fecha]
        for (const f of salidasListas.filter((fila) => fila.esExtra)) {
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
        ? `${payload.length} ${payload.length === 1 ? 'salida guardada' : 'salidas guardadas'}.${quedanSinCompletar ? ` ${quedanSinCompletar === 1 ? 'Queda 1 sin completar' : `Quedan ${quedanSinCompletar} sin completar`}: siguen en el borrador.` : ''}`
        : 'Los días y turnos sin salida quedaron guardados para todos.')
      onGuardado()
      return true
    } catch (caught) {
      setError(
        decirElError(
          caught instanceof Error ? { message: caught.message } : (caught as { message?: string }),
          'No se pudieron guardar las salidas.',
        ),
      )
      return false
    } finally {
      setGuardando(false)
    }
  }

  const guardarRef = useRef(guardar)
  guardarRef.current = guardar
  const guardarEstable = useCallback(() => guardarRef.current(), [])
  const cuantasPendientes = tildadas.length
  useEffect(() => {
    alCambiarPendientes?.({ cuantas: cuantasPendientes, hayCambios: hayCambiosParaGuardar, puedeGuardar, guardar: guardarEstable })
  }, [alCambiarPendientes, cuantasPendientes, hayCambiosParaGuardar, puedeGuardar, guardarEstable])
  useEffect(() => () => alCambiarPendientes?.(null), [alCambiarPendientes])

  const guardarLaSemana = async () => {
    if (!client || !puedeEscribir || errorSemana) return
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

  const cerrarConfig = () => {
    if (configEditada && !window.confirm('Hay cambios de la semana sin guardar. Si cerrás, se pierden.')) return
    setConfigEditada(null)
    setConfigAbierta(false)
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
    if (hasta < hoyClave) {
      setError('Esa semana ya pasó. Elegí una desde hoy.')
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
    if (aClaveFecha(rango.hasta) < hoyClave) {
      setError('Esa semana ya pasó. Elegí el día de una visita que no haya pasado.')
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
    if (siguiente.hasta < hoyClave) {
      setError('Ese período ya pasó. Elegí fechas desde hoy.')
      return
    }
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
  const irALaFila = (clave: string) => {
    const fecha = clave.slice(0, 10)
    const indice = semanas.findIndex((semana) => fecha >= semana.desdeClave && fecha <= semana.hastaClave)
    if (indice >= 0) setSemanaMovil(indice)
    const lista = document.querySelector<HTMLElement>('.prog-movil')
    if (lista && lista.offsetParent !== null) {
      abrirHojaMovil({ tipo: 'fila', clave, paso: 'editar' })
      return
    }
    window.setTimeout(() => {
      const fila = [...document.querySelectorAll<HTMLElement>('[data-clave]')].find((el) => el.dataset.clave === clave)
      if (!fila) return
      fila.scrollIntoView({ block: 'center', behavior: 'smooth' })
      fila.classList.add('resaltada')
      window.setTimeout(() => fila.classList.remove('resaltada'), 2000)
      fila.querySelector<HTMLElement>('input, button')?.focus({ preventScroll: true })
    }, 0)
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

  const irALaSiguienteFalta = () => {
    const n = filasConFalta.length
    if (!n) return
    irALaFila(filasConFalta[indiceFalta % n]!.clave)
    setIndiceFalta(indiceFalta + 1)
  }
  const etiquetaVerCuales = filasConFalta.length === 1 ? 'Ver cuál'
    : indiceFalta === 0 ? 'Ver cuáles'
      : `Siguiente · ${(indiceFalta % filasConFalta.length) + 1} de ${filasConFalta.length}`
  /* Un solo renglón de estado, pegado al botón de guardar: dice qué falta
     (con número) o que está listo. El detalle vive en cada fila. */
  const lineaDeEstado = estadoDelGuardado.texto ? (
    <p className={estadoDelGuardado.falta ? 'prog-estado falta' : 'prog-estado'} role="status">
      {estadoDelGuardado.falta ? <Icono nombre="error" tamaño={16} /> : null}
      <span>{estadoDelGuardado.texto}</span>
      {estadoDelGuardado.falta ? (
        <>
          <span aria-hidden="true">·</span>
          <button type="button" className="prog-enlace" onClick={irALaSiguienteFalta}>{etiquetaVerCuales}</button>
        </>
      ) : null}
    </p>
  ) : null
  /* Lo de poco uso va junto, en un solo menú. */
  const menuMas = (
    <details className="menu-mas">
      <summary aria-label="Más opciones del programa">Más</summary>
      <div className="menu-mas-caja">
        {propuestaHecha ? (
          <>
            <button type="button" disabled={!puedeProponer} onClick={(e) => { cerrarElMenu(e); proponer(true) }}>Volver a proponer</button>
            <button type="button" onClick={(e) => { cerrarElMenu(e); deshacerPropuesta() }}>Deshacer la propuesta</button>
          </>
        ) : null}
        {guardadoEn ? <button type="button" onClick={(e) => { cerrarElMenu(e); descartar() }}>Descartar borrador</button> : null}
        <button type="button" onClick={(e) => { cerrarElMenu(e); setConfigAbierta(true) }}>
          La semana de siempre ({turnosDeLaSemana} turnos, {turnosConTitular} con titular)
        </button>
      </div>
    </details>
  )

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
          {lineaDeEstado}
          {menuMas}
          <button
            type="button"
            className="primary-button"
            onClick={() => void guardar()}
            disabled={!puedeGuardar}
          >
            <Icono nombre="guardar" tamaño={18} />
            {textoBotonGuardar}
          </button>
        </div>
      </div>

      <div className="prog-periodo">
        <button
          type="button"
          className="prog-m-periodo-toggle"
          aria-expanded={periodoMovilAbierto}
          onClick={() => setPeriodoMovilAbierto((abierto) => !abierto)}
        >
          <span>Período</span>
          <strong title={hayDiasPasadosEnElPeriodo ? 'Los días que ya pasaron no se programan: se arma desde hoy.' : undefined}>{PRESETS_PROGRAMA.find((p) => p.id === periodo.preset)?.etiqueta ?? 'Personalizado'} · {fechaCorta(desdeEfectivo)} – {fechaCorta(periodo.hasta)}{hayDiasPasadosEnElPeriodo ? ' (desde hoy)' : ''}</strong>
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
            {fraseDelRango(deClaveFecha(periodo.desde), deClaveFecha(periodo.hasta))}
          </span>
          <span className="prog-borrador">
            <span className="prog-punto-vivo" aria-hidden="true" />
            {estadoBorrador}
          </span>
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
      {problemaDeLectura ? (
        <div className="form-feedback error" role="alert">
          {problemaDeLectura}{' '}
          <button type="button" className="prog-enlace" onClick={() => setRecargarLecturas((n) => n + 1)}>Reintentar</button>
        </div>
      ) : null}
      {mensaje ? <div className="form-feedback success">{mensaje}</div> : null}

      {tildadas.length === 0 && !propuestaHecha ? (
        <div className="prog-invitacion">
          <div>
            <strong>Este período se puede armar solo</strong>
            <p>Propone por rotación y respeta los titulares. Nada se guarda hasta que apretés Guardar.</p>
          </div>
          <button
            type="button"
            className="prog-boton-propuesta"
            onClick={() => proponer()}
            disabled={!puedeProponer}
          >
            ✦ Proponer el programa
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
          <span className="prog-m-borrador">{estadoBorrador}</span>
        </div>
        {propuestaHecha ? (
          <div className="prog-m-propuesta">
            <button type="button" className="prog-enlace" onClick={() => proponer(true)} disabled={!puedeProponer}>Volver a proponer</button>
            <button type="button" className="prog-enlace" onClick={deshacerPropuesta}>Deshacer</button>
          </div>
        ) : null}
        <div className="prog-m-dias" role="tabpanel">
          {diasVisibles.map((dia) => {
            const salidasDelDia = filasDelPeriodo.filter((fila) => fila.fecha === dia.clave)
            const agendaDelDia = salidasEnAgenda.filter((salida) => aClaveFecha(new Date(salida.scheduled_for)) === dia.clave)
            const vivas = salidasDelDia.filter((fila) => !filaDe(fila).sinSalida).length
            const asamblea = dias[dia.clave]
            const diaMarcado = asamblea !== undefined
            return (
              <section key={dia.clave} className="prog-m-dia" aria-label={`${NOMBRE_DIA[dia.dow]} ${Number(dia.clave.slice(8))}`}>
                <header className="prog-m-dia-cab">
                  <h4>{esHoy(dia.clave) ? 'Hoy · ' : ''}{NOMBRE_DIA[dia.dow].charAt(0).toUpperCase() + NOMBRE_DIA[dia.dow].slice(1)} {Number(dia.clave.slice(8))}</h4>
                  <span>{diaMarcado ? '' : salidasDelDia.length ? `${vivas} de ${salidasDelDia.length}` : agendaDelDia.length ? `${agendaDelDia.length} en la agenda` : 'Sin salidas'}</span>
                  <button type="button" aria-label={`Opciones del ${NOMBRE_DIA[dia.dow]} ${Number(dia.clave.slice(8))}`} onClick={() => abrirHojaMovil({ tipo: 'dia', clave: dia.clave })}>⋯</button>
                </header>
                {diaMarcado ? (
                  <div className="prog-m-asamblea">
                    <span className="prog-m-chip aviso">Sin salidas</span>
                    <strong>{asamblea || 'Sin motivo'}</strong>
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
        {lineaDeEstado}
        <div className="prog-m-barra">
          <button type="button" className="prog-m-proponer" onClick={() => proponer()} disabled={!puedeProponer}>✦ {tildadas.length ? 'Completar' : 'Proponer'}</button>
          <button type="button" className="primary-button" onClick={() => void guardar()} disabled={!puedeGuardar}>{guardando ? 'Guardando…' : filasConFalta.length && salidasListas.length ? `Guardar ${salidasListas.length}` : 'Guardar'}</button>
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
                const diaMarcado = asamblea !== undefined
                return (
                  <div key={dia.clave} className="prog-dia">
                    <div className="prog-dia-cab">
                      <strong>
                        {esHoy(dia.clave) ? 'Hoy · ' : ''}
                        {NOMBRE_DIA[dia.dow].charAt(0).toUpperCase() + NOMBRE_DIA[dia.dow].slice(1)}{' '}
                        {Number(dia.clave.slice(8))}
                      </strong>
                      <details className="menu-mas">
                        <summary aria-label={`Opciones del ${NOMBRE_DIA[dia.dow]}`}>Día</summary>
                        <div className="menu-mas-caja">
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
                            {diaMarcado ? 'Quitar el motivo' : 'Marcar asamblea u otro motivo'}
                          </button>
                        </div>
                      </details>
                    </div>

                    {diaMarcado ? (
                      <div className="prog-banda">
                        <span className="prog-pastilla aviso">Sin salidas</span>
                        <input
                          className="prog-banda-nota"
                          value={asamblea ?? ''}
                          placeholder="Motivo (por ejemplo, asamblea regional)"
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
                        <span className="prog-rotacion">Podés agregar una desde «Día».</span>
                      </div>
                    ) : (
                      deLaFecha.map((filaDelPrograma, indiceEnElDia) => {
                        const clave = filaDelPrograma.clave
                        const fila = filaDe(filaDelPrograma)
                        /* Lo que ya se guardó en la agenda se ve como guardado,
                           no como una fila vacía que parece perdida. */
                        if (!fila.tildada && !fila.sinSalida) {
                          const indiceDelTurno = deLaFecha.slice(0, indiceEnElDia).filter((anterior) =>
                            anterior.turno === filaDelPrograma.turno && !filaDe(anterior).tildada && !filaDe(anterior).sinSalida,
                          ).length
                          const guardada = salidasEnAgenda
                            .filter((salida) => aClaveFecha(new Date(salida.scheduled_for)) === dia.clave
                              && turnoEnAgenda(salida) === filaDelPrograma.turno)[indiceDelTurno]
                          if (guardada) {
                            const territorioGuardado = territorios.find((t) => t.id === guardada.territory_id)
                            const conductorGuardado = conductores.find((c) => c.id === guardada.driver_id)
                            const hora = new Intl.DateTimeFormat('es-AR', { hour: '2-digit', minute: '2-digit', hour12: false })
                              .format(new Date(guardada.scheduled_for))
                            return (
                              <div key={clave} className="prog-fila sin-salida" data-clave={clave}>
                                <span className="prog-pastilla bien">En la agenda</span>
                                <span className="prog-rotacion">
                                  {hora} · {territorioGuardado ? `Territorio ${territorioGuardado.name}`
                                    : filaDelPrograma.turno === 'telefono' ? 'Predicación telefónica'
                                      : filaDelPrograma.turno === 'grupos' ? 'Salidas de Grupos' : 'Salida'}
                                  {[guardada.meeting_point_name, conductorGuardado?.full_name].filter(Boolean).length
                                    ? ` · ${[guardada.meeting_point_name, conductorGuardado?.full_name].filter(Boolean).join(' · ')}` : ''}
                                </span>
                              </div>
                            )
                          }
                        }
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
                                    <Icono nombre="error" tamaño={14} />
                                    {aviso.texto}
                                    {aviso.ir ? <Link to={aviso.ir} className="prog-enlace">{aviso.irTexto}</Link> : null}
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
              <button type="button" className="prog-m-hoja-icono cerrar" data-hoja-cerrar aria-label="Cerrar" onClick={cerrarHojaMovil}><Icono nombre="cerrar" tamaño={20} /></button>
            </header>
            {hojaMovil.tipo === 'dia' && diaAbierto ? (
              <div className="prog-m-hoja-cuerpo">
                <p className="prog-m-hoja-nota">Los cambios de este día quedan en el borrador hasta que guardes el programa.</p>
                <div className="prog-m-hoja-campos">
                  {(['manana', 'tarde', 'telefono'] as const).map((turno) => (
                    <button key={turno} type="button" onClick={() => {
                      agregarExtra(null, diaAbierto, turno)
                      cerrarHojaMovil()
                    }}>Agregar salida {turno === 'telefono' ? 'por teléfono' : `a la ${NOMBRE_TURNO[turno]}`} <Icono nombre="agregar" tamaño={18} /></button>
                  ))}
                  <button type="button" onClick={() => {
                    marcarSinSalidaElDia(null, diaAbierto)
                    cerrarHojaMovil()
                  }}>Sin salida ese día <span aria-hidden="true">›</span></button>
                  <button type="button" onClick={() => {
                    alternarAsamblea(null, diaAbierto)
                    cerrarHojaMovil()
                  }}>{dias[diaAbierto.clave] !== undefined ? 'Quitar la asamblea' : 'Asamblea regional'} <span aria-hidden="true">›</span></button>
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
                          <span className="prog-m-incluir-marca" aria-hidden="true">{datoAbierto.tildada ? <Icono nombre="tilde" tamaño={16} /> : null}</span>
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
                          <button type="button" onClick={() => moverUnLugar(filaAbierta, -1)} disabled={filasDelPeriodo.filter((f) => f.fecha === filaAbierta.fecha)[0]?.clave === filaAbierta.clave}><Icono nombre="subir" tamaño={18} /> Subir</button>
                          <button type="button" onClick={() => moverUnLugar(filaAbierta, 1)} disabled={filasDelPeriodo.filter((f) => f.fecha === filaAbierta.fecha).at(-1)?.clave === filaAbierta.clave}><Icono nombre="bajar" tamaño={18} /> Bajar</button>
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
                      </div> : <p className="prog-m-hoja-nota">Este territorio todavía no tiene puntos. <Link to="/mapas">Cargar un punto en Mapas y Territorios</Link></p>}</>
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
            if (e.target === e.currentTarget) cerrarConfig()
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
                onClick={cerrarConfig}
                aria-label="Cerrar"
              >
                <Icono nombre="cerrar" tamaño={18} />
              </button>
            </header>
            <div className="prog-cajon-cuerpo">
              {errorSemana ? (
                <div className="form-feedback error" role="alert">
                  {errorSemana} No se puede guardar la semana hasta que se pueda leer la real.{' '}
                  <button type="button" className="prog-enlace" onClick={() => setRecargarLecturas((n) => n + 1)}>Reintentar</button>
                </div>
              ) : null}
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
                }}><Icono nombre="agregar" tamaño={18} /> Agregar día de teléfono</button>

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
                {errorSemana ? 'No se pudo leer la semana guardada.' : configSemana
                  ? 'La semana está guardada en la base: lo que cambies acá vale para todos, en todas las pantallas.'
                  : 'La semana todavía vive en el código. Guardala acá y va a pasar a la base, donde vale para todos.'}
              </p>
            </div>
            <footer className="prog-cajon-pie">
              <button
                type="button"
                className="secondary-button"
                onClick={cerrarConfig}
              >
                Cerrar
              </button>
              <button
                type="button"
                className="primary-button"
                onClick={() => void guardarLaSemana()}
                disabled={!puedeEscribir || guardandoSemana || Boolean(errorSemana)}
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
