import test from 'node:test'
import assert from 'node:assert/strict'
import {
  CONFIG_POR_DEFECTO,
  TITULARES_POR_NOMBRE,
  claveFila,
  claveDeFila,
  configDeLaCongregacion,
  horaHabitual,
  proponerPrograma,
  semanaIso,
  titularDeLaSemana,
  turnosDelDia,
} from '../src/lib/programa.ts'

/* Fechas de septiembre de 2026, que es cuando se escribió esto.
   22 = martes, 23 = miércoles, 24 = jueves, 25 = viernes, 26 = sábado,
   27 = domingo. */
const martes = (d = 22) => new Date(2026, 8, d, 12, 0)

const territorio = (id, nombre, diasSinTrabajar, ultimoTurno = null, puntos = []) => ({
  id,
  nombre,
  diasSinTrabajar,
  ultimoTurno,
  puntos,
})
const punto = (id, nombre, lat = -31.5, lng = -68.5) => ({ id, codigo: id, nombre, lat, lng })
const conductor = (id, nombre, dias, turnos, carga = 0) => ({ id, nombre, dias, turnos, carga })
const fila = (fecha, dow, turno, esExtra = false) => ({ fecha, dow, turno, esExtra })

test('dos salidas extra del mismo turno conservan claves distintas', () => {
  const base = { fecha: '2026-09-25', dow: 5, turno: 'manana', esExtra: true }
  assert.notEqual(claveDeFila({ ...base, extraId: 'a' }), claveDeFila({ ...base, extraId: 'b' }))
  assert.equal(claveDeFila({ ...base, extraId: 'legacy' }), '2026-09-25-manana-extra')
})

const CONDUCTORES = [
  conductor('c1', 'Ariel Riveros', [2, 4, 6], ['manana'], 3),
  conductor('c2', 'Yolanda Ruiz', [3, 5, 6], ['manana', 'tarde'], 1),
  conductor('c3', 'Daniel Sarmiento', [1, 2, 4], ['manana'], 0),
]

/* ------------------------- la semana de siempre ------------------------- */

test('un día sin horario no tiene turnos, y el día de teléfono aparece', () => {
  // Con la semana por defecto el domingo no se sale: no hay filas que mostrar.
  assert.deepEqual(turnosDelDia(CONFIG_POR_DEFECTO, 0), [])
  // El jueves tampoco: la semana real no sale los jueves.
  assert.deepEqual(turnosDelDia(CONFIG_POR_DEFECTO, 4), [])
  // El martes tiene mañana, tarde y teléfono, en el orden del reloj.
  assert.deepEqual(turnosDelDia(CONFIG_POR_DEFECTO, 2), ['manana', 'tarde', 'telefono'])
  // El sábado, las salidas de grupos a las 10 van antes que la salida de la tarde.
  assert.deepEqual(turnosDelDia(CONFIG_POR_DEFECTO, 6), ['grupos', 'tarde'])
})

test('el horario de siempre sale de la configuración, no de la fila', () => {
  assert.equal(horaHabitual(CONFIG_POR_DEFECTO, 3, 'manana'), '09:30')
  assert.equal(horaHabitual(CONFIG_POR_DEFECTO, 2, 'telefono'), '19:30')
  assert.equal(horaHabitual(CONFIG_POR_DEFECTO, 6, 'grupos'), '10:00')
  // El domingo a la mañana no hay horario: ese turno no existe.
  assert.equal(horaHabitual(CONFIG_POR_DEFECTO, 0, 'manana'), null)
})

test('los titulares de la congregación se resuelven por nombre', () => {
  const conductores = [
    { id: 'id-pablo', full_name: 'Pablo Ramirez' },
    { id: 'id-miguel', full_name: 'Miguel Perez' },
  ]
  const config = configDeLaCongregacion(conductores)
  assert.deepEqual(config.titulares['1-manana'], ['id-pablo'])
  assert.deepEqual(config.titulares['1-tarde'], ['id-miguel'])
  // Un turno cuyos titulares no están en la tabla no queda a medias: no queda.
  assert.equal(config.titulares['2-manana'], undefined)
  // Y los horarios de la semana real no se pierden en el camino.
  assert.equal(config.horarios['1-manana'], '09:30')
})

