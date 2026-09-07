import test from 'node:test'
import assert from 'node:assert/strict'
import { linePoints } from '../src/lib/heatmapGeometry.ts'

test('convierte LineString [lng, lat] a puntos Leaflet [lat, lng]', () => {
  assert.deepEqual(
    linePoints({
      type: 'LineString',
      coordinates: [
        [-180, -90, 1],
        [-68.5364, -31.5375],
        [180, 90],
      ],
    }),
    [
      [-90, -180],
      [-31.5375, -68.5364],
      [90, 180],
    ],
  )
})

test('rechaza LineString sin al menos dos coordenadas', () => {
  for (const coordinates of [undefined, [], [[-68.5, -31.5]]]) {
    assert.equal(linePoints({ type: 'LineString', coordinates }), null)
  }
})

test('rechaza geometrías inválidas, valores no numéricos y rangos imposibles', () => {
  const invalidGeometries = [
    null,
    {},
    'LineString',
    { type: 'Point', coordinates: [-68.5, -31.5] },
    { type: 'LineString', coordinates: [['-68.5', '-31.5'], [-68, -31]] },
    { type: 'LineString', coordinates: [[Number.NaN, -31.5], [-68, -31]] },
    { type: 'LineString', coordinates: [[Number.POSITIVE_INFINITY, -31.5], [-68, -31]] },
    { type: 'LineString', coordinates: [[-68.5, Number.NEGATIVE_INFINITY], [-68, -31]] },
    { type: 'LineString', coordinates: [[180.001, -31.5], [-68, -31]] },
    { type: 'LineString', coordinates: [[-68.5, 90.001], [-68, -31]] },
  ]

  for (const geometry of invalidGeometries) {
    assert.equal(linePoints(geometry), null)
  }
})
