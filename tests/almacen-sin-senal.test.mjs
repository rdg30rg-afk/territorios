import assert from 'node:assert/strict'
import test from 'node:test'
import {
  claveDeAsignaciones,
  claveDeCopia,
  claveDePrecarga,
  crearAlmacenConRespaldo,
  crearAlmacenIndexedDB,
  crearAlmacenLocalStorage,
  guardarAsignaciones,
  guardarCopiaDeMapa,
  guardarRegistroDePrecarga,
  leerAsignacionesGuardadas,
  leerCopiaDeMapa,
  leerRegistroDePrecarga,
} from '../src/lib/almacenSinSenal.ts'
import { VERSION_COPIA } from '../src/lib/copiaDeMapa.ts'

// Un IndexedDB de mentira, con la misma forma de pedidos y eventos del real.
function fabricaIDB({ falla = null } = {}) {
  const bases = new Map()
  return {
    bases,
    open(nombre) {
      const pedido = {}
      queueMicrotask(() => {
        if (falla === 'abrir') { pedido.error = new Error('bloqueada'); pedido.onerror?.(); return }
        const nueva = !bases.has(nombre)
        const tablas = bases.get(nombre) ?? new Map()
        bases.set(nombre, tablas)
        const db = {
          createObjectStore(tabla) { tablas.set(tabla, new Map()) },
          transaction(tabla) {
            const datos = tablas.get(tabla)
            const tx = {}
            const terminar = () => queueMicrotask(() => {
              if (falla === 'escribir') { tx.error = new Error('cuota'); tx.onerror?.() } else tx.oncomplete?.()
            })
            return Object.assign(tx, {
              objectStore: () => ({
                get(clave) {
                  const r = {}
                  queueMicrotask(() => { r.result = datos.get(clave); r.onsuccess?.() })
                  return r
                },
                put(valor, clave) { if (falla !== 'escribir') datos.set(clave, valor); terminar() },
                delete(clave) { datos.delete(clave); terminar() },
              }),
            })
          },
        }
        pedido.result = db
        if (nueva) pedido.onupgradeneeded?.()
        pedido.onsuccess?.()
      })
      return pedido
    },
  }
}

function almacenEnMemoria({ falla = false } = {}) {
  const datos = new Map()
  return {
    datos,
    getItem: (k) => { if (falla === 'leer') throw new Error('bloqueado'); return datos.get(k) ?? null },
    setItem: (k, v) => { if (falla) throw new Error('QuotaExceededError'); datos.set(k, v) },
    removeItem: (k) => { datos.delete(k) },
  }
}

const copia = (extra = {}) => ({
  version: VERSION_COPIA, userId: 'u1', territorioId: 't1', territorioNombre: '61',
  guardadoEl: new Date(2026, 9, 27, 14, 5).toISOString(),
  manzanas: [{ id: 'm1', label: 'a', lat: 0, lng: 0, geometry_geojson: null }],
  lados: [{ id: 'l1', manzana_id: 'm1', orden: 0, largo_m: 10, geometry_geojson: { coordinates: [[0, 0], [1, 1]] } }],
  estados: { l1: 'recorrido' },
  ...extra,
})

test('IndexedDB: escribir, leer, borrar, y los datos sobreviven a una instancia nueva', async () => {
  const fabrica = fabricaIDB()
  const a = crearAlmacenIndexedDB(fabrica)
  assert.equal(await a.leer('x'), null)
  await a.escribir('x', 'hola')
  assert.equal(await a.leer('x'), 'hola')
  // Otra instancia sobre la misma base: el "teléfono" volvió a abrir la app.
  assert.equal(await crearAlmacenIndexedDB(fabrica).leer('x'), 'hola')
  await a.borrar('x')
  assert.equal(await a.leer('x'), null)
})

test('IndexedDB: sin soporte, bloqueada o llena rechaza, para que entre el respaldo', async () => {
  await assert.rejects(crearAlmacenIndexedDB(undefined).leer('x'), /no tiene IndexedDB/)
  await assert.rejects(crearAlmacenIndexedDB(fabricaIDB({ falla: 'abrir' })).leer('x'), /bloqueada/)
  await assert.rejects(crearAlmacenIndexedDB(fabricaIDB({ falla: 'escribir' })).escribir('x', 'y'), /cuota/)
})

test('si IndexedDB falla, se guarda en localStorage y se lee de ahí', async () => {
  const storage = almacenEnMemoria()
  const almacen = crearAlmacenConRespaldo(
    crearAlmacenIndexedDB(fabricaIDB({ falla: 'abrir' })),
    crearAlmacenLocalStorage(storage),
  )
  assert.equal(await guardarCopiaDeMapa(almacen, copia()), true)
  assert.equal(storage.datos.size, 1)
  assert.deepEqual(await leerCopiaDeMapa(almacen, 'u1', 't1'), copia())
})

