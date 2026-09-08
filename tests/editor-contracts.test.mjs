import assert from 'node:assert/strict'
import test from 'node:test'

import {
  publishEditorPublicationV2,
  readEditorDraft,
  reviewEditorPublicationV2,
  saveEditorDraft,
} from '../src/features/map-editor/data/editorRepository.ts'
import { assignBlocks, createEditorDocument } from '../src/features/map-editor/model/editorDocument.ts'
import {
  buildAtomicPublicationV2,
  createPublicationSnapshot,
} from '../src/features/map-editor/model/publication.ts'

const territoryA = '11111111-1111-4111-8111-111111111111'
const territoryB = '22222222-2222-4222-8222-222222222222'
const square = {
  type: 'Polygon',
  coordinates: [[[-68.536, -31.537], [-68.535, -31.537], [-68.535, -31.536], [-68.536, -31.536], [-68.536, -31.537]]],
}

function emptyTransport(callRpc) {
  return {
    queryCandidates: async () => ({ data: [], error: null }),
    queryAllCandidates: async () => ({ data: [], error: null }),
    callRpc,
  }
}

test('lee y guarda el borrador pasando la revisión confirmada al siguiente guardado', async () => {
  const calls = []
  const transport = emptyTransport(async (name, args) => {
    calls.push({ name, args })
    if (name === 'leer_borrador_editor') {
      return {
        data: { revision: 3, estado: { schema_version: 2, valor: 'base' }, actualizado_por: 'actor-a', actualizado_at: '2026-09-08T00:00:00Z' },
        error: null,
      }
    }
    return {
      data: { revision: 4, estado: args.p_estado, actualizado_por: 'actor-b', actualizado_at: '2026-09-08T00:01:00Z' },
      error: null,
    }
  })

  const draft = await readEditorDraft(transport)
  const saved = await saveEditorDraft(transport, draft.revision, { schema_version: 2, valor: 'nuevo' })

  assert.equal(draft.revision, 3)
  assert.equal(saved.revision, 4)
  assert.deepEqual(calls, [
    { name: 'leer_borrador_editor', args: undefined },
    { name: 'guardar_borrador_editor', args: { p_revision: 3, p_estado: { schema_version: 2, valor: 'nuevo' } } },
  ])
})

test('un conflicto de revisión del borrador detiene el guardado y no reintenta', async () => {
  let calls = 0
  const transport = emptyTransport(async () => {
    calls += 1
    return { data: null, error: { code: '40001', message: 'El borrador cambió desde que lo abriste' } }
  })

  await assert.rejects(
    () => saveEditorDraft(transport, 3, { schema_version: 2 }),
    /Otra persona guardó el editor después que vos/,
  )
  assert.equal(calls, 1)
})

test('prepara, revisa y publica un lote v2 por UUID mediante el transport mock', async () => {
  const document = createEditorDocument(
    [{ id: territoryA, number: '57' }, { id: territoryB, number: '58' }],
    [{ id: 'block-a', territoryId: territoryA, geometry: square, label: 'A', order: 0 }],
  )
  const moved = assignBlocks(document, ['block-a'], territoryB)
  const snapshots = createPublicationSnapshot(moved, territoryB)
  const calls = []
  const transport = emptyTransport(async (name, args) => {
    calls.push({ name, args })
    if (name === 'revisar_publicacion_editor_v2') {
      assert.deepEqual(args, { p_territory_ids: [territoryB, territoryA] })
      return {
        data: [
          { territory_id: territoryB, version: 8, manzanas_vigentes: 1 },
          { territory_id: territoryA, version: 12, manzanas_vigentes: 0 },
        ],
        error: null,
      }
    }
    assert.equal(name, 'publicar_territorios_atomico_v2')
    return {
      data: [
        { territory_id: territoryB, version: 9, manzanas: 1 },
        { territory_id: territoryA, version: 13, manzanas: 0 },
      ],
      error: null,
    }
  })

  const reviewed = await reviewEditorPublicationV2(
    transport,
    snapshots.map((snapshot) => snapshot.territoryId),
  )
  const batch = buildAtomicPublicationV2(snapshots, reviewed)
  const operationId = '33333333-3333-4333-8333-333333333333'
  const published = await publishEditorPublicationV2(transport, operationId, batch)

  assert.deepEqual(batch.map((item) => [item.territory_id, item.version_esperada]), [
    [territoryB, 8],
    [territoryA, 12],
  ])
  assert.equal(Object.hasOwn(batch[0], 'nombre'), false)
  assert.equal(batch[0].manzanas[0].lados.length, 4)
  assert.deepEqual(calls[1], {
    name: 'publicar_territorios_atomico_v2',
    args: { p_operation_id: operationId, p_cambios: batch },
  })
  assert.deepEqual(published.map((item) => item.territory_id), [territoryB, territoryA])
})

test('un conflicto de publicación v2 queda separado del conflicto de borrador', async () => {
  const transport = emptyTransport(async () => ({
    data: null,
    error: { code: '40001', message: 'El territorio UUID cambió desde la revisión' },
  }))

  await assert.rejects(
    () => publishEditorPublicationV2(transport, '33333333-3333-4333-8333-333333333333', [{ territory_id: territoryA, version_esperada: 1, manzanas: [] }]),
    /Un territorio cambió mientras revisabas la publicación/,
  )
})
