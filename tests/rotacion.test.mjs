import test from 'node:test'
import assert from 'node:assert/strict'
import { comoSeDijoLaUltimaVez, rotacionPorTerritorio } from '../src/lib/rotacion.ts'

const HOY = new Date(2026, 8, 22, 12, 0) // martes 22 de septiembre de 2026
const salida = (territory_id, cuando, extra = {}) => ({
  territory_id,
  scheduled_for: cuando.toISOString(),
  ...extra,
})
const haceDias = (dias, hora = 10) => new Date(2026, 8, 22 - dias, hora)

test('de cada territorio toma la última salida, no la primera', () => {
  const rotacion = rotacionPorTerritorio(
    [
      salida('t61', haceDias(96)),
      salida('t61', haceDias(20)),
      salida('t61', haceDias(200)),
    ],
    HOY,
  )
  assert.equal(rotacion.get('t61')?.diasSinTrabajar, 20)
})

test('una salida programada para más adelante no dice nada de la rotación', () => {
  const rotacion = rotacionPorTerritorio(
    [salida('t61', haceDias(90)), salida('t61', new Date(2026, 9, 5, 10, 0))],
    HOY,
  )
  assert.equal(rotacion.get('t61')?.diasSinTrabajar, 90)
})

test('un territorio que solo tiene programado el futuro todavía no se trabajó', () => {
  const rotacion = rotacionPorTerritorio([salida('t61', new Date(2026, 9, 5, 10, 0))], HOY)
  assert.equal(rotacion.get('t61'), undefined)
})

test('el teléfono y las salidas de grupos no cuentan como territorio trabajado', () => {
  const rotacion = rotacionPorTerritorio(
    [
      salida('t61', haceDias(3), { tipo: 'telefonica' }),
      salida('t61', haceDias(4), { tipo: 'especial' }),
      salida('t61', haceDias(5), { meeting_point_name: 'Salidas de Grupos' }),
      salida('t61', haceDias(90)),
    ],
    HOY,
  )
  assert.equal(rotacion.get('t61')?.diasSinTrabajar, 90)
})

test('una salida sin territorio no entra en la rotación', () => {
  const rotacion = rotacionPorTerritorio([salida(null, haceDias(3))], HOY)
  assert.equal(rotacion.size, 0)
})

test('el turno de la última vez sale de la hora: antes del mediodía es mañana', () => {
  const rotacion = rotacionPorTerritorio(
    [salida('t61', haceDias(10, 9)), salida('t57', haceDias(10, 19))],
    HOY,
  )
  assert.equal(rotacion.get('t61')?.ultimoTurno, 'manana')
  assert.equal(rotacion.get('t57')?.ultimoTurno, 'tarde')
})

test('una fecha ilegible no rompe ni inventa antigüedad', () => {
  const rotacion = rotacionPorTerritorio(
    [{ territory_id: 't61', scheduled_for: 'no es una fecha' }, salida('t57', haceDias(7))],
    HOY,
  )
  assert.equal(rotacion.get('t61'), undefined)
  assert.equal(rotacion.get('t57')?.diasSinTrabajar, 7)
})

test('lo de hoy no se cuenta como un día entero', () => {
  const rotacion = rotacionPorTerritorio([salida('t61', new Date(2026, 8, 22, 9, 30))], HOY)
  assert.equal(rotacion.get('t61')?.diasSinTrabajar, 0)
})

test('el rótulo se dice como se habla, no como se guarda', () => {
  assert.equal(comoSeDijoLaUltimaVez(undefined), 'Nunca se programó')
  assert.equal(comoSeDijoLaUltimaVez({ diasSinTrabajar: null, ultimoTurno: null, ultimaFecha: null }), 'Nunca se programó')
  assert.equal(comoSeDijoLaUltimaVez({ diasSinTrabajar: 0, ultimoTurno: 'manana', ultimaFecha: '' }), 'Se hizo hoy')
  assert.equal(comoSeDijoLaUltimaVez({ diasSinTrabajar: 1, ultimoTurno: 'tarde', ultimaFecha: '' }), 'Ayer')
  assert.equal(comoSeDijoLaUltimaVez({ diasSinTrabajar: 96, ultimoTurno: 'tarde', ultimaFecha: '' }), 'Hace 96 días')
})
