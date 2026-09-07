import assert from 'node:assert/strict'
import test from 'node:test'

import {
  decodeEditorDraftState,
  encodeEditorDraftState,
} from '../src/features/map-editor/model/draftCodec.ts'

const square = (offset = 0) => ({
  type: 'Polygon',
  coordinates: [[[offset, 0], [offset + 0.001, 0], [offset + 0.001, 0.001], [offset, 0],]],
})

const territories = [
  { id: '11111111-1111-4111-8111-111111111111', number: '1', sector: 'A' },
  { id: '22222222-2222-4222-8222-222222222222', number: '2', sector: 'B' },
]

const candidates = [
  { id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', sourceKey: 'm1', datasetVersion: 'dataset-1', geometry: square(), center: [0, 0], diagnostics: {} },
  { id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', sourceKey: 'm2', datasetVersion: 'dataset-1', geometry: square(0.002), center: [0, 0], diagnostics: {} },
  { id: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc', sourceKey: 'm3', datasetVersion: 'dataset-1', geometry: square(0.004), center: [0, 0], diagnostics: {} },
]

test('migra IDs legados a UUID sin perder geometría, caras ni mudanzas', () => {
  const decoded = decodeEditorDraftState({
    territorios: [
      { id: 't-uno', numero: '1', color: '#111111', letras: 'orden' },
      { id: 't-dos', numero: '2', color: '#222222', letras: 'orden' },
    ],
    asignacion: [['m1', 't-uno', 4], ['m2', 't-dos', 5]],
    editadas: [{ id: 'm1', geom: square(0.01) }],
    caras: [['m1', [[0, 1], [1, 2]], 3]],
    descartadas: ['m3'],
    revisadas: ['m2'],
    tocados: ['t-uno', 't-dos'],
  }, territories, candidates)

  assert.equal(decoded.migratedFromLegacy, true)
  const first = decoded.document.blocks['aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa']
  assert.equal(first.territoryId, territories[0].id)
  assert.deepEqual(first.geometry, square(0.01))
  assert.deepEqual(first.manualSideGroups, [[0, 1], [1, 2]])
  assert.deepEqual(decoded.document.touchedTerritoryIds, territories.map(({ id }) => id))
  assert.deepEqual(decoded.discardedSourceKeys, ['m3'])
  assert.deepEqual(decoded.reviewedBlockIds, ['bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'])
  assert.equal(decoded.document.blocks['cccccccc-cccc-4ccc-8ccc-cccccccccccc'], undefined)
})

test('conserva una manzana dibujada que no pertenece al dataset', () => {
  const decoded = decodeEditorDraftState({
    territorios: [{ id: 't-uno', numero: '1' }],
    asignacion: [['m-nueva', 't-uno', 1]],
    editadas: [{ id: 'm-nueva', geom: square(0.01) }],
  }, territories, candidates)
  const drawn = decoded.document.blocks['legacy:m-nueva']
  assert.equal(drawn.sourceKey, 'm-nueva')
  assert.equal(drawn.territoryId, territories[0].id)
  assert.equal(drawn.edited, true)
})

test('frena antes de perder una referencia territorial o candidata', () => {
  assert.throws(() => decodeEditorDraftState({
    territorios: [{ id: 'viejo', numero: '99' }],
  }, territories, candidates), /99 no tiene equivalente UUID/)

  assert.throws(() => decodeEditorDraftState({
    territorios: [{ id: 't-uno', numero: '1' }],
    asignacion: [['desaparecida', 't-uno']],
  }, territories, candidates), /desaparecida no existe/)
})

test('codifica v2 y lo vuelve a abrir sin cambiar el documento', () => {
  const first = decodeEditorDraftState({
    territorios: [{ id: 't-uno', numero: '1' }],
    asignacion: [['m1', 't-uno', 0]],
    tocados: ['t-uno'],
  }, territories, candidates)
  const encoded = encodeEditorDraftState(first)
  const reopened = decodeEditorDraftState(encoded, territories, candidates)
  assert.equal(encoded.schema_version, 2)
  assert.equal(reopened.migratedFromLegacy, false)
  assert.deepEqual(reopened, { ...first, migratedFromLegacy: false })
})