test('si IndexedDB anda, no queda una copia más vieja escondida en localStorage', async () => {
  const storage = almacenEnMemoria()
  storage.datos.set(claveDeCopia('u1', 't1'), 'copia vieja')
  const almacen = crearAlmacenConRespaldo(crearAlmacenIndexedDB(fabricaIDB()), crearAlmacenLocalStorage(storage))
  assert.equal(await guardarCopiaDeMapa(almacen, copia()), true)
  assert.equal(storage.datos.size, 0)
  assert.deepEqual(await leerCopiaDeMapa(almacen, 'u1', 't1'), copia())
})

test('lo guardado solo en localStorage antes de usar IndexedDB todavía se encuentra', async () => {
  const storage = almacenEnMemoria()
  const solo = crearAlmacenLocalStorage(storage)
  await guardarCopiaDeMapa(solo, copia())
  const almacen = crearAlmacenConRespaldo(crearAlmacenIndexedDB(fabricaIDB()), solo)
  assert.deepEqual(await leerCopiaDeMapa(almacen, 'u1', 't1'), copia())
})

test('si no cabe en ningún lado no se guarda, y nada tira error', async () => {
  const almacen = crearAlmacenConRespaldo(
    crearAlmacenIndexedDB(fabricaIDB({ falla: 'escribir' })),
    crearAlmacenLocalStorage(almacenEnMemoria({ falla: true })),
  )
  assert.equal(await guardarCopiaDeMapa(almacen, copia()), false)
  assert.equal(await leerCopiaDeMapa(almacen, 'u1', 't1'), null)
  assert.equal(await guardarAsignaciones(almacen, { version: VERSION_COPIA, userId: 'u1', guardadoEl: new Date().toISOString(), reservas: [], territorios: [] }), false)
  assert.equal(await leerAsignacionesGuardadas(almacen, 'u1'), null)
  await guardarRegistroDePrecarga(almacen, 'u1', 't1', { clave: 'k', terminadoEl: new Date().toISOString() })
  assert.equal(await leerRegistroDePrecarga(almacen, 'u1', 't1'), null)
})

test('sin IndexedDB ni localStorage tampoco se rompe', async () => {
  const almacen = crearAlmacenConRespaldo(crearAlmacenIndexedDB(undefined), crearAlmacenLocalStorage(undefined))
  assert.equal(await guardarCopiaDeMapa(almacen, copia()), false)
  assert.equal(await leerCopiaDeMapa(almacen, 'u1', 't1'), null)
})

test('la copia de una cuenta no se la lee otra, y una copia corrupta da null', async () => {
  const almacen = crearAlmacenConRespaldo(crearAlmacenIndexedDB(fabricaIDB()), crearAlmacenLocalStorage(almacenEnMemoria()))
  await guardarCopiaDeMapa(almacen, copia())
  assert.equal(await leerCopiaDeMapa(almacen, 'otra', 't1'), null)
  assert.equal(await leerCopiaDeMapa(almacen, 'u1', 'otro'), null)
  await almacen.escribir(claveDeCopia('u1', 't1'), '{corrupta')
  assert.equal(await leerCopiaDeMapa(almacen, 'u1', 't1'), null)
})

test('asignaciones y registro de precarga: ida y vuelta', async () => {
  const almacen = crearAlmacenConRespaldo(crearAlmacenIndexedDB(fabricaIDB()), crearAlmacenLocalStorage(almacenEnMemoria()))
  const datos = {
    version: VERSION_COPIA, userId: 'u1', guardadoEl: new Date().toISOString(),
    reservas: [{ id: 'r1', territory_id: 't1', status: 'activa' }], territorios: [{ id: 't1', name: '61' }],
  }
  assert.equal(await guardarAsignaciones(almacen, datos), true)
  assert.deepEqual(await leerAsignacionesGuardadas(almacen, 'u1'), datos)
  assert.equal(await leerAsignacionesGuardadas(almacen, 'u2'), null)

  const registro = { clave: 'k', terminadoEl: '2026-10-27T15:00:00.000Z' }
  await guardarRegistroDePrecarga(almacen, 'u1', 't1', registro)
  assert.deepEqual(await leerRegistroDePrecarga(almacen, 'u1', 't1'), registro)
  assert.equal(await leerRegistroDePrecarga(almacen, 'u1', 't2'), null)
  await almacen.escribir(claveDePrecarga('u1', 't1'), '{"clave": 4}')
  assert.equal(await leerRegistroDePrecarga(almacen, 'u1', 't1'), null)
})

test('las claves llevan cuenta y territorio, para que no se mezclen', () => {
  assert.notEqual(claveDeCopia('u1', 't1'), claveDeCopia('u1', 't2'))
  assert.notEqual(claveDeCopia('u1', 't1'), claveDeCopia('u2', 't1'))
  assert.match(claveDeAsignaciones('u1'), /u1/)
})
