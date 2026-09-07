import test from 'node:test'
import assert from 'node:assert/strict'
import { sePuedeLlegar } from '../src/lib/comoLlegar.ts'

test('21: una salida SG no tiene cómo llegar aunque tenga texto', () => {
  assert.equal(
    sePuedeLlegar({ tipo: 'grupos', lat: null, lng: null }),
    false,
  )
  assert.equal(
    sePuedeLlegar({ tipo: 'grupos', lat: -31.5, lng: -68.5 }),
    false,
  )
})

test('23: especial o asamblea solo si hay GPS', () => {
  assert.equal(sePuedeLlegar({ tipo: 'especial', lat: null, lng: null }), false)
  assert.equal(sePuedeLlegar({ tipo: 'asamblea', lat: -31.5, lng: -68.5 }), true)
  assert.equal(sePuedeLlegar({ tipo: 'telefonica', lat: -31.5, lng: -68.5 }), false)
})

test('nunca se abre Maps con un lugar escrito y sin coordenadas', () => {
  assert.equal(sePuedeLlegar({ tipo: null, lat: null, lng: null }), false)
  assert.equal(sePuedeLlegar({ tipo: null, lat: -31.54, lng: -68.53 }), true)
})
