import test from 'node:test'
import assert from 'node:assert/strict'
import {
  aClaveFecha,
  contarDiasInclusive,
  crearEstadoPrograma,
  deClaveFecha,
  fraseDelRango,
  hayDiasPasados,
  presetInicial,
  rangoPorPreset,
  repetirPrimeraSemana,
  semanasDelRango,
  validarRango,
} from '../src/lib/programaRango.ts'

const domingo = new Date(2026, 8, 6, 18, 30) // 6 sep 2026, domingo
const miercoles = new Date(2026, 8, 9, 10, 0)
const lunes = new Date(2026, 8, 7, 8, 0)

test('si queda poco de esta semana, arranca en la próxima', () => {
  assert.equal(presetInicial(domingo), 'proxima-semana')
  assert.equal(presetInicial(miercoles), 'esta-semana')
  assert.equal(presetInicial(lunes), 'esta-semana')
})

test('esta semana va de hoy al domingo', () => {
  const rango = rangoPorPreset('esta-semana', miercoles)
  assert.ok(!('error' in rango))
  assert.equal(aClaveFecha(rango.desde), '2026-09-09')
  assert.equal(aClaveFecha(rango.hasta), '2026-09-13')
})

test('próxima semana es el lunes a domingo que viene', () => {
  const desdeDomingo = rangoPorPreset('proxima-semana', domingo)
  const desdeLunes = rangoPorPreset('proxima-semana', lunes)
  assert.ok(!('error' in desdeDomingo) && !('error' in desdeLunes))
  assert.equal(aClaveFecha(desdeDomingo.desde), '2026-09-07')
  assert.equal(aClaveFecha(desdeDomingo.hasta), '2026-09-13')
  assert.equal(aClaveFecha(desdeLunes.desde), '2026-09-14')
  assert.equal(aClaveFecha(desdeLunes.hasta), '2026-09-20')
})

test('dos semanas son 14 días a partir de hoy', () => {
  const rango = rangoPorPreset('dos-semanas', miercoles)
  assert.ok(!('error' in rango))
  assert.equal(aClaveFecha(rango.desde), '2026-09-09')
  assert.equal(aClaveFecha(rango.hasta), '2026-09-22')
  assert.equal(contarDiasInclusive(rango.desde, rango.hasta), 14)
})

test('este mes va de hoy al último día, el próximo es el mes calendario', () => {
  const este = rangoPorPreset('este-mes', miercoles)
  const proximo = rangoPorPreset('proximo-mes', miercoles)
  assert.ok(!('error' in este) && !('error' in proximo))
  assert.equal(aClaveFecha(este.desde), '2026-09-09')
  assert.equal(aClaveFecha(este.hasta), '2026-09-30')
  assert.equal(aClaveFecha(proximo.desde), '2026-10-01')
  assert.equal(aClaveFecha(proximo.hasta), '2026-10-31')
  assert.equal(contarDiasInclusive(proximo.desde, proximo.hasta), 31)
})

test('la semana del super es lunes a domingo de la visita', () => {
  const visitaMiercoles = rangoPorPreset(
    'semana-del-super',
    domingo,
    new Date(2026, 8, 23),
  )
  const visitaLunes = rangoPorPreset(
    'semana-del-super',
    domingo,
    new Date(2026, 8, 21),
  )
  assert.ok(!('error' in visitaMiercoles) && !('error' in visitaLunes))
  assert.equal(aClaveFecha(visitaMiercoles.desde), '2026-09-21')
  assert.equal(aClaveFecha(visitaMiercoles.hasta), '2026-09-27')
  assert.deepEqual(
    { desde: aClaveFecha(visitaLunes.desde), hasta: aClaveFecha(visitaLunes.hasta) },
    { desde: '2026-09-21', hasta: '2026-09-27' },
  )

  const sinDia = rangoPorPreset('semana-del-super', domingo)
  assert.ok('error' in sinDia)
})

test('no deja más de 31 días ni un hasta anterior', () => {
  assert.equal(
    validarRango(new Date(2026, 8, 1), new Date(2026, 9, 2)),
    'Como máximo un mes (31 días). Armá el resto en otro programa.',
  )
  assert.equal(
    validarRango(new Date(2026, 8, 10), new Date(2026, 8, 9)),
    'La fecha de hasta no puede ser anterior a la de desde.',
  )
  assert.equal(validarRango(new Date(2026, 9, 1), new Date(2026, 9, 31)), null)
})

test('el estado inicial en domingo apunta a la semana que empieza mañana', () => {
  const estado = crearEstadoPrograma(domingo)
  assert.equal(estado.preset, 'proxima-semana')
  assert.equal(estado.desde, '2026-09-07')
  assert.equal(estado.hasta, '2026-09-13')
})

test('la frase del rango se lee en voz alta', () => {
  assert.match(
    fraseDelRango(deClaveFecha('2026-09-07'), deClaveFecha('2026-09-13')),
    /lunes 7.+domingo 13 de septiembre/i,
  )
  assert.match(
    fraseDelRango(deClaveFecha('2026-09-28'), deClaveFecha('2026-10-04')),
    /septiembre.+octubre/i,
  )
})

test('agrupa por semanas recortadas al período', () => {
  const semanas = semanasDelRango(deClaveFecha('2026-09-09'), deClaveFecha('2026-09-22'))
  assert.deepEqual(
    semanas.map((semana) => `${semana.desdeClave}/${semana.hastaClave}`),
    ['2026-09-09/2026-09-13', '2026-09-14/2026-09-20', '2026-09-21/2026-09-22'],
  )
  assert.equal(semanas[1]?.rotulo.startsWith('Semana del del'), false)
  assert.match(semanas[1]?.rotulo ?? '', /Semana del lunes 14 al domingo 20/i)
})

test('repite la primera semana solo en días que existen después', () => {
  const drafts = repetirPrimeraSemana({
    desdeClave: '2026-09-09',
    hastaClave: '2026-09-22',
    rowKeysExistentes: [
      '2026-09-09-tarde',
      '2026-09-16-tarde',
      '2026-09-23-tarde',
      '2026-09-14-manana',
    ],
    drafts: {
      '2026-09-09-tarde': {
        enabled: true,
        slotKey: '2026-09-09-territorial-16:00',
        meetingPointName: 'Plaza',
        meetingPointId: 'p1',
        driverId: 'd1',
        territoryId: 't1',
        meetingCoords: [1, 2],
        mapOpen: true,
      },
    },
  })

  assert.equal(drafts['2026-09-16-tarde']?.slotKey, '2026-09-16-territorial-16:00')
  assert.equal(drafts['2026-09-16-tarde']?.driverId, 'd1')
  assert.equal(drafts['2026-09-16-tarde']?.meetingPointId, 'p1')
  assert.equal(drafts['2026-09-16-tarde']?.mapOpen, false)
  assert.equal(drafts['2026-09-23-tarde'], undefined)
  assert.equal(drafts['2026-09-14-manana'], undefined)
})

test('marca cuando el desde ya pasó', () => {
  assert.equal(hayDiasPasados(deClaveFecha('2026-09-05'), domingo), true)
  assert.equal(hayDiasPasados(deClaveFecha('2026-09-06'), domingo), false)
})
