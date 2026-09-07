import assert from 'node:assert/strict'
import test from 'node:test'

import {
  automaticSideGroups,
  groupsForBlock,
  offsetInside,
  polygonAreaSquareMeters,
  polygonCenter,
  polygonRingLatLng,
  sidesForBlock,
} from '../src/features/map-editor/geometry/blockGeometry.ts'

const rectangle = {
  type: 'Polygon',
  coordinates: [[
    [-68.536, -31.537],
    [-68.535, -31.537],
    [-68.535, -31.536],
    [-68.536, -31.536],
    [-68.536, -31.537],
  ]],
}

test('normaliza el anillo GeoJSON sin duplicar el punto de cierre', () => {
  assert.deepEqual(polygonRingLatLng(rectangle), [
    [-31.537, -68.536],
    [-31.537, -68.535],
    [-31.536, -68.535],
    [-31.536, -68.536],
  ])

  const open = { ...rectangle, coordinates: [rectangle.coordinates[0].slice(0, -1)] }
  assert.deepEqual(polygonRingLatLng(open), polygonRingLatLng(rectangle))
})

test('conserva el algoritmo legado de cuatro caras para un rectángulo', () => {
  assert.deepEqual(automaticSideGroups(rectangle), [[0, 1], [1, 2], [2, 3], [3, 0]])
  const sides = sidesForBlock({ geometry: rectangle })
  assert.equal(sides.length, 4)
  assert.ok(sides.every((side) => side.lengthMeters > 90))
  assert.deepEqual(sides.map((side) => side.indices), [[0, 1], [1, 2], [2, 3], [3, 0]])
})

test('agrupa vértices colineales igual que el editor anterior', () => {
  const redundant = {
    type: 'Polygon',
    coordinates: [[
      [-68.536, -31.537],
      [-68.5355, -31.537],
      [-68.535, -31.537],
      [-68.535, -31.536],
      [-68.536, -31.536],
      [-68.536, -31.537],
    ]],
  }
  assert.deepEqual(automaticSideGroups(redundant), [[0, 1, 2], [2, 3], [3, 4], [4, 0]])
})

test('usa caras manuales solo mientras coincida la cantidad de vértices', () => {
  const manual = [[0, 1, 2], [2, 3], [3, 0]]
  assert.deepEqual(
    groupsForBlock({ geometry: rectangle, manualSideGroups: manual, manualVertexCount: 4 }),
    manual,
  )
  assert.deepEqual(
    groupsForBlock({ geometry: rectangle, manualSideGroups: manual, manualVertexCount: 5 }),
    automaticSideGroups(rectangle),
  )
})

test('calcula área, centro y corrida interior sin mutar la geometría', () => {
  const before = structuredClone(rectangle)
  assert.ok(polygonAreaSquareMeters(rectangle) > 9_000)
  assert.deepEqual(polygonCenter(rectangle), [-31.5365, -68.5355])
  const ring = polygonRingLatLng(rectangle)
  const shifted = offsetInside(ring.slice(0, 2), polygonCenter(rectangle))
  assert.notDeepEqual(shifted, ring.slice(0, 2))
  assert.deepEqual(rectangle, before)
})

test('rechaza polígonos malformados antes de una edición', () => {
  assert.throws(() => polygonRingLatLng({ type: 'Polygon', coordinates: [[]] }), /tres vértices/)
  assert.throws(
    () => polygonRingLatLng({ type: 'Polygon', coordinates: [[[0, 0], [0, 0], [0, 0]]] }),
    /tres vértices distintos/,
  )
  assert.throws(
    () => polygonRingLatLng({ type: 'Polygon', coordinates: [[[181, 0], [0, 1], [0, 0]]] }),
    /fuera del rango/,
  )
})
