import test from 'node:test'
import assert from 'node:assert/strict'
import vm from 'node:vm'
import { area } from '@turf/area'
import { difference } from '@turf/difference'
import { intersect } from '@turf/intersect'
import { union } from '@turf/union'
import { html, tramo } from './fixtures/editor-fuente.mjs'

const cuadrado = (x, y, s = 0.001) => ({
  type: 'Polygon',
  coordinates: [[[x, y], [x + s, y], [x + s, y + s], [x, y + s], [x, y]]],
})
const feat = vm.runInContext(html.match(/const feat = (\(geom\) => \(\{[^\n]*\}\))\n/)[1], vm.createContext({}))
const fc = vm.runInContext(html.match(/const fc = (\(a, b\) => \(\{[^\n]*\}\))\n/)[1], vm.createContext({}))

// ======================================= "Ver qué falta guardar" y el panel
function armarBase ({ filas }) {
  const avisos = []
  const territorios = new Map()
  const manzanas = new Map()
  const tocados = new Set()
  const t = (id, numero, cuantas, extra = {}) => {
    territorios.set(id, { id, numero, ...extra })
    for (let i = 0; i < cuantas; i++) manzanas.set(`${id}-${i}`, { id: `${id}-${i}`, territorio: id })
  }
  const ctx = vm.createContext({
    enLaBase: null, BD_URL: 'https://dev.invalid', BD_KEY: 'k', tokenDeSesion: () => 'token',
    fetch: async () => ({ ok: true, json: async () => filas }),
    refrescarPanel: () => {}, avisar: (m) => avisos.push(m),
    territorios, manzanas, tocados,
  })
  vm.runInContext(tramo('function contraLaBase', '// Se mira cada minuto'), ctx)
  return { ctx, avisos, t, tocados }
}

test('"Ver qué falta guardar" compara con el número con el que se publicó, igual que el panel', async () => {
  const e = armarBase({ filas: [
    { name: '5', manzanas: 3 },   // el territorio renumerado 5 -> 12, publicado con 5
    { name: '7', manzanas: 2 },
    { name: '8', manzanas: 4 },
    { name: '20', manzanas: 1 },
  ] })
  e.t('a', '12', 3, { numeroBase: '5' })   // renumerado y sin publicar: la base lo tiene como 5
  e.t('b', '7', 2)                         // igual que la base
  e.t('c', '9', 1)                         // la base no lo conoce
  e.t('d', '8', 4)                         // mismas manzanas pero con una mudanza sin publicar
  e.tocados.add('d')
  e.t('f', '20', 1, { colorBase: '#407dfe' })  // color sin publicar
  e.t('g', '30', 0)                        // vacío: no cuenta

  await vm.runInContext('traerDeLaBase(true)', e.ctx)
  // Antes el 12 salía "sin guardar nunca" porque se buscaba "12" en la base.
  assert.equal(e.avisos.at(-1),
    '<b>1</b> territorio ya guardado, <b>3</b> con cambios sin guardar y <b>1</b> sin guardar nunca.')
})

