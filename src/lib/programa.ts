/**
 * El programa semanal: la semana de siempre y el motor que propone.
 *
 * Acá viven dos cosas, y las dos son puras: no saben de React ni de Supabase.
 *
 *   1. La semana de siempre. Los horarios, los titulares y los días de
 *      predicación telefónica no se eligen fila por fila: son de la
 *      congregación y valen todas las semanas. Lo que se toca en una fila es
 *      la excepción: el feriado, la asamblea, esa semana rara.
 *   2. El motor. Dado un período, propone qué territorio toca cada día y
 *      turno, con quién y a qué hora, y dice por qué. Nada se guarda: la
 *      propuesta es una propuesta y el que decide es quien arma el programa.
 *
 * Las reglas no son inventadas: salen de mirar cómo trabaja la congregación.
 * Por eso cada una tiene su comentario con el motivo, y su test.
 */

export type Turno = 'manana' | 'tarde' | 'telefono' | 'grupos'

/** Los nombres que ya usa la disponibilidad de los conductores. */
export type TurnoDisponible = 'manana' | 'tarde' | 'telefonica'

export type ConfigSemana = {
  /** '3-tarde' → '15:30'. Si el turno no está, ese día y turno no se sale. */
  horarios: Record<string, string>
  /** '2-manana' → [conductor]. Con dos, alternan una semana cada uno. */
  titulares: Record<string, string[]>
  /** Los días de predicación telefónica, con su hora. */
  telefono: Array<{ dow: number; hora: string }>
  /**
   * Los días de "Salidas de Grupos", con su hora. No se planifican acá: cada
   * grupo sale por su lado y no llevan territorio ni conductor propios. Están
   * en la semana para que la fila exista y nadie la pise con una salida común.
   */
  grupos: Array<{ dow: number; hora: string }>
}

/**
 * La semana de la congregación, la que está en el programa de papel de
 * septiembre de 2026 y que la base de DEV confirma salida por salida:
 *
 *   lunes     09:30 y 17:00, teléfono 19:30
 *   martes    09:30 y 17:00, teléfono 19:30
 *   miércoles 09:30 y 17:00
 *   jueves    no se sale
 *   viernes   09:30 y 17:00
 *   sábado    Salidas de Grupos 10:00 y 17:00
 *   domingo   no se sale
 *
 * Los titulares no están acá porque dependen de la tabla de conductores de
 * cada base: se resuelven por nombre con `configDeLaCongregacion`.
 */
export const CONFIG_POR_DEFECTO: ConfigSemana = {
  horarios: {
    '1-manana': '09:30',
    '1-tarde': '17:00',
    '2-manana': '09:30',
    '2-tarde': '17:00',
    '3-manana': '09:30',
    '3-tarde': '17:00',
    '5-manana': '09:30',
    '5-tarde': '17:00',
    '6-tarde': '17:00',
  },
  titulares: {},
  telefono: [
    { dow: 1, hora: '19:30' },
    { dow: 2, hora: '19:30' },
  ],
  grupos: [{ dow: 6, hora: '10:00' }],
}

/**
 * Los titulares de cada turno, como los nombra la congregación. Con uno es
 * siempre el mismo; con dos, alternan una semana cada uno.
 *
 * Se guardan por nombre a propósito: los identificadores de `conductores`
 * cambian entre la base de desarrollo y la de producción, y esto tiene que
 * valer en las dos. `configDeLaCongregacion` los resuelve al cargar.
 */
export const TITULARES_POR_NOMBRE: Record<string, string[]> = {
  '1-manana': ['Pablo Ramirez'],
  '1-tarde': ['Miguel Perez'],
  '1-telefono': ['Hugo Quiroga'],
  '2-manana': ['Miguel Canario', 'Francisco Criado'],
  '2-tarde': ['Ariel Riveros', 'Fernando Pozo'],
  '2-telefono': ['Hugo Quiroga'],
  '3-manana': ['Gabriel Sosa'],
  '3-tarde': ['Mario Campillay'],
  '5-manana': ['Jose Caballero'],
  '5-tarde': ['Duilio Riveros', 'Daniel Marquez'],
  '6-tarde': ['Javier Salazar', 'Ariel Riveros'],
}

