import assert from 'node:assert/strict'
import test from 'node:test'
import { resumirManzana, avanceDeManzanas } from '../src/lib/estadoManzana.ts'

test('no accesible y para revisitar no son «te falta»', () => {
  const e = { a: 'recorrido', b: 'no_accesible', c: 'revisitar' }
  const r = resumirManzana(['a', 'b', 'c'], e)
  assert.equal(r.tipo, 'aparte'); assert.equal(r.aparte, 'revisitar')
  assert.equal(resumirManzana(['b', 'b2'], { b: 'no_accesible', b2: 'no_accesible' }).aparte, 'no_accesible')
})
test('completa, media y falta', () => {
  assert.equal(resumirManzana(['a', 'b'], { a: 'recorrido', b: 'recorrido' }).tipo, 'completa')
  assert.equal(resumirManzana(['a', 'b'], { a: 'recorrido' }).tipo, 'media')
  assert.equal(resumirManzana(['a', 'b'], {}).tipo, 'falta')
  assert.equal(resumirManzana([], {}).tipo, 'falta')
})
test('un territorio con un barrio cerrado llega a faltan 0', () => {
  const r = [
    resumirManzana(['a'], { a: 'recorrido' }),
    resumirManzana(['b', 'c'], { b: 'no_accesible', c: 'no_accesible' }),
  ]
  assert.deepEqual(avanceDeManzanas(r), { completas: 1, aparte: 1, empezadas: 0, faltan: 0 })
})
test('«Sin dato» sobre la manzana entera la devuelve a faltar', () => {
  const r = resumirManzana(['b', 'c'], { b: 'sin_dato', c: 'sin_dato' })
  assert.equal(r.tipo, 'falta')
})
