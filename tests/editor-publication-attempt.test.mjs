import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'
import vm from 'node:vm'
import ts from 'typescript'

import { publishEditorPublicationV2 } from '../src/features/map-editor/data/editorRepository.ts'

const source = await readFile(
  new URL('../src/features/map-editor/data/publicationAttempt.ts', import.meta.url),
  'utf8',
)
const code = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.CommonJS },
}).outputText
const moduleExports = {}
vm.runInNewContext(code, { exports: moduleExports })
const { publicationAttemptStore } = moduleExports

class MemoryStorage {
  constructor() {
    this.values = new Map()
  }

  getItem(key) {
    return this.values.get(key) ?? null
  }

  setItem(key, value) {
    this.values.set(key, value)
  }

  removeItem(key) {
    this.values.delete(key)
  }
}

function attempt(operationId, territoryId = 'territory-a') {
  return {
    operationId,
    changes: [{
      territory_id: territoryId,
      version_esperada: 7,
      manzanas: [{
        label: 'a',
        orden: 0,
        geom: { type: 'Polygon', coordinates: [[[0, 0], [1, 0], [0, 1], [0, 0]]] },
        lados: [],
      }],
    }],
  }
}

function assertSameJson(actual, expected) {
  assert.equal(JSON.stringify(actual), JSON.stringify(expected))
}

function publicationChanges() {
  return [
    { territory_id: 'territory-a', version_esperada: 4, manzanas: [] },
    {
      territory_id: 'territory-b',
      version_esperada: 9,
      manzanas: [{ label: 'a', orden: 0, geom: { type: 'Polygon', coordinates: [] }, lados: [] }],
    },
  ]
}

function publicationTransport(data) {
  const calls = []
  return {
    calls,
    queryCandidates: async () => ({ data: [], error: null }),
    queryAllCandidates: async () => ({ data: [], error: null }),
    callRpc: async (name, args) => {
      calls.push({ name, args })
      return { data, error: null }
    },
  }
}

function receiptFor(changes) {
  return JSON.stringify(changes
    .map(({ territory_id, manzanas }) => ({ territory_id, manzanas }))
    .sort((first, second) => first.territory_id.localeCompare(second.territory_id)))
}

test('el intento persiste después de recrear el store', () => {
  const storage = new MemoryStorage()
  const original = attempt('operation-original')

  const firstStore = publicationAttemptStore(storage, 'project-a', 'user-a')
  assertSameJson(firstStore.prepare(original), original)

  const recreatedStore = publicationAttemptStore(storage, 'project-a', 'user-a')
  assertSameJson(recreatedStore.read(), original)
})

test('un segundo prepare conserva el UUID y el payload del primer intento', () => {
  const storage = new MemoryStorage()
  const first = attempt('operation-original')
  const second = attempt('operation-new', 'territory-b')
  const store = publicationAttemptStore(storage, 'project-a', 'user-a')

  store.prepare(first)
  const stable = store.prepare(second)

  assert.equal(stable.operationId, first.operationId)
  assertSameJson(stable.changes, first.changes)
  assert.notEqual(stable.operationId, second.operationId)
  assert.notEqual(JSON.stringify(stable.changes), JSON.stringify(second.changes))
})

test('el intento queda aislado por proyecto y usuario', () => {
  const storage = new MemoryStorage()
  const original = attempt('operation-original')
  publicationAttemptStore(storage, 'project-a', 'user-a').prepare(original)

  assertSameJson(publicationAttemptStore(storage, 'project-a', 'user-a').read(), original)
  assert.equal(publicationAttemptStore(storage, 'project-b', 'user-a').read(), null)
  assert.equal(publicationAttemptStore(storage, 'project-a', 'user-b').read(), null)
})

test('confirm sólo elimina el intento cuyo UUID coincide', () => {
  const storage = new MemoryStorage()
  const original = attempt('operation-original')
  const store = publicationAttemptStore(storage, 'project-a', 'user-a')
  store.prepare(original)

  store.confirm('operation-other')
  assertSameJson(store.read(), original)

  store.confirm(original.operationId)
  assert.equal(store.read(), null)
})

test('si falla el storage, prepare lanza antes de cualquier envío', () => {
  const storage = new MemoryStorage()
  storage.setItem = () => { throw Error('quota') }
  const store = publicationAttemptStore(storage, 'project-a', 'user-a')
  let sent = false
  const send = () => { sent = true }

  assert.throws(() => send(store.prepare(attempt('operation-original'))), /quota/)
  assert.equal(sent, false)
})

