import assert from 'node:assert/strict'
import test from 'node:test'
import { area } from '@turf/area'

import {
  mergeAdjacentPolygons,
  splitPolygonByLine,
} from '../src/features/map-editor/geometry/polygonOperations.ts'

const leftBlock = {
  type: 'Polygon',
  coordinates: [[
    [0, 0],
    [1, 0],
    [1, 1],
    [0, 1],
    [0, 0],
  ]],
}

const rightBlock = {
  type: 'Polygon',
  coordinates: [[
    [1, 0],
    [2, 0],
    [2, 1],
    [1, 1],
    [1, 0],
  ]],
}

test('fusiona dos polígonos vecinos en un único polígono y no muta entradas', () => {
  const firstBefore = structuredClone(leftBlock)
  const secondBefore = structuredClone(rightBlock)
  const merged = mergeAdjacentPolygons(leftBlock, rightBlock)

  assert.equal(merged.type, 'Polygon')
  assert.equal(merged.coordinates.length, 1)
  assert.ok(area({ type: 'Feature', properties: {}, geometry: merged }) > area({
    type: 'Feature',
    properties: {},
    geometry: leftBlock,
  }))
  assert.deepEqual(leftBlock, firstBefore)
  assert.deepEqual(rightBlock, secondBefore)
})

test('rechaza fusionar polígonos separados o superpuestos', () => {
  const separated = {
    ...rightBlock,
    coordinates: [[
      [3, 0],
      [4, 0],
      [4, 1],
      [3, 1],
      [3, 0],
    ]],
  }
  const overlapping = {
    ...rightBlock,
    coordinates: [[
      [0.5, 0],
      [1.5, 0],
      [1.5, 1],
      [0.5, 1],
      [0.5, 0],
    ]],
  }

  assert.throws(
    () => mergeAdjacentPolygons(leftBlock, separated),
    /no son vecinas: la unión queda separada/,
  )
  assert.throws(
    () => mergeAdjacentPolygons(leftBlock, overlapping),
    /No se pueden fusionar polígonos que se superponen/,
  )
})

test('divide por la recta de dos puntos, conserva el área y no muta el polígono', () => {
  const before = structuredClone(leftBlock)
  const [first, second] = splitPolygonByLine(leftBlock, [0.5, -1], [0.5, 2])
  const sourceArea = area({ type: 'Feature', properties: {}, geometry: leftBlock })
  const firstArea = area({ type: 'Feature', properties: {}, geometry: first })
  const secondArea = area({ type: 'Feature', properties: {}, geometry: second })

  assert.equal(first.type, 'Polygon')
  assert.equal(second.type, 'Polygon')
  assert.ok(firstArea > 0)
  assert.ok(secondArea > 0)
  assert.ok(Math.abs(firstArea - secondArea) / sourceArea < 1e-8)
  assert.ok(Math.abs(firstArea + secondArea - sourceArea) / sourceArea < 1e-8)
  assert.deepEqual(leftBlock, before)
})

test('rechaza una línea de corte degenerada o que no atraviesa el polígono', () => {
  assert.throws(
    () => splitPolygonByLine(leftBlock, [0, 0], [0, 0]),
    /necesita dos puntos distintos/,
  )
  assert.throws(
    () => splitPolygonByLine(leftBlock, [3, -1], [3, 2]),
    /no produjo una geometría; el corte no atravesó el polígono/,
  )
})
