import assert from 'node:assert/strict'
import test from 'node:test'
import {
  DURACION_DESHACER_MS,
  DURACION_DESHECHA_MS,
  TEXTO_DESHECHO,
  cambiosParaMarcar,
  describirAlcance,
  entradasDeMarca,
  entradasParaDeshacer,
  normalizarEstado,
  textoDeMarca,
} from '../src/lib/deshacerMarca.ts'
import { CreateOutbox } from '../src/lib/coverageOutbox.ts'

const lados = [
  { id: 'a', manzana_id: 'm', geometry_version: 4 },
  { id: 'b', manzana_id: 'm', geometry_version: 4 },
  { id: 'c', manzana_id: 'm', geometry_version: 4 },
]

test('el aviso dura 8 segundos y la confirmación de deshacer, 3', () => {
  assert.equal(DURACION_DESHACER_MS, 8000)
  assert.equal(DURACION_DESHECHA_MS, 3000)
})

test('solo cambian las cuadras que de verdad cambian, y recuerdan cómo estaban', () => {
  const cambios = cambiosParaMarcar(lados, 'recorrido', { a: 'recorrido', b: 'revisitar' })
  assert.deepEqual(cambios.map((c) => [c.ladoId, c.estadoPrevio]), [['b', 'revisitar'], ['c', 'sin_dato']])
  assert.deepEqual(cambios[0], { ladoId: 'b', manzanaId: 'm', geometryVersion: 4, estadoPrevio: 'revisitar' })
  // Marcar lo que ya está marcado no cambia nada: tampoco habría qué deshacer.
  assert.deepEqual(cambiosParaMarcar(lados, 'recorrido', { a: 'recorrido', b: 'recorrido', c: 'recorrido' }), [])
})

test('una cuadra sin versión de dibujo frena todo antes de encolar nada', () => {
  assert.throws(
    () => cambiosParaMarcar([lados[0], { id: 'x', manzana_id: 'm' }], 'recorrido', {}),
    /Falta la versión del dibujo/,
  )
})

test('un estado desconocido cuenta como sin dato', () => {
  assert.equal(normalizarEstado(undefined), 'sin_dato')
  assert.equal(normalizarEstado('raro'), 'sin_dato')
  assert.equal(normalizarEstado('no_accesible'), 'no_accesible')
})

test('marcar y deshacer emiten eventos de agregar, con el autor y el origen de siempre', () => {
  const cambios = cambiosParaMarcar(lados, 'recorrido', { b: 'revisitar' })
  const marcas = entradasDeMarca(cambios, 'recorrido', 'terr', 'user')
  assert.deepEqual(marcas.map((e) => [e.lado_id, e.estado]), [['a', 'recorrido'], ['b', 'recorrido'], ['c', 'recorrido']])
  const deshacer = entradasParaDeshacer(cambios, 'terr', 'user')
  // Lo que estaba sin marcar vuelve a "sin dato"; lo que tenía otro estado, a ese.
  assert.deepEqual(deshacer.map((e) => [e.lado_id, e.estado]), [['a', 'sin_dato'], ['b', 'revisitar'], ['c', 'sin_dato']])
  for (const e of [...marcas, ...deshacer]) {
    assert.equal(e.origen, 'app_hermano')
    assert.equal(e.informado_por, 'user')
    assert.equal(e.territory_id, 'terr')
    assert.equal(e.geometry_version, 4)
  }
})

test('deshacer pasa por la misma cola: la bitácora solo agrega y el estado final es el de antes', async () => {
  const datos = new Map()
  const caja = CreateOutbox({
    projectRef: 'dev', userId: 'user',
    storage: { getItem: (k) => datos.get(k) ?? null, setItem: (k, v) => datos.set(k, v) },
    lock: async (_nombre, tarea) => tarea(),
  })
  const antes = { b: 'no_accesible' }
  const cambios = cambiosParaMarcar(lados, 'recorrido', antes)
  for (const e of entradasDeMarca(cambios, 'recorrido', 'terr', 'user')) await caja.enqueue(e)
  for (const e of entradasParaDeshacer(cambios, 'terr', 'user')) await caja.enqueue(e)

  const eventos = caja.getEvents()
  assert.equal(eventos.length, 6, 'nada se borra de la cola: se agregan seis eventos')
  assert.equal(new Set(eventos.map((e) => e.id)).size, 6)
  // El último evento de cada cuadra es el que manda, igual que en la base.
  const final = { ...antes }
  for (const e of eventos) final[e.lado_id] = e.estado
  assert.deepEqual(final, { a: 'sin_dato', b: 'no_accesible', c: 'sin_dato' })
})

test('el aviso dice lo que se hizo con las palabras de la persona', () => {
  const manzana = { tipo: 'manzana', etiqueta: 'b' }
  const cuadra = { tipo: 'cuadra', numero: 2, etiqueta: 'b' }
  assert.equal(describirAlcance(manzana), 'la manzana B')
  assert.equal(describirAlcance(cuadra), 'la cuadra 2 de la manzana B')
  assert.equal(describirAlcance({ tipo: 'manzana', etiqueta: '  ' }), 'una manzana sin rótulo')
  assert.equal(textoDeMarca('recorrido', manzana), 'Marcaste la manzana B')
  assert.equal(textoDeMarca('recorrido', cuadra), 'Marcaste la cuadra 2 de la manzana B')
  assert.equal(textoDeMarca('no_accesible', manzana), 'Marcaste la manzana B como no accesible')
  assert.equal(textoDeMarca('revisitar', manzana), 'Marcaste la manzana B para revisitar')
  assert.equal(textoDeMarca('sin_dato', manzana), 'Quitaste la marca de la manzana B')
  assert.equal(TEXTO_DESHECHO, 'Listo, quedó como estaba')
})