test('el panel y el resumen usan la misma función para decidir qué dice la base', () => {
  const panel = tramo('function refrescarPanel', '// Volver a "nada seleccionado"')
  const resumen = tramo('async function traerDeLaBase', '// Se mira cada minuto')
  assert.match(panel, /contraLaBase\(t, n\)/)
  assert.match(resumen, /contraLaBase\(t, n\)/)
  assert.doesNotMatch(panel, /enLaBase\.get\(/, 'el panel no hace su propia búsqueda')
  assert.doesNotMatch(resumen, /enLaBase\.get\(/, 'el resumen tampoco')
})

test('contraLaBase busca por numeroBase y clasifica igual que el panel', () => {
  const e = armarBase({ filas: [] })
  const contra = (t, n) => {
    e.ctx.enLaBase = new Map([['5', 3], ['7', 2], ['9', 0]])
    return JSON.parse(JSON.stringify(vm.runInContext('contraLaBase', e.ctx)(t, n)))
  }
  assert.deepEqual(contra({ numero: '12', numeroBase: '5' }, 3), { clase: 'guardado', enBase: 3 })
  assert.deepEqual(contra({ numero: '12', numeroBase: '5' }, 4), { clase: 'distinto', enBase: 3 })
  assert.deepEqual(contra({ numero: '12' }, 4), { clase: 'sin-cargar' })
  assert.equal(contra({ numero: '9' }, 1).clase, 'sin-cargar', 'cero manzanas vigentes es como no estar')
  assert.equal(contra({ numero: '7' }, 0), null, 'un territorio vacío no se compara')
  e.ctx.enLaBase = null
  assert.equal(vm.runInContext('contraLaBase', e.ctx)({ numero: '7' }, 2), null, 'sin haber consultado la base no hay nada que decir')
})

test('tienePendiente ve lo que la cuenta de manzanas no ve', () => {
  const e = armarBase({ filas: [] })
  e.tocados.add('m')
  const pendiente = (t) => vm.runInContext('tienePendiente', e.ctx)(t)
  assert.equal(pendiente({ id: 'x', numero: '1' }), false)
  assert.equal(pendiente({ id: 'm', numero: '1' }), true)
  assert.equal(pendiente({ id: 'x', numero: '2', numeroBase: '1' }), true)
  assert.equal(pendiente({ id: 'x', numero: '1', colorBase: '#fff' }), true)
})

// ================================ Dividir y fusionar vuelven las caras a automático
function armarEdicion () {
  const instantaneas = []
  const avisos = []
  const manzanas = new Map()
  const ctx = vm.createContext({
    manzanas, paraFusionar: [], cortePuntos: [],
    capaCorte: { clearLayers () {} },
    area, difference, intersect, union, feat, fc,
    // La foto se toma como la real: serializando el estado en ese instante.
    instantanea: () => instantaneas.push(JSON.stringify([...manzanas.values()])),
    limpiarDiag: (m) => { delete m.__diag },
    reletrar: () => {}, refrescar: () => {},
    avisar: (m) => avisos.push(m),
  })
  vm.runInContext(tramo('function fusionar ()', '// Las letras se reasignan'), ctx)
  const poner = (id, geom, extra = {}) => { const m = { id, geom, territorio: 'T', ...extra }; manzanas.set(id, m); return m }
  return { ctx, manzanas, instantaneas, avisos, poner }
}
const conCaras = { caras: [[0, 1, 2], [2, 3, 0]], carasN: 4 }

test('dividir deja las dos mitades sin caras a mano y sin mutar la forma vieja', () => {
  const e = armarEdicion()
  const geomVieja = cuadrado(0, 0, 0.002)
  const m = e.poner('m', geomVieja, { orden: 1, ...conCaras })
  e.ctx.cortePuntos = [[0.001, -0.001], [0.001, 0.003]]
  vm.runInContext("dividir('m')", e.ctx)

  assert.equal(e.manzanas.size, 2)
  const otra = [...e.manzanas.values()].find((x) => x.id !== 'm')
  for (const mitad of [m, otra]) {
    assert.equal('caras' in mitad, false, `${mitad.id}: vuelve al cálculo automático`)
    assert.equal('carasN' in mitad, false)
    assert.equal(mitad.editada, true)
    assert.equal(mitad.territorio, 'T')
  }
  assert.notEqual(m.geom, geomVieja, 'se asigna una forma nueva, no se muta la anterior')
  assert.deepEqual(JSON.parse(JSON.stringify(geomVieja)), cuadrado(0, 0, 0.002))
  // La foto del historial se tomó ANTES de tocar nada, así que Cmd+Z devuelve las caras.
  assert.equal(e.instantaneas.length, 1)
  const foto = JSON.parse(e.instantaneas[0])
  assert.equal(foto.length, 1)
  assert.deepEqual(foto[0].caras, conCaras.caras)
  assert.equal(foto[0].carasN, 4)
})

test('un corte que no cruza la manzana no toca nada: ni foto ni caras', () => {
  const e = armarEdicion()
  const m = e.poner('m', cuadrado(0, 0, 0.002), conCaras)
  e.ctx.cortePuntos = [[0.005, -0.001], [0.005, 0.003]]
  vm.runInContext("dividir('m')", e.ctx)
  assert.equal(e.instantaneas.length, 0)
  assert.deepEqual(m.caras, conCaras.caras)
  assert.equal(m.carasN, 4)
  assert.equal(e.manzanas.size, 1)
  assert.match(e.avisos.at(-1), /no atravesó la manzana/)
})

test('fusionar deja la manzana resultante sin caras a mano', () => {
  const e = armarEdicion()
  const a = e.poner('a', cuadrado(0, 0), { orden: 1, ...conCaras })
  e.poner('b', cuadrado(0.001, 0), { orden: 2, caras: [[0, 1]], carasN: 4 })
  const geomVieja = a.geom
  e.ctx.paraFusionar = ['a', 'b']
  vm.runInContext('fusionar()', e.ctx)

  assert.deepEqual([...e.manzanas.keys()], ['a'])
  assert.equal('caras' in a, false)
  assert.equal('carasN' in a, false)
  assert.equal(a.editada, true)
  assert.notEqual(a.geom, geomVieja)
  assert.equal(e.instantaneas.length, 1)
  const foto = JSON.parse(e.instantaneas[0])
  assert.deepEqual(foto.map((x) => x.id), ['a', 'b'], 'la foto guarda las dos manzanas con sus caras')
  assert.deepEqual(foto[0].caras, conCaras.caras)
})

test('fusionar dos manzanas que no se tocan no saca la foto ni borra las caras', () => {
  const e = armarEdicion()
  const a = e.poner('a', cuadrado(0, 0), conCaras)
  e.poner('b', cuadrado(0.5, 0.5))
  e.ctx.paraFusionar = ['a', 'b']
  vm.runInContext('fusionar()', e.ctx)
  assert.equal(e.instantaneas.length, 0)
  assert.deepEqual(a.caras, conCaras.caras)
  assert.equal(e.manzanas.size, 2)
  assert.match(e.avisos.at(-1), /no se tocan/)
})

test('redibujar desde cero también suelta las caras de la forma que se deshace', () => {
  const redibujar = tramo("document.getElementById('bRedibujar').onclick", '// Insertar un territorio nuevo')
  assert.match(redibujar, /m\.geom = GEOM_ORIGINAL\.get\(m\.id\)[\s\S]*delete m\.caras[\s\S]*delete m\.carasN/)
})
