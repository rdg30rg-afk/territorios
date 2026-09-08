import assert from 'node:assert/strict'
import test from 'node:test'

import {
  addBlock,
  assignBlocks,
  commitEditorChange,
  createEditorDocument,
  createEditorHistory,
  mergeBlocks,
  redoEditorChange,
  relabelTerritoryBlocks,
  removeBlock,
  setManualSideGroups,
  splitBlock,
  undoEditorChange,
  updateBlockGeometry,
} from '../src/features/map-editor/model/editorDocument.ts'

const square = {
  type: 'Polygon',
  coordinates: [[[0, 0], [0.001, 0], [0.001, 0.001], [0, 0.001], [0, 0]]],
}
const triangle = {
  type: 'Polygon',
  coordinates: [[[0, 0], [0.001, 0], [0, 0.001], [0, 0]]],
}

function fixture() {
  return createEditorDocument(
    [{ id: 't1', number: '1' }, { id: 't2', number: '2' }],
    [{ id: 'b1', geometry: square, territoryId: 't1', manualSideGroups: [[0, 1], [1, 2]], manualVertexCount: 4 }],
  )
}

test('mover una manzana marca origen y destino sin mutar el documento anterior', () => {
  const original = fixture()
  const moved = assignBlocks(original, ['b1'], 't2')
  assert.equal(moved.blocks.b1.territoryId, 't2')
  assert.deepEqual(moved.touchedTerritoryIds, ['t1', 't2'])
  assert.equal(original.blocks.b1.territoryId, 't1')
  assert.deepEqual(original.touchedTerritoryIds, [])
})

test('una asignación idéntica no crea historia ni falsos pendientes', () => {
  const original = fixture()
  assert.equal(assignBlocks(original, ['b1'], 't1'), original)
  const history = createEditorHistory(original)
  assert.equal(commitEditorChange(history, (document) => assignBlocks(document, ['b1'], 't1')), history)
})

test('cambiar la cantidad de vértices invalida las caras manuales', () => {
  const changed = updateBlockGeometry(fixture(), 'b1', triangle)
  assert.equal(changed.blocks.b1.manualSideGroups, null)
  assert.equal(changed.blocks.b1.manualVertexCount, null)
  assert.deepEqual(changed.touchedTerritoryIds, ['t1'])
})

test('una corrección manual válida queda ligada a la cantidad de vértices', () => {
  const changed = setManualSideGroups(fixture(), 'b1', [[0, 1, 2], [2, 3, 0]])
  assert.deepEqual(changed.blocks.b1.manualSideGroups, [[0, 1, 2], [2, 3, 0]])
  assert.equal(changed.blocks.b1.manualVertexCount, 4)
  assert.throws(() => setManualSideGroups(fixture(), 'b1', [[0, 9]]), /vértices inválidos/)
})

test('retirar una manzana conserva el territorio de origen como pendiente', () => {
  const changed = removeBlock(fixture(), 'b1')
  assert.equal(changed.blocks.b1, undefined)
  assert.deepEqual(changed.touchedTerritoryIds, ['t1'])
})

test('deshacer y rehacer recorren documentos completos', () => {
  const first = createEditorHistory(fixture())
  const second = commitEditorChange(first, (document) => assignBlocks(document, ['b1'], 't2'))
  const undone = undoEditorChange(second)
  assert.equal(undone.present.blocks.b1.territoryId, 't1')
  assert.equal(undone.future.length, 1)
  const redone = redoEditorChange(undone)
  assert.equal(redone.present.blocks.b1.territoryId, 't2')
  assert.equal(redone.future.length, 0)
})

test('rechaza referencias inexistentes antes de modificar el estado', () => {
  assert.throws(() => assignBlocks(fixture(), ['b1'], 't9'), /No existe el territorio/)
  assert.throws(() => assignBlocks(fixture(), ['b9'], 't2'), /No existe la manzana/)
})

test('agregar, fusionar y dividir son comandos inmutables y auditables por territorio', () => {
  const original = fixture()
  const withSecond = addBlock(original, {
    id: 'b2',
    geometry: triangle,
    territoryId: 't1',
    label: 'b',
    order: 1,
  })
  assert.equal(original.blocks.b2, undefined)
  assert.equal(withSecond.blocks.b2.edited, true)

  const merged = mergeBlocks(withSecond, 'b1', 'b2', square)
  assert.equal(merged.blocks.b2, undefined)
  assert.equal(merged.blocks.b1.manualSideGroups, null)
  assert.deepEqual(merged.touchedTerritoryIds, ['t1'])

  const divided = splitBlock(merged, 'b1', 'b3', [triangle, square])
  assert.equal(divided.blocks.b3.sourceKey, null)
  assert.equal(divided.blocks.b3.territoryId, 't1')
  assert.equal(divided.blocks.b3.label, null)
  assert.equal(merged.blocks.b3, undefined)
})

test('reletrar exige el conjunto completo y conserva el orden elegido', () => {
  const document = addBlock(fixture(), {
    id: 'b2',
    geometry: triangle,
    territoryId: 't1',
  })
  const relabeled = relabelTerritoryBlocks(document, 't1', ['b2', 'b1'])
  assert.equal(relabeled.blocks.b2.label, 'a')
  assert.equal(relabeled.blocks.b2.order, 0)
  assert.equal(relabeled.blocks.b1.label, 'b')
  assert.equal(relabeled.blocks.b1.order, 1)
  assert.throws(() => relabelTerritoryBlocks(document, 't1', ['b1']), /cada manzana/)
})