export const NOMBRE_TURNO: Record<Turno, string> = {
  manana: 'mañana',
  tarde: 'tarde',
  telefono: 'teléfono',
  grupos: 'grupos',
}

export const NOMBRE_DIA = [
  'domingo',
  'lunes',
  'martes',
  'miércoles',
  'jueves',
  'viernes',
  'sábado',
]

export function claveTurno(dow: number, turno: Turno): string {
  return `${dow}-${turno}`
}

/** Con qué turno de la disponibilidad se pide un conductor. `grupos` no lleva. */
export function turnoParaDisponibilidad(turno: Turno): TurnoDisponible | null {
  if (turno === 'grupos') return null
  return turno === 'telefono' ? 'telefonica' : turno
}

/**
 * La semana de la congregación con los titulares ya resueltos contra la tabla
 * de conductores. Un nombre que no exista se saltea sin romper nada: la lista
 * de nombres es de la congregación y la tabla es de cada base.
 */
export function configDeLaCongregacion(
  conductores: Array<{ id: string; full_name: string }>,
  base: ConfigSemana = CONFIG_POR_DEFECTO,
): ConfigSemana {
  const porNombre = new Map(conductores.map((c) => [c.full_name, c.id]))
  const titulares: Record<string, string[]> = {}
  for (const [clave, nombres] of Object.entries(TITULARES_POR_NOMBRE)) {
    const ids = nombres
      .map((nombre) => porNombre.get(nombre))
      .filter((id): id is string => Boolean(id))
    if (ids.length > 0) titulares[clave] = ids
  }
  return { ...base, titulares }
}

/** El horario de siempre. Sin horario para ese día y turno, ese turno no existe. */
export function horaHabitual(
  config: ConfigSemana,
  dow: number,
  turno: Turno,
): string | null {
  if (turno === 'telefono') {
    return config.telefono.find((dia) => dia.dow === dow)?.hora ?? null
  }
  if (turno === 'grupos') {
    return config.grupos.find((dia) => dia.dow === dow)?.hora ?? null
  }
  return config.horarios[claveTurno(dow, turno)] ?? null
}

/** Los turnos que existen ese día, en el orden del reloj. */
export function turnosDelDia(config: ConfigSemana, dow: number): Turno[] {
  const turnos: Array<{ turno: Turno; hora: string }> = []
  for (const turno of ['manana', 'tarde'] as const) {
    const hora = config.horarios[claveTurno(dow, turno)]
    if (hora) turnos.push({ turno, hora })
  }
  const telefono = config.telefono.find((dia) => dia.dow === dow)
  if (telefono) turnos.push({ turno: 'telefono', hora: telefono.hora })
  const grupos = config.grupos.find((dia) => dia.dow === dow)
  if (grupos) turnos.push({ turno: 'grupos', hora: grupos.hora })
  /* El orden lo manda la hora y no la lista: el sábado, "Salidas de Grupos"
     va antes que la salida de la tarde. */
  return turnos.sort((a, b) => a.hora.localeCompare(b.hora)).map((t) => t.turno)
}

/**
 * Número de semana ISO.
 *
 * La alternancia de titulares se cuelga de este número y no del rango que se
 * esté armando: si alguien mueve las fechas del programa, quién conduce la
 * semana 40 no cambia.
 */
export function semanaIso(fecha: Date): number {
  /* El jueves de esa semana decide a qué año y a qué semana pertenece: es la
     definición de la norma. Se calcula en UTC para que un cambio de horario no
     corra un día. */
  const dia = new Date(Date.UTC(fecha.getFullYear(), fecha.getMonth(), fecha.getDate()))
  const diaSemana = dia.getUTCDay() || 7
  dia.setUTCDate(dia.getUTCDate() + 4 - diaSemana)
  const primeroDeAnio = Date.UTC(dia.getUTCFullYear(), 0, 1)
  return Math.ceil(((dia.getTime() - primeroDeAnio) / 86_400_000 + 1) / 7)
}

