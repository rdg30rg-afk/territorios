import assert from 'node:assert/strict'
import test from 'node:test'
import {
  VERSION_COPIA,
  formatearGuardadoEl,
  leerAsignaciones,
  leerCopia,
  mensajeDeCopia,
  pareceFaltaDeRed,
  serializarAsignaciones,
  serializarCopia,
} from '../src/lib/copiaDeMapa.ts'

const ESPERADO = { userId: 'u1', territorioId: 't1' }
const manzana = (id = 'm1', extra = {}) => ({
  id, label: 'b', lat: -31.5, lng: -68.5,
  geometry_geojson: { type: 'Polygon', coordinates: [[[-68.5, -31.5], [-68.49, -31.5], [-68.49, -31.49], [-68.5, -31.5]]] },
  ...extra,
})
const lado = (id = 'l1', extra = {}) => ({
  id, manzana_id: 'm1', orden: 0, largo_m: 88.5, geometry_version: 3,
  geometry_geojson: { type: 'LineString', coordinates: [[-68.5, -31.5], [-68.49, -31.5]] },
  ...extra,
})
const copia = (extra = {}) => ({
  version: VERSION_COPIA, userId: 'u1', territorioId: 't1', territorioNombre: '61',
  guardadoEl: new Date(2026, 9, 27, 14, 5).toISOString(),
  manzanas: [manzana(), manzana('m2', { geometry_geojson: null })],
  lados: [lado(), lado('l2', { orden: 1 })],
  estados: { l1: 'recorrido', l2: 'revisitar' },
  ...extra,
})

test('la copia se guarda y se lee igual: manzanas, lados, estados y fecha', () => {
  const original = copia()
  const leida = leerCopia(serializarCopia(original), ESPERADO)
  assert.deepEqual(leida, original)
  assert.equal(typeof serializarCopia(original), 'string')
})

test('una copia de otra cuenta o de otro territorio no se muestra', () => {
  const texto = serializarCopia(copia())
  assert.equal(leerCopia(texto, { userId: 'otra', territorioId: 't1' }), null)
  assert.equal(leerCopia(texto, { userId: 'u1', territorioId: 'otro' }), null)
})

test('una copia rota, vieja o con la forma cambiada se descarta en vez de romper el mapa', () => {
  const malas = [
    null, '', '{roto', '[]', '"texto"', 'null',
    JSON.stringify({ ...copia(), version: 2 }),
    JSON.stringify({ ...copia(), guardadoEl: 'ayer' }),
    JSON.stringify({ ...copia(), territorioNombre: 61 }),
    JSON.stringify({ ...copia(), manzanas: {} }),
    JSON.stringify({ ...copia(), manzanas: [{ id: 'm1' }] }),
    JSON.stringify({ ...copia(), manzanas: [manzana('m1', { geometry_geojson: {} })] }),
    JSON.stringify({ ...copia(), lados: [lado('l1', { geometry_geojson: null })] }),
    JSON.stringify({ ...copia(), lados: [lado('l1', { manzana_id: '' })] }),
    JSON.stringify({ ...copia(), lados: [lado('l1', { orden: '0' })] }),
    JSON.stringify({ ...copia(), estados: { l1: 3 } }),
    JSON.stringify({ ...copia(), estados: [] }),
  ]
  for (const texto of malas) assert.equal(leerCopia(texto, ESPERADO), null, String(texto).slice(0, 60))
})

test('un territorio sin manzanas dibujadas todavía también se guarda y se lee', () => {
  const vacia = copia({ manzanas: [], lados: [], estados: {} })
  assert.deepEqual(leerCopia(serializarCopia(vacia), ESPERADO), vacia)
})

test('las asignaciones guardadas se validan por cuenta y por forma', () => {
  const datos = {
    version: VERSION_COPIA, userId: 'u1', guardadoEl: new Date().toISOString(),
    reservas: [{ id: 'r1', territory_id: 't1', assigned_to: 'u1', requested_by: null, status: 'activa', nota: null }],
    territorios: [{ id: 't1', name: '61' }],
  }
  assert.deepEqual(leerAsignaciones(serializarAsignaciones(datos), { userId: 'u1' }), datos)
  assert.equal(leerAsignaciones(serializarAsignaciones(datos), { userId: 'u2' }), null)
  assert.equal(leerAsignaciones(JSON.stringify({ ...datos, reservas: [{ id: 'r1' }] }), { userId: 'u1' }), null)
  assert.equal(leerAsignaciones(JSON.stringify({ ...datos, territorios: [{ id: 't1' }] }), { userId: 'u1' }), null)
  assert.equal(leerAsignaciones(null, { userId: 'u1' }), null)
  assert.equal(leerAsignaciones('{roto', { userId: 'u1' }), null)
})

test('la fecha se dice en español y en la hora del teléfono', () => {
  assert.equal(formatearGuardadoEl(new Date(2026, 9, 27, 14, 5).toISOString()), '27 de octubre a las 14:05')
  assert.equal(formatearGuardadoEl(new Date(2026, 0, 3, 9, 7).toISOString()), '3 de enero a las 09:07')
  assert.equal(formatearGuardadoEl(new Date(2026, 11, 31, 23, 59).toISOString()), '31 de diciembre a las 23:59')
  assert.match(formatearGuardadoEl('no es una fecha'), /no pudimos leer/)
})

test('el aviso de la copia dice "Sin señal · mostrando lo guardado el …"', () => {
  const guardadoEl = new Date(2026, 9, 27, 14, 5).toISOString()
  assert.equal(mensajeDeCopia(guardadoEl, 'red'), 'Sin señal · mostrando lo guardado el 27 de octubre a las 14:05')
  // Si no fue la señal, no se dice que fue la señal.
  assert.equal(mensajeDeCopia(guardadoEl, 'otra'), 'No pudimos actualizar · mostrando lo guardado el 27 de octubre a las 14:05')
})

test('se reconoce una falla de red aunque el teléfono diga que está en línea', () => {
  assert.equal(pareceFaltaDeRed(new Error('algo'), false), true)
  assert.equal(pareceFaltaDeRed(new Error('TypeError: Failed to fetch'), true), true)
  assert.equal(pareceFaltaDeRed({ message: 'NetworkError when attempting to fetch resource.' }, true), true)
  assert.equal(pareceFaltaDeRed(new Error('Load failed'), true), true)
  assert.equal(pareceFaltaDeRed(new Error('La carga del programa tardó demasiado.'), true), true)
  assert.equal(pareceFaltaDeRed({ message: 'JWT expired', code: 'PGRST301' }, true), false)
  assert.equal(pareceFaltaDeRed({ message: 'permission denied for table manzana_lados' }, true), false)
  assert.equal(pareceFaltaDeRed(undefined, true), false)
})