test('la semana real tiene once turnos con titular y ninguno se repite de más', () => {
  const claves = Object.keys(TITULARES_POR_NOMBRE)
  assert.equal(claves.length, 11)
  for (const [clave, nombres] of Object.entries(TITULARES_POR_NOMBRE)) {
    assert.ok(nombres.length === 1 || nombres.length === 2, `${clave} debería tener uno o dos titulares`)
  }
  // El teléfono lo lleva la misma persona los dos días que se sale.
  assert.deepEqual(TITULARES_POR_NOMBRE['1-telefono'], ['Hugo Quiroga'])
  assert.deepEqual(TITULARES_POR_NOMBRE['2-telefono'], ['Hugo Quiroga'])
})

test('la semana ISO no depende del día que se mire', () => {
  const semana = semanaIso(martes())
  for (const dia of [22, 23, 24, 25, 26, 27]) {
    assert.equal(semanaIso(new Date(2026, 8, dia, 12, 0)), semana)
  }
  assert.equal(semanaIso(new Date(2026, 8, 29, 12, 0)), semana + 1)
})

test('con un titular solo, conduce siempre el mismo', () => {
  const config = { ...CONFIG_POR_DEFECTO, titulares: { '4-manana': ['c3'] } }
  for (const dia of [24, 1, 8, 15]) {
    const fecha = dia > 20 ? new Date(2026, 8, dia) : new Date(2026, 9, dia)
    assert.equal(titularDeLaSemana(config, 4, 'manana', fecha)?.id, 'c3')
  }
})

test('con dos titulares alternan, y la misma semana da siempre el mismo', () => {
  const config = { ...CONFIG_POR_DEFECTO, titulares: { '2-manana': ['c1', 'c3'] } }
  const deEstaSemana = titularDeLaSemana(config, 2, 'manana', martes())
  const otroDiaDeLaMismaSemana = titularDeLaSemana(config, 2, 'manana', new Date(2026, 8, 23))
  const laQueViene = titularDeLaSemana(config, 2, 'manana', new Date(2026, 8, 29))

  assert.equal(deEstaSemana?.total, 2)
  assert.equal(deEstaSemana?.id, otroDiaDeLaMismaSemana?.id)
  assert.notEqual(deEstaSemana?.id, laQueViene?.id)
})

/* ------------------------------- el motor ------------------------------- */

test('no repite un territorio dentro de la misma propuesta', () => {
  const propuestas = proponerPrograma({
    filas: [fila('2026-09-22', 2, 'manana'), fila('2026-09-23', 3, 'manana'), fila('2026-09-24', 4, 'manana')],
    config: CONFIG_POR_DEFECTO,
    territorios: [territorio('t1', '61', 90), territorio('t2', '57', 60), territorio('t3', '30', 30)],
    conductores: CONDUCTORES,
    agenda: [],
  })
  const territorios = propuestas.map((p) => p.territorioId)
  assert.equal(new Set(territorios).size, territorios.length)
})

test('el que nunca se programó va primero y el más viejo después', () => {
  const propuestas = proponerPrograma({
    filas: [fila('2026-09-22', 2, 'manana'), fila('2026-09-23', 3, 'manana')],
    config: CONFIG_POR_DEFECTO,
    territorios: [territorio('t1', '61', 30), territorio('t2', '30', null), territorio('t3', '57', 90)],
    conductores: CONDUCTORES,
    agenda: [],
  })
  assert.deepEqual(propuestas.map((p) => p.territorioId), ['t2', 't3'])
  assert.match(propuestas[0].motivo, /Nunca se programó/)
  assert.match(propuestas[1].motivo, /Hace 90 días/)
})

test('no propone un territorio que ya está en la agenda del período', () => {
  const propuestas = proponerPrograma({
    filas: [fila('2026-09-22', 2, 'manana'), fila('2026-09-23', 3, 'manana')],
    config: CONFIG_POR_DEFECTO,
    territorios: [territorio('t1', '61', 200), territorio('t2', '57', 90)],
    conductores: CONDUCTORES,
    agenda: [{ fecha: '2026-09-22', turno: 'manana', territorioId: 't1', conductorId: null }],
  })
  assert.deepEqual(propuestas.map((p) => p.territorioId), ['t2'])
})

