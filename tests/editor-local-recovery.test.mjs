import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'
import vm from 'node:vm'
import ts from 'typescript'

import { createEditorDocument } from '../src/features/map-editor/model/editorDocument.ts'

const source = await readFile(
  new URL('../src/features/map-editor/data/localRecovery.ts', import.meta.url),
  'utf8',
)
const code = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.CommonJS },
}).outputText
const moduleExports = {}
vm.runInNewContext(code, {
  exports: moduleExports,
  require(name) {
    if (name === '../model/editorDocument.ts') return { createEditorDocument }
    throw Error(`Dependencia inesperada: ${name}`)
  },
})
const { editorRecoveryStore } = moduleExports

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

const square = {
  type: 'Polygon',
  coordinates: [[[0, 0], [0.001, 0], [0.001, 0.001], [0, 0.001], [0, 0]]],
}

function documentFixture() {
  return createEditorDocument(
    [{ id: 'territory-a', number: '1' }],
    [{ id: 'block-a', territoryId: 'territory-a', geometry: square, label: 'a', order: 0 }],
  )
}

function recoveryFixture(revision = 12) {
  return { revision, document: documentFixture() }
}

function assertSameJson(actual, expected) {
  assert.equal(JSON.stringify(actual), JSON.stringify(expected))
}

test('write y read conservan exactamente documento y revisión', () => {
  const storage = new MemoryStorage()
  const store = editorRecoveryStore(storage, 'project-a', 'user-a')
  const recovery = recoveryFixture()

  store.write(recovery)

  assertSameJson(store.read(), recovery)
})

test('la copia persiste al recrear el store', () => {
  const storage = new MemoryStorage()
  const recovery = recoveryFixture(23)
  editorRecoveryStore(storage, 'project-a', 'user-a').write(recovery)

  const recreated = editorRecoveryStore(storage, 'project-a', 'user-a')

  assertSameJson(recreated.read(), recovery)
})

test('la copia queda aislada por proyecto y usuario', () => {
  const storage = new MemoryStorage()
  const recovery = recoveryFixture()
  editorRecoveryStore(storage, 'project-a', 'user-a').write(recovery)

  assertSameJson(editorRecoveryStore(storage, 'project-a', 'user-a').read(), recovery)
  assert.equal(editorRecoveryStore(storage, 'project-b', 'user-a').read(), null)
  assert.equal(editorRecoveryStore(storage, 'project-a', 'user-b').read(), null)
})

test('clear elimina sólo la copia del ámbito elegido', () => {
  const storage = new MemoryStorage()
  const first = editorRecoveryStore(storage, 'project-a', 'user-a')
  const other = editorRecoveryStore(storage, 'project-b', 'user-a')
  const firstRecovery = recoveryFixture(1)
  const otherRecovery = recoveryFixture(2)
  first.write(firstRecovery)
  other.write(otherRecovery)

  first.clear()

  assert.equal(first.read(), null)
  assertSameJson(other.read(), otherRecovery)
})

test('JSON corrupto, copia malformed y referencia territorial inválida fallan conservando el raw', () => {
  const cases = [
    { raw: '{not-json' },
    { raw: JSON.stringify({ revision: -1, document: {} }), message: /copia local no es válida/ },
    {
      raw: JSON.stringify({
        revision: 4,
        document: {
          territories: { 'territory-a': { id: 'territory-a', number: '1' } },
          blocks: {
            'block-a': {
              id: 'block-a',
              territoryId: 'territory-missing',
              geometry: square,
            },
          },
          touchedTerritoryIds: [],
        },
      }),
      message: /territorio desconocido/,
    },
  ]

  for (const { raw, message } of cases) {
    const storage = new MemoryStorage()
    const store = editorRecoveryStore(storage, 'project-a', 'user-a')
    storage.setItem(store.key, raw)

    assert.throws(() => store.read(), message)
    assert.equal(storage.getItem(store.key), raw)
  }
})

test('si falla el storage, write lanza', () => {
  const storage = new MemoryStorage()
  storage.setItem = () => { throw Error('quota') }
  const store = editorRecoveryStore(storage, 'project-a', 'user-a')

  assert.throws(() => store.write(recoveryFixture()), /quota/)
})
