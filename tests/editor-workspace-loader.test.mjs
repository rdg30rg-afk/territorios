import assert from 'node:assert/strict'
import test from 'node:test'

import { loadEditorWorkspace } from '../src/features/map-editor/data/loadEditorWorkspace.ts'

const geometry = {
  type: 'Polygon',
  coordinates: [[[0, 0], [0.001, 0], [0, 0.001], [0, 0]]],
}
const territory = { id: '11111111-1111-4111-8111-111111111111', number: '1' }
const candidate = {
  id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
  source_key: 'm1',
  dataset_version: 'v1',
  geometry_geojson: geometry,
  centro_lat: 0,
  centro_lng: 0,
  diagnostics: {},
}

function transportWithState(state) {
  return {
    async queryAllCandidates(from) { return { data: from === 0 ? [candidate] : [], error: null } },
    async queryCandidates() { throw new Error('no corresponde') },
    async callRpc(name) {
      assert.equal(name, 'leer_borrador_editor')
      return {
        data: { revision: 7, estado: state, actualizado_por: 'actor', actualizado_at: '2026-09-07T00:00:00Z' },
        error: null,
      }
    },
  }
}

test('carga dataset y borrador juntos y migra el estado legacy', async () => {
  const workspace = await loadEditorWorkspace(transportWithState({
    territorios: [{ id: 't1', numero: '1' }],
    asignacion: [['m1', 't1', 0]],
  }), [territory])
  assert.equal(workspace.revision, 7)
  assert.equal(workspace.updatedBy, 'actor')
  assert.equal(workspace.draft.migratedFromLegacy, true)
  assert.equal(workspace.draft.document.blocks[candidate.id].territoryId, territory.id)
})

test('un borrador ausente no se reemplaza silenciosamente por uno vacío', async () => {
  await assert.rejects(
    () => loadEditorWorkspace(transportWithState(null), [territory]),
    /No hay un borrador compartido/,
  )
})

test('una cancelación posterior a la RPC impide entregar estado viejo', async () => {
  const controller = new AbortController()
  const transport = transportWithState({ territorios: [{ id: 't1', numero: '1' }] })
  const originalRpc = transport.callRpc
  transport.callRpc = async (...args) => {
    const result = await originalRpc(...args)
    controller.abort()
    return result
  }
  await assert.rejects(
    () => loadEditorWorkspace(transport, [territory], controller.signal),
    (error) => error instanceof DOMException && error.name === 'AbortError',
  )
})