test('no propone una fila que ya está en la agenda, salvo que sea una fila agregada', () => {
  const agenda = [{ fecha: '2026-09-22', turno: 'manana', territorioId: 't9', conductorId: null }]
  const comun = proponerPrograma({
    filas: [fila('2026-09-22', 2, 'manana')],
    config: CONFIG_POR_DEFECTO,
    territorios: [territorio('t1', '61', 90)],
    conductores: CONDUCTORES,
    agenda,
  })
  assert.equal(comun.length, 0)

  const extra = proponerPrograma({
    filas: [fila('2026-09-22', 2, 'manana', true)],
    config: CONFIG_POR_DEFECTO,
    territorios: [territorio('t1', '61', 90)],
    conductores: CONDUCTORES,
    agenda,
  })
  assert.equal(extra.length, 1)
  assert.equal(extra[0].territorioId, 't1')
})

test('respeta la fila que se sacó a mano', () => {
  const propuestas = proponerPrograma({
    filas: [fila('2026-09-22', 2, 'manana'), fila('2026-09-23', 3, 'manana')],
    config: CONFIG_POR_DEFECTO,
    territorios: [territorio('t1', '61', 90), territorio('t2', '57', 60)],
    conductores: CONDUCTORES,
    agenda: [],
    sinSalida: [claveFila('2026-09-22', 'manana')],
  })
  assert.deepEqual(propuestas.map((p) => p.fecha), ['2026-09-23'])
})

test('con soloVacias no pisa lo que ya está armado', () => {
  const propuestas = proponerPrograma({
    filas: [fila('2026-09-22', 2, 'manana'), fila('2026-09-23', 3, 'manana')],
    config: CONFIG_POR_DEFECTO,
    territorios: [territorio('t1', '61', 90), territorio('t2', '57', 60)],
    conductores: CONDUCTORES,
    agenda: [],
    soloVacias: true,
    yaArmadas: [claveFila('2026-09-22', 'manana')],
  })
  assert.deepEqual(propuestas.map((p) => p.fecha), ['2026-09-23'])
})

test('le pone el titular de esa semana al turno que lo tiene', () => {
  const config = { ...CONFIG_POR_DEFECTO, titulares: { '2-manana': ['c1'] } }
  const propuestas = proponerPrograma({
    filas: [fila('2026-09-22', 2, 'manana')],
    config,
    territorios: [territorio('t1', '61', 90, null, [punto('p1', 'Zaballa y Talcahuano')])],
    conductores: CONDUCTORES,
    agenda: [],
  })
  assert.equal(propuestas[0].conductorId, 'c1')
  assert.match(propuestas[0].motivo, /titular de ese turno/)
})

test('si el titular de la semana ya conduce ese día, entra el otro titular', () => {
  const config = { ...CONFIG_POR_DEFECTO, titulares: { '2-manana': ['c1', 'c3'] } }
  const deEstaSemana = titularDeLaSemana(config, 2, 'manana', martes())
  const otro = deEstaSemana.id === 'c1' ? 'c3' : 'c1'
  const propuestas = proponerPrograma({
    filas: [fila('2026-09-22', 2, 'manana'), fila('2026-09-22', 2, 'manana', true)],
    config,
    territorios: [territorio('t1', '61', 90), territorio('t2', '57', 60)],
    conductores: CONDUCTORES,
    agenda: [],
  })
  assert.equal(propuestas[0].conductorId, deEstaSemana.id)
  assert.equal(propuestas[1].conductorId, otro)
})

test('si no hay nadie disponible, la fila queda sin conductor y el motivo lo dice', () => {
  const propuestas = proponerPrograma({
    // Domingo a la tarde: nadie de la lista puede ese día.
    filas: [fila('2026-09-27', 0, 'tarde')],
    config: { ...CONFIG_POR_DEFECTO, horarios: { '0-tarde': '16:00' } },
    territorios: [territorio('t1', '61', 90)],
    conductores: CONDUCTORES,
    agenda: [],
  })
  assert.equal(propuestas[0].conductorId, null)
  assert.match(propuestas[0].motivo, /no hay conductor disponible/)
})

test('un conductor no queda en dos salidas del mismo día', () => {
  const propuestas = proponerPrograma({
    filas: [fila('2026-09-22', 2, 'manana'), fila('2026-09-22', 2, 'manana', true)],
    config: CONFIG_POR_DEFECTO,
    territorios: [territorio('t1', '61', 90), territorio('t2', '57', 60)],
    conductores: [conductor('c1', 'Ariel Riveros', [2], ['manana'], 0)],
    agenda: [],
  })
  assert.equal(propuestas[0].conductorId, 'c1')
  assert.equal(propuestas[1].conductorId, null)
  assert.deepEqual(propuestas.map((propuesta) => propuesta.clave), [
    '2026-09-22-manana', '2026-09-22-manana-extra',
  ])
})

