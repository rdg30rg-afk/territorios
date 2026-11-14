import test from 'node:test'
import assert from 'node:assert/strict'
import {
  armarFilasDeSalidas, armarTerminados, contarSalidasIncompletas, formatearPorcentaje, haceCuanto,
} from '../src/lib/inicioAvisos.ts'

const ahora = new Date('2026-11-13T15:00:00-03:00')
const iso = (d, h) => new Date(`2026-11-${String(d).padStart(2, '0')}T${String(h).padStart(2, '0')}:00:00-03:00`).toISOString()

test('porcentaje con coma y sin decimales de más', () => {
  assert.equal(formatearPorcentaje(64.8), '64,8 %')
  assert.equal(formatearPorcentaje(100), '100 %')
  assert.equal(formatearPorcentaje(25), '25 %')
})

test('haceCuanto cuenta días de calendario', () => {
  assert.equal(haceCuanto(iso(13, 8), ahora), 'hoy')
  assert.equal(haceCuanto(iso(12, 23), ahora), 'ayer')
  assert.equal(haceCuanto(iso(10, 9), ahora), 'hace 3 días')
})

test('salidas sin punto y sin territorio; las de teléfono y grupos no cuentan', () => {
  const r = contarSalidasIncompletas([
    { tipo: null, territory_id: null, meeting_point_id: null, meeting_point_name: null },
    { tipo: null, territory_id: 't', meeting_point_id: null, meeting_point_name: '  ' },
    { tipo: null, territory_id: 't', meeting_point_id: null, meeting_point_name: 'Plaza' },
    { tipo: 'telefonica', territory_id: null, meeting_point_id: null, meeting_point_name: null },
    { tipo: 'grupos', territory_id: null, meeting_point_id: null, meeting_point_name: null },
  ])
  assert.deepEqual(r, { sinPunto: 2, sinTerritorio: 1 })
})

test('salidas: informada con quién y estado, sin informar con botón solo si ya empezó', () => {
  const salidas = [
    { id: 'a', title: 'Mañana 57', scheduled_for: iso(12, 9), tipo: null },
    { id: 'b', title: 'Tarde 12', scheduled_for: iso(12, 17), tipo: null },
    { id: 'c', title: 'Noche 3', scheduled_for: iso(13, 19), tipo: null },
    { id: 'd', title: 'Grupos', scheduled_for: iso(13, 9), tipo: 'grupos' },
  ]
  const filas = armarFilasDeSalidas(
    salidas,
    [{ salida_id: 'a', estado: 'parcial', motivo: 'clima', informado_por: 'u1' }],
    new Map([['u1', 'Pedro']]),
    ahora,
  )
  assert.equal(filas.length, 3)
  assert.match(filas[0].texto, /Informada por Pedro: Parcial \(clima\)/)
  assert.equal(filas[0].puedeInformar, false)
  assert.equal(filas[1].texto, 'Sin informar')
  assert.equal(filas[1].puedeInformar, true)
  assert.equal(filas[2].texto, 'Todavía no empezó')
  assert.equal(filas[2].puedeInformar, false)
})

test('terminados: devolución, 100 % sin devolver, y lo viejo o ajeno se ignora', () => {
  const cob = new Map([
    ['t1', { territory_id: 't1', name: '12', pct_metros: 100, ultima_marca: iso(12, 10), tiene_dato: true }],
    ['t2', { territory_id: 't2', name: '7', pct_metros: '64.8', ultima_marca: iso(11, 10), tiene_dato: true }],
    ['t3', { territory_id: 't3', name: '9', pct_metros: 100, ultima_marca: new Date(2026, 8, 1).toISOString(), tiene_dato: true }],
  ])
  const nombres = new Map([['u1', 'Ana'], ['u2', 'Luis']])
  const filas = armarTerminados([
    { id: 'r1', territory_id: 't1', status: 'activa', assigned_to: 'u1', reserved_at: iso(1, 9), released_at: null },
    { id: 'r2', territory_id: 't2', status: 'liberada', assigned_to: 'u2', reserved_at: iso(1, 9), released_at: iso(11, 12) },
    { id: 'r3', territory_id: 't3', status: 'activa', assigned_to: 'u1', reserved_at: iso(1, 9), released_at: null },
    { id: 'r4', territory_id: 't2', status: 'liberada', assigned_to: 'u2', reserved_at: iso(1, 9), released_at: new Date(2026, 8, 1).toISOString() },
  ], cob, nombres, ahora)
  assert.equal(filas.length, 2)
  assert.match(filas[0].texto, /Ana terminó de recorrer el territorio 12 y todavía no lo devolvió/)
  assert.match(filas[1].texto, /Luis devolvió el territorio 7 \(recorrido 64,8 %\)/)
})

test('el día se cuenta en hora argentina: a las 23:46 del viernes el sábado es mañana', () => {
  const viernesNoche = new Date('2026-11-13T23:46:00-03:00') // ya es sábado en UTC
  assert.equal(haceCuanto(iso(14, 10), viernesNoche), 'mañana')
  assert.equal(haceCuanto(iso(13, 18), viernesNoche), 'hoy')
  const filas = armarFilasDeSalidas(
    [{ id: 's1', title: 'Sábado', scheduled_for: iso(14, 10), tipo: null }],
    [],
    new Map(),
    viernesNoche,
  )
  assert.equal(filas[0].cuando, 'Mañana 10:00')
})