export type TitularDeLaSemana = {
  id: string
  /** 1 de 2, 2 de 2. */
  posicion: number
  total: number
  lista: string[]
}

/**
 * A quién le toca ese turno esta semana.
 *
 * Con un titular es siempre el mismo. Con dos (o más) alternan una semana
 * cada uno, y el orden de la lista es el orden de la rotación.
 */
export function titularDeLaSemana(
  config: ConfigSemana,
  dow: number,
  turno: Turno,
  fecha: Date,
): TitularDeLaSemana | null {
  const lista = config.titulares[claveTurno(dow, turno)] ?? []
  if (lista.length === 0) return null
  const posicion = semanaIso(fecha) % lista.length
  return { id: lista[posicion], posicion: posicion + 1, total: lista.length, lista }
}

/* ------------------------------- el motor ------------------------------- */

export type PuntoDelTerritorio = {
  id: string
  /** El código visible: 61.2. */
  codigo: string
  /** La esquina o el lugar: "Zaballa y Talcahuano". */
  nombre: string
  lat: number | null
  lng: number | null
}

export type TerritorioParaProponer = {
  id: string
  nombre: string
  /** Días desde la última salida. null = nunca se programó. */
  diasSinTrabajar: number | null
  /** El turno de esa última salida, para alternar. */
  ultimoTurno: 'manana' | 'tarde' | null
  /** En el orden en que se rotan. */
  puntos: PuntoDelTerritorio[]
}

export type ConductorParaProponer = {
  id: string
  nombre: string
  /** Días de la semana en que puede (0 = domingo). */
  dias: number[]
  /** Turnos en que puede. */
  turnos: TurnoDisponible[]
  /**
   * La disponibilidad fina, cuando la ficha la tiene: qué turnos puede cada
   * día de la semana. Si está, manda sobre `dias` y `turnos`.
   */
  porDia?: Record<number, TurnoDisponible[]>
  /** Salidas en los últimos 60 días: para repartir, no para castigar. */
  carga: number
}

export type SalidaGuardada = {
  fecha: string
  turno: Turno
  territorioId: string | null
  conductorId: string | null
}

export type FilaDelPeriodo = {
  /** 'YYYY-MM-DD', en hora local. */
  fecha: string
  dow: number
  turno: Turno
  /** Una fila agregada a mano para una segunda salida del mismo día y turno. */
  esExtra?: boolean
  /** Identidad estable de cada fila extra, incluso si comparte turno. */
  extraId?: string
}

export type Propuesta = {
  clave: string
  fecha: string
  turno: Turno
  territorioId: string | null
  puntoId: string | null
  conductorId: string | null
  hora: string
  /** El porqué, listo para mostrar debajo de la fila. */
  motivo: string
}

export type EntradaDelMotor = {
  filas: FilaDelPeriodo[]
  config: ConfigSemana
  territorios: TerritorioParaProponer[]
  conductores: ConductorParaProponer[]
  /** Lo que ya está guardado en el período: no se pisa ni se repite. */
  agenda: SalidaGuardada[]
  /** Filas que se sacaron a mano: 'YYYY-MM-DD-turno'. */
  sinSalida?: Iterable<string>
  /** Filas que ya tienen territorio, cuando soloVacias. */
  yaArmadas?: Iterable<string>
  /** No pisar lo ya armado: llenar solo lo que falta. */
  soloVacias?: boolean
}

export function claveFila(fecha: string, turno: Turno): string {
  return `${fecha}-${turno}`
}

/**
 * La clave de una fila del período. Una fila agregada a mano para una segunda
 * salida del mismo día y turno no puede compartir clave con la de siempre: si
 * no, sacar una sacaría la otra.
 */