test('un JSON corrupto se conserva sin ser reemplazado', () => {
  const storage = new MemoryStorage()
  const store = publicationAttemptStore(storage, 'project-a', 'user-a')
  const corrupt = '{not-json'
  storage.setItem(store.key, corrupt)

  assert.throws(() => store.prepare(attempt('operation-new')))
  assert.equal(storage.getItem(store.key), corrupt)
})

test('publicar rechaza una respuesta vacía', async () => {
  const transport = publicationTransport([])

  await assert.rejects(
    () => publishEditorPublicationV2(transport, 'operation-publication', publicationChanges()),
    /confirmación no coincide/,
  )
})

test('publicar rechaza una confirmación de territorio incorrecto', async () => {
  const changes = [publicationChanges()[0]]
  const transport = publicationTransport([
    { territory_id: 'territory-other', version: 5, manzanas: 0 },
  ])

  await assert.rejects(
    () => publishEditorPublicationV2(transport, 'operation-publication', changes),
    /confirmación no coincide/,
  )
})

test('publicar rechaza una confirmación con versión distinta de la siguiente', async () => {
  const changes = [publicationChanges()[0]]
  const transport = publicationTransport([
    { territory_id: 'territory-a', version: 4, manzanas: 0 },
  ])

  await assert.rejects(
    () => publishEditorPublicationV2(transport, 'operation-publication', changes),
    /confirmación no coincide/,
  )
})

test('publicar rechaza territorios duplicados en la confirmación', async () => {
  const transport = publicationTransport([
    { territory_id: 'territory-a', version: 5, manzanas: 0 },
    { territory_id: 'territory-a', version: 6, manzanas: 0 },
  ])

  await assert.rejects(
    () => publishEditorPublicationV2(transport, 'operation-publication', publicationChanges()),
    /confirmación del lote está incompleta o es inválida/,
  )
})

test('publicar acepta el lote exacto confirmado por territorio y siguiente versión', async () => {
  const operationId = 'operation-publication'
  const changes = publicationChanges()
  const confirmed = [
    { territory_id: 'territory-a', version: 5, manzanas: 0 },
    { territory_id: 'territory-b', version: 10, manzanas: 1 },
  ]
  const transport = publicationTransport(confirmed)

  const result = await publishEditorPublicationV2(transport, operationId, changes)

  assert.deepEqual(result, confirmed)
  assert.deepEqual(transport.calls, [{
    name: 'publicar_territorios_atomico_v2',
    args: { p_operation_id: operationId, p_cambios: changes },
  }])
})

test('confirm conserva el recibo y un fallo al escribirlo conserva el pendiente', () => {
  const storage = new MemoryStorage()
  const store = publicationAttemptStore(storage, 'project-a', 'user-a')
  const original = attempt('operation-confirmed')
  store.prepare(original)

  store.confirm(original.operationId)

  assert.equal(store.read(), null)
  assert.equal(storage.getItem(`${store.key}:confirmed`), receiptFor(original.changes))

  const failingStorage = new MemoryStorage()
  const failingStore = publicationAttemptStore(failingStorage, 'project-a', 'user-a')
  failingStore.prepare(original)
  const setItem = failingStorage.setItem.bind(failingStorage)
  failingStorage.setItem = (key, value) => {
    if (key === `${failingStore.key}:confirmed`) throw Error('quota')
    setItem(key, value)
  }

  assert.throws(() => failingStore.confirm(original.operationId), /quota/)
  assertSameJson(failingStore.read(), original)
  assert.equal(failingStorage.getItem(`${failingStore.key}:confirmed`), null)
})

test('prepare rechaza contenido ya confirmado aunque cambie la versión y permite contenido distinto', () => {
  const storage = new MemoryStorage()
  const store = publicationAttemptStore(storage, 'project-a', 'user-a')
  const confirmed = attempt('operation-confirmed')
  store.prepare(confirmed)
  store.confirm(confirmed.operationId)

  const sameContentWithNewVersion = {
    operationId: 'operation-retry',
    changes: confirmed.changes.map((change) => ({
      ...change,
      version_esperada: change.version_esperada + 1,
    })),
  }
  assert.throws(
    () => store.prepare(sameContentWithNewVersion),
    /mismo dibujo ya fue confirmado/,
  )
  assert.equal(store.read(), null)
  assert.equal(storage.getItem(`${store.key}:confirmed`), receiptFor(confirmed.changes))

  const differentContent = attempt('operation-different', 'territory-b')
  assertSameJson(store.prepare(differentContent), differentContent)
})
