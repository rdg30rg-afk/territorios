import assert from 'node:assert/strict'
import test from 'node:test'

import {
  createSupabaseEditorTransport,
  discardEditorDraft,
  loadAllEditorCandidates,
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

test('pagina todas las candidatas activas sin filtro de viewport', async () => {
  const calls = []
  const signal = new AbortController().signal
  const transport = {
    async queryAllCandidates(from, to, receivedSignal) {
      calls.push({ from, to, signal: receivedSignal })
      return { data: from === 0 ? Array.from({ length: 500 }, (_, index) => candidate(index)) : [candidate(500)], error: null }
    },
    async queryCandidates() { throw new Error('no corresponde') },
    async callRpc() { throw new Error('no corresponde') },
  }
  const rows = await loadAllEditorCandidates(transport, signal)
  assert.equal(rows.length, 501)
  assert.deepEqual(calls.map(({ from, to }) => [from, to]), [[0, 499], [500, 999]])
  assert.ok(calls.every((call) => call.signal === signal))
  assert.equal(rows[500].sourceKey, 'm500')
})

test('la carga completa valida filas, versión única y cancelación', async () => {
  const transport = {
    async queryAllCandidates() {
      return { data: [candidate(1, 'v1'), candidate(2, 'v2')], error: null }
    },
    async queryCandidates() { throw new Error('no corresponde') },
    async callRpc() { throw new Error('no corresponde') },
  }
  await assert.rejects(() => loadAllEditorCandidates(transport), /más de una versión/)

  const invalidRows = {
    ...transport,
    async queryAllCandidates() { return { data: [{ ...candidate(1), source_key: '' }], error: null } },
  }
  await assert.rejects(() => loadAllEditorCandidates(invalidRows), /candidata incompleta/)

  const controller = new AbortController()
  controller.abort()
  let queried = false
  const cancelled = {
    ...transport,
    async queryAllCandidates() { queried = true; return { data: [], error: null } },
  }
  await assert.rejects(
    () => loadAllEditorCandidates(cancelled, controller.signal),
    (error) => error instanceof DOMException && error.name === 'AbortError',
  )
  assert.equal(queried, false)
})

test('el transport consulta todas las candidatas con columnas, orden, rango y AbortSignal', async () => {
  const calls = []
  const result = { data: [candidate(1)], error: null }
  const query = {
    select(columns) { calls.push(['select', columns]); return this },
    eq(column, value) { calls.push(['eq', column, value]); return this },
    order(column) { calls.push(['order', column]); return this },
    range(from, to) { calls.push(['range', from, to]); return this },
    abortSignal(signal) { calls.push(['abortSignal', signal]); return Promise.resolve(result) },
  }
  const client = {
    from(table) { calls.push(['from', table]); return query },
  }
  const signal = new AbortController().signal
  const response = await createSupabaseEditorTransport(client).queryAllCandidates(500, 999, signal)
  assert.deepEqual(response, result)
  assert.deepEqual(calls, [
    ['from', 'manzana_candidatas'],
    ['select', 'id, source_key, dataset_version, geometry_geojson, centro_lat, centro_lng, diagnostics'],
    ['eq', 'activa', true],
    ['order', 'source_key'],
    ['range', 500, 999],
    ['abortSignal', signal],
  ])
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
