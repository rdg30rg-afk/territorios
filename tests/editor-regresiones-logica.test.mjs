import assert from 'node:assert/strict'
import test from 'node:test'

import {
  assignBlocks,
  createEditorDocument,
  mergeBlocks,
  setManualSideGroups,
  splitBlock,
} from '../src/features/map-editor/model/editorDocument.ts'

const square = {
  type: 'Polygon',
  coordinates: [[[0, 0], [0.001, 0], [0.001, 0.001], [0, 0.001], [0, 0]]],
}

const triangle = {
  type: 'Polygon',
  coordinates: [[[0, 0], [0.001, 0], [0, 0.001], [0, 0]]],
}

function documentFixture(blocks) {
  return createEditorDocument(
    [{ id: 'territory-a', number: '1' }, { id: 'territory-b', number: '2' }],
    blocks,
  )
}

test('asignar una manzana a un territorio con letra a existente evita etiquetas repetidas', () => {
  const document = documentFixture([
    { id: 'block-source', territoryId: 'territory-a', geometry: square, label: 'a', order: 0 },
    { id: 'block-destination', territoryId: 'territory-b', geometry: triangle, label: 'a', order: 0 },
  ])

  const moved = assignBlocks(document, ['block-source'], 'territory-b')
  const destinationLabels = Object.values(moved.blocks)
    .filter((block) => block.territoryId === 'territory-b')
    .map((block) => block.label)

  assert.equal(moved.blocks['block-source'].label, 'b')
  assert.equal(new Set(destinationLabels).size, destinationLabels.length)
  assert.deepEqual(document.blocks['block-source'], {
    id: 'block-source',
    territoryId: 'territory-a',
    geometry: square,
    label: 'a',
    order: 0,
  })
})

test('la corrección manual rechaza un grupo que salta una arista del cuadrado', () => {
  const document = documentFixture([
    {
      id: 'block-square',
      territoryId: 'territory-a',
      geometry: square,
      manualSideGroups: [[0, 1], [1, 2]],
      manualVertexCount: 4,
    },
  ])
  const before = structuredClone(document)

  assert.throws(
    () => setManualSideGroups(document, 'block-square', [[0, 1, 3]]),
    /vértices inválidos/,
  )
  assert.deepEqual(document, before)
})

test('la corrección manual acepta grupos contiguos en el sentido circular del anillo', () => {
  const document = documentFixture([
    { id: 'block-square', territoryId: 'territory-a', geometry: square },
  ])
  const groups = [[3, 0, 1], [1, 2], [2, 3]]

  const corrected = setManualSideGroups(document, 'block-square', groups)

  assert.deepEqual(corrected.blocks['block-square'].manualSideGroups, groups)
  assert.equal(corrected.blocks['block-square'].manualVertexCount, 4)
  assert.deepEqual(corrected.touchedTerritoryIds, ['territory-a'])
})

test('fusionar manzanas de territorios distintos rechaza sin mutar el documento', () => {
  const document = documentFixture([
    { id: 'block-a', territoryId: 'territory-a', geometry: square, label: 'a', order: 0 },
    { id: 'block-b', territoryId: 'territory-b', geometry: triangle, label: 'a', order: 0 },
  ])
  const before = structuredClone(document)

  assert.throws(
    () => mergeBlocks(document, 'block-a', 'block-b', square),
    /mismo territorio/,
  )
  assert.deepEqual(document, before)
})

test('dividir una manzana invalida sus caras y marca su territorio como pendiente', () => {
  const document = documentFixture([
    {
      id: 'block-original',
      territoryId: 'territory-a',
      geometry: square,
      label: 'a',
      order: 0,
      manualSideGroups: [[0, 1], [1, 2], [2, 3], [3, 0]],
      manualVertexCount: 4,
    },
  ])
  const before = structuredClone(document)

  const divided = splitBlock(document, 'block-original', 'block-new', [triangle, square])

  assert.equal(divided.blocks['block-original'].manualSideGroups, null)
  assert.equal(divided.blocks['block-original'].manualVertexCount, null)
  assert.equal(divided.blocks['block-new'].manualSideGroups, null)
  assert.equal(divided.blocks['block-new'].manualVertexCount, null)
  assert.equal(divided.blocks['block-original'].territoryId, 'territory-a')
  assert.equal(divided.blocks['block-new'].territoryId, 'territory-a')
  assert.deepEqual(divided.touchedTerritoryIds, ['territory-a'])
  assert.deepEqual(document, before)
})
