import assert from 'node:assert/strict'
import test from 'node:test'

import {
  discardEditorDraft,
  loadEditorCandidates,
  readEditorDraft,
  saveEditorDraft,
} from '../src/features/map-editor/data/editorRepository.ts'

const geometry = {
  type: 'Polygon',
  coordinates: [[[0, 0], [0.001, 0], [0, 0.001], [0, 0]]],
}

function candidate(index, version = 'v1') {
  return {
    id: `uuid-${index}`,
    source_key: `m${index}`,
    dataset_version: version,
    geometry_geojson: geometry,
    centro_lat: 0.0003,
    centro_lng: 0.0003,
    diagnostics: { vertex_count: 3 },
  }
}

test('pagina candidatas por viewport y conserva la versión única', async () => {
  const calls = []
  const transport = {
    async queryCandidates(viewport, from, to) {
      calls.push({ viewport, from, to })
      return { data: from === 0 ? Array.from({ length: 500 }, (_, index) => candidate(index)) : [candidate(500)], error: null }
    },
    async callRpc() { throw new Error('no corresponde') },
  }
  const rows = await loadEditorCandidates(transport, { west: -1, south: -1, east: 1, north: 1 })
  assert.equal(rows.length, 501)
  assert.deepEqual(calls.map(({ from, to }) => [from, to]), [[0, 499], [500, 999]])
  assert.equal(rows[0].sourceKey, 'm0')
})

test('rechaza encuadres y datasets activos ambiguos', async () => {
  const invalidTransport = {
    async queryCandidates() { return { data: [candidate(1, 'v1'), candidate(2, 'v2')], error: null } },
    async callRpc() { throw new Error('no corresponde') },
  }
  await assert.rejects(
    () => loadEditorCandidates(invalidTransport, { west: 2, south: 0, east: 1, north: 1 }),
    /encuadre/,
  )
  await assert.rejects(
    () => loadEditorCandidates(invalidTransport, { west: -1, south: -1, east: 1, north: 1 }),
    /más de una versión/,
  )
})

test('lee y guarda borradores usando la revisión recibida', async () => {
  const calls = []
  const transport = {
    async queryCandidates() { throw new Error('no corresponde') },
    async callRpc(name, args) {
      calls.push({ name, args })
      return { data: { revision: name === 'leer_borrador_editor' ? 4 : 5, estado: { valor: 1 }, actualizado_at: '2026-09-07T00:00:00Z' }, error: null }
    },
  }
  assert.equal((await readEditorDraft(transport)).revision, 4)
  assert.equal((await saveEditorDraft(transport, 4, { valor: 1 })).revision, 5)
  assert.deepEqual(calls[1], { name: 'guardar_borrador_editor', args: { p_revision: 4, p_estado: { valor: 1 } } })
})

test('traduce el conflicto serializable a un mensaje accionable', async () => {
  const transport = {
    async queryCandidates() { throw new Error('no corresponde') },
    async callRpc() { return { data: null, error: { code: '40001', message: 'serialization_failure' } } },
  }
  await assert.rejects(() => saveEditorDraft(transport, 1, { valor: 1 }), /Otra persona guardó/)
  await assert.rejects(() => discardEditorDraft(transport, 1), /Otra persona guardó/)
})
