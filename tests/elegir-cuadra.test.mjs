import assert from 'node:assert/strict'
import test from 'node:test'
import { elegirManzana, elegirCuadra, puntoEnPoligono } from '../src/lib/elegirCuadra.ts'

const cuadrado = (x, y, l) => [{ x, y }, { x: x + l, y }, { x: x + l, y: y + l }, { x, y: y + l }]
test('adentro de la manzana, es esa', () => {
  assert.ok(puntoEnPoligono({ x: 5, y: 5 }, cuadrado(0, 0, 10)))
  assert.equal(elegirManzana({ x: 5, y: 5 }, [{ item: 'A', anillo: cuadrado(0, 0, 10) }]), 'A')
})
test('en la calle elige la manzana con el borde más cerca, dentro de la tolerancia', () => {
  const c = [{ item: 'A', anillo: cuadrado(0, 0, 100) }, { item: 'B', anillo: cuadrado(120, 0, 100) }]
  assert.equal(elegirManzana({ x: 105, y: 50 }, c), 'A')
  assert.equal(elegirManzana({ x: 115, y: 50 }, c), 'B')
  assert.equal(elegirManzana({ x: 110, y: 400 }, c), null)
})
test('elige la cuadra más cercana al clic', () => {
  const c = [{ item: 1, linea: [{ x: 0, y: 0 }, { x: 100, y: 0 }] }, { item: 2, linea: [{ x: 0, y: 20 }, { x: 100, y: 20 }] }]
  assert.equal(elegirCuadra({ x: 50, y: 4 }, c), 1)
  assert.equal(elegirCuadra({ x: 50, y: 16 }, c), 2)
  assert.equal(elegirCuadra({ x: 50, y: 200 }, c), null)
})
