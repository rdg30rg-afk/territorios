import test from 'node:test'
import assert from 'node:assert/strict'
import { ordenarTerritorios } from '../src/lib/ordenarTerritorios.ts'

const nombres = (lista) => ordenarTerritorios(lista.map((name) => ({ name }))).map((t) => t.name)

test('ordena por número y no como texto: el 9 va antes que el 10', () => {
  assert.deepEqual(nombres(['10', '9', '2', '69', '1']), ['1', '2', '9', '10', '69'])
})

test('el desorden real de la base queda en orden', () => {
  // Lo que mostraba el selector de cobertura, tal cual.
  assert.deepEqual(
    nombres(['66', '37', '58', '2', '3', '27', '54', '50', '49']),
    ['2', '3', '27', '37', '49', '50', '54', '58', '66'],
  )
})

test('lo que no empieza con número va al final, no entre medio', () => {
  const orden = nombres(['12', 'QA DEV dff41e61', '3', 'Centro'])
  assert.deepEqual(orden, ['3', '12', 'Centro', 'QA DEV dff41e61'])
})

test('mismo número: el escueto primero', () => {
  assert.deepEqual(nombres(['12 bis', '12']), ['12', '12 bis'])
})

test('no toca el arreglo que recibe', () => {
  const original = [{ name: '9' }, { name: '1' }]
  ordenarTerritorios(original)
  assert.deepEqual(original.map((t) => t.name), ['9', '1'])
})