test('entre dos disponibles elige al que menos salidas lleva', () => {
  const propuestas = proponerPrograma({
    filas: [fila('2026-09-22', 2, 'manana')],
    config: CONFIG_POR_DEFECTO,
    territorios: [territorio('t1', '61', 90)],
    conductores: [
      conductor('c1', 'Ariel Riveros', [2], ['manana'], 5),
      conductor('c9', 'Rubén Andrada', [2], ['manana'], 1),
    ],
    agenda: [],
  })
  assert.equal(propuestas[0].conductorId, 'c9')
})

test('alterna el turno respecto de la última vez', () => {
  const propuestas = proponerPrograma({
    filas: [fila('2026-09-23', 3, 'manana'), fila('2026-09-23', 3, 'tarde')],
    config: CONFIG_POR_DEFECTO,
    territorios: [
      territorio('t1', '61', 90, 'tarde'), // la última fue de tarde: le toca mañana
      territorio('t2', '57', 80, 'manana'), // la última fue de mañana: le toca tarde
    ],
    conductores: CONDUCTORES,
    agenda: [],
  })
  assert.equal(propuestas[0].territorioId, 't1')
  assert.equal(propuestas[1].territorioId, 't2')
  assert.match(propuestas[0].motivo, /alterna a mañana/)
  assert.match(propuestas[1].motivo, /alterna a tarde/)
})

test('el punto que propone es el primero con ubicación cargada', () => {
  const propuestas = proponerPrograma({
    filas: [fila('2026-09-23', 3, 'manana')],
    config: CONFIG_POR_DEFECTO,
    territorios: [
      territorio('t1', '61', 90, null, [
        { id: 'p1', codigo: '61.1', nombre: 'Sin marcar', lat: null, lng: null },
        punto('p2', 'Zaballa y Talcahuano'),
      ]),
    ],
    conductores: CONDUCTORES,
    agenda: [],
  })
  assert.equal(propuestas[0].puntoId, 'p2')
  assert.match(propuestas[0].motivo, /Zaballa y Talcahuano/)
})

test('un territorio sin puntos se propone igual, y el motivo lo dice', () => {
  const propuestas = proponerPrograma({
    filas: [fila('2026-09-23', 3, 'manana')],
    config: CONFIG_POR_DEFECTO,
    territorios: [territorio('t1', '30', null, null, [])],
    conductores: CONDUCTORES,
    agenda: [],
  })
  assert.equal(propuestas[0].puntoId, null)
  assert.match(propuestas[0].motivo, /no tiene punto de encuentro cargado/)
})

test('el teléfono no consume territorio y sale a la hora de la configuración', () => {
  const propuestas = proponerPrograma({
    filas: [fila('2026-09-22', 2, 'telefono'), fila('2026-09-23', 3, 'manana')],
    config: CONFIG_POR_DEFECTO,
    territorios: [territorio('t1', '61', 90)],
    conductores: CONDUCTORES,
    agenda: [],
  })
  const telefono = propuestas[0]
  assert.equal(telefono.turno, 'telefono')
  assert.equal(telefono.territorioId, null)
  assert.equal(telefono.hora, '19:30')
  // El territorio que quedaba se lo lleva la salida territorial, no el teléfono.
  assert.equal(propuestas[1].territorioId, 't1')
})

test('la hora de cada fila es la de la semana, no la de la última vez', () => {
  const propuestas = proponerPrograma({
    filas: [fila('2026-09-25', 5, 'manana')],
    config: CONFIG_POR_DEFECTO,
    territorios: [territorio('t1', '61', 90)],
    conductores: CONDUCTORES,
    agenda: [],
  })
  assert.equal(propuestas[0].hora, '09:30')
})

test('las salidas de grupos no se proponen ni consumen territorio', () => {
  const propuestas = proponerPrograma({
    filas: [fila('2026-09-26', 6, 'grupos'), fila('2026-09-26', 6, 'tarde')],
    config: CONFIG_POR_DEFECTO,
    territorios: [territorio('t1', '26', 90)],
    conductores: CONDUCTORES,
    agenda: [],
  })
  // La fila de grupos no aparece en la propuesta, y el territorio queda para
  // la salida de la tarde, que es la que sí se planifica.
  assert.equal(propuestas.length, 1)
  assert.equal(propuestas[0].turno, 'tarde')
  assert.equal(propuestas[0].territorioId, 't1')
})
