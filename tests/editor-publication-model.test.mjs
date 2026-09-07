import assert from 'node:assert/strict'
import test from 'node:test'

import { assignBlocks, createEditorDocument } from '../src/features/map-editor/model/editorDocument.ts'
import {
  buildAtomicPublication,
  createPublicationSnapshot,
  publicationStillMatches,
} from '../src/features/map-editor/model/publication.ts'

const square = {
  type: 'Polygon',
  coordinates: [[[-68.536, -31.537], [-68.535, -31.537], [-68.535, -31.536], [-68.536, -31.536], [-68.536, -31.537]]],
}

function fixture() {
  return createEditorDocument(
    [{ id: 't1', number: '57' }, { id: 't2', number: '58' }],
    [{ id: 'b1', territoryId: 't1', geometry: square, label: 'A', order: 0 }],
  )
}

test('una mudanza publica destino y origen vacío en el mismo snapshot', () => {
  const moved = assignBlocks(fixture(), ['b1'], 't2')
  const snapshots = createPublicationSnapshot(moved, 't2')
  assert.deepEqual(snapshots.map((item) => item.name), ['58', '57'])
  assert.equal(snapshots[0].blocks.length, 1)
  assert.deepEqual(snapshots[1].blocks, [])
})

test('prepara geometría, área y cuatro lados sin mutar el documento', () => {
  const document = fixture()
  const before = structuredClone(document)
  const [snapshot] = createPublicationSnapshot(document, 't1')
  assert.equal(snapshot.blocks[0].label, 'A')
  assert.equal(snapshot.blocks[0].lados.length, 4)
  assert.ok(snapshot.blocks[0].area_m2 > 9_000)
  assert.deepEqual(document, before)
})

test('arma el lote solo con versiones enteras verificadas', () => {
  const snapshots = createPublicationSnapshot(fixture(), 't1')
  const batch = buildAtomicPublication(snapshots, [{ nombre: '57', version: 9 }])
  assert.equal(batch[0].version_esperada, 9)
  assert.equal(batch[0].manzanas.length, 1)
  assert.throws(() => buildAtomicPublication(snapshots, []), /territorio 57/)
})

test('detecta ediciones posteriores a la foto confirmada', () => {
  const document = fixture()
  const [snapshot] = createPublicationSnapshot(document, 't1')
  assert.equal(publicationStillMatches(document, snapshot), true)
  const moved = assignBlocks(document, ['b1'], 't2')
  assert.equal(publicationStillMatches(moved, snapshot), false)
})

test('rechaza una manzana sin letra antes de generar el lote', () => {
  const document = createEditorDocument(
    [{ id: 't1', number: '57' }],
    [{ id: 'b1', territoryId: 't1', geometry: square }],
  )
  assert.throws(() => createPublicationSnapshot(document, 't1'), /no tiene letra/)
})