export function claveDeFila(fila: FilaDelPeriodo): string {
  return claveFila(fila.fecha, fila.turno) + (fila.esExtra
    ? `-extra${fila.extraId && fila.extraId !== 'legacy' ? `-${fila.extraId}` : ''}`
    : '')
}

/** El turno que le toca: el opuesto al de la última vez. */
function turnoSugerido(
  territorio: TerritorioParaProponer,
  conteo: { manana: number; tarde: number },
): 'manana' | 'tarde' {
  if (territorio.ultimoTurno === 'manana') return 'tarde'
  if (territorio.ultimoTurno === 'tarde') return 'manana'
  return conteo.manana <= conteo.tarde ? 'manana' : 'tarde'
}

/** El primer punto con ubicación cargada; si ninguno la tiene, el primero. */
function puntoSugerido(territorio: TerritorioParaProponer): PuntoDelTerritorio | null {
  if (territorio.puntos.length === 0) return null
  return territorio.puntos.find((p) => p.lat !== null && p.lng !== null) ?? territorio.puntos[0]
}

/**
 * Llena un período con la propuesta del programa.
 *
 * No escribe nada: devuelve una lista y el que arma decide qué queda. Respeta,
 * en este orden, el día con asamblea (el que llama no manda esas filas), la
 * fila sacada a mano, lo que ya está en la agenda y lo que ya está armado
 * cuando se pide llenar solo lo que falta.
 */
export function proponerPrograma(entrada: EntradaDelMotor): Propuesta[] {
  const { filas, config, territorios, conductores, agenda } = entrada
  const sinSalida = new Set(entrada.sinSalida ?? [])
  const yaArmadas = new Set(entrada.yaArmadas ?? [])
  const conductoresPorId = new Map(conductores.map((c) => [c.id, c]))

  /* Un conductor no puede estar en dos salidas del mismo día, y lo que ya está
     guardado ocupa igual que lo que se está proponiendo. */
  const ocupados = new Set(
    agenda.filter((s) => s.conductorId).map((s) => `${s.fecha}|${s.conductorId}`),
  )
  /* Un territorio tampoco se repite: ni dentro de la propuesta, ni con lo que
     ya está en la agenda de ese período. */
  const territoriosUsados = new Set(
    agenda.map((s) => s.territorioId).filter((id): id is string => Boolean(id)),
  )
  const carga = new Map(conductores.map((c) => [c.id, c.carga]))

  /* El que hace más que no se trabaja va primero; el que nunca se programó,
     más todavía. */
  const cola = [...territorios].sort(
    (a, b) => (b.diasSinTrabajar ?? 99_999) - (a.diasSinTrabajar ?? 99_999),
  )

  const conteo = { manana: 0, tarde: 0 }
  const propuestas: Propuesta[] = []

  const tomarConductor = (fecha: string, dow: number, turno: Turno) => {
    const titular = titularDeLaSemana(config, dow, turno, new Date(`${fecha}T12:00:00`))
    if (titular) {
      /* Primero el que le toca esta semana; si esa persona ya conduce ese día,
         el otro titular de la regla. Si ninguno puede, la fila queda sin
         conductor y el motivo lo dice: no se inventa a nadie. */
      const orden = [
        ...titular.lista.slice(titular.posicion - 1),
        ...titular.lista.slice(0, titular.posicion - 1),
      ]
      for (const id of orden) {
        const conductor = conductoresPorId.get(id)
        if (conductor && !ocupados.has(`${fecha}|${id}`)) {
          ocupados.add(`${fecha}|${id}`)
          carga.set(id, (carga.get(id) ?? 0) + 1)
          return {
            conductorId: id,
            nota:
              titular.total > 1
                ? `le toca a ${conductor.nombre} esta semana`
                : `${conductor.nombre} es el titular de ese turno`,
          }
        }
      }
      return { conductorId: null, nota: 'los titulares de ese turno ya conducen ese día' }
    }

    const disponible = turnoParaDisponibilidad(turno)
    /* "Salidas de Grupos" no lleva conductor propio: cada grupo sale por su
       lado y lo coordina su superintendente. */
    if (!disponible) return { conductorId: null, nota: '' }
    const libres = conductores.filter((c) => {
      const delDia = c.porDia?.[dow]
      const puedeEseDia = delDia ? delDia.includes(disponible) : c.dias.includes(dow) && c.turnos.includes(disponible)
      return puedeEseDia && !ocupados.has(`${fecha}|${c.id}`)
    })
    if (libres.length === 0) {
      return { conductorId: null, nota: 'no hay conductor disponible ese día y turno' }
    }
    /* Equidad: primero quien menos salidas lleva en los últimos 60 días. */
    const elegido = [...libres].sort(
      (a, b) =>
        (carga.get(a.id) ?? 0) - (carga.get(b.id) ?? 0) || a.nombre.localeCompare(b.nombre),
    )[0]
    ocupados.add(`${fecha}|${elegido.id}`)
    carga.set(elegido.id, (carga.get(elegido.id) ?? 0) + 1)
    return { conductorId: elegido.id, nota: '' }
  }

  for (const fila of filas) {
    const clave = claveDeFila(fila)
    if (sinSalida.has(clave)) continue
    /* Las salidas de grupos no se proponen: no hay territorio ni conductor que
       elegir, y cada grupo las coordina aparte. La fila existe para que nadie
       la pise con una salida común. */
    if (fila.turno === 'grupos') continue
    if (entrada.soloVacias && yaArmadas.has(clave)) continue
    /* Lo que ya está en la agenda no se vuelve a proponer, salvo que la fila se
       haya agregado a mano justamente para una segunda salida. */
    const yaHay = agenda.some((s) => s.fecha === fila.fecha && s.turno === fila.turno)
    if (yaHay && !fila.esExtra) continue

    const hora = horaHabitual(config, fila.dow, fila.turno) ?? ''

    if (fila.turno === 'telefono') {
      const { conductorId, nota } = tomarConductor(fila.fecha, fila.dow, 'telefono')
      const porque = [`Predicación telefónica del ${NOMBRE_DIA[fila.dow]}`]
      if (nota) porque.push(nota)
      propuestas.push({
        clave,
        fecha: fila.fecha,
        turno: 'telefono',
        territorioId: null,
        puntoId: null,
        conductorId,
        hora,
        motivo: porque.join(' · ') + '.',
      })
      continue
    }

    /* Primero uno que además quiera el turno que le toca; si no queda ninguno
       con ese turno, entra el que haya. */
    const candidato =
      cola.find((t) => !territoriosUsados.has(t.id) && turnoSugerido(t, conteo) === fila.turno) ??
      cola.find((t) => !territoriosUsados.has(t.id))
    if (!candidato) continue
    territoriosUsados.add(candidato.id)

    const punto = puntoSugerido(candidato)
    const { conductorId, nota } = tomarConductor(fila.fecha, fila.dow, fila.turno)

    const porque: string[] = []
    porque.push(
      candidato.diasSinTrabajar === null
        ? 'Nunca se programó'
        : `Hace ${candidato.diasSinTrabajar} días`,
    )
    if (candidato.ultimoTurno) {
      porque.push(
        `la última fue de ${NOMBRE_TURNO[candidato.ultimoTurno]}, alterna a ${NOMBRE_TURNO[fila.turno]}`,
      )
    }
    porque.push(punto ? `sale de ${punto.nombre}` : 'no tiene punto de encuentro cargado')
    if (nota) porque.push(nota)

    propuestas.push({
      clave,
      fecha: fila.fecha,
      turno: fila.turno,
      territorioId: candidato.id,
      puntoId: punto?.id ?? null,
      conductorId,
      hora,
      motivo: 'Propuesta: ' + porque.join(' · ') + '.',
    })
    conteo[fila.turno] += 1
  }

  return propuestas
}
