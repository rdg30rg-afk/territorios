import assert from 'node:assert/strict'
import test from 'node:test'
import ts from 'typescript'
import { readFile } from 'node:fs/promises'
import vm from 'node:vm'

const source = await readFile(new URL('../src/lib/recorridoGesture.ts', import.meta.url), 'utf8')
const code = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText
const module = { exports: {} }
vm.runInNewContext(code, { module, exports: module.exports, Math })
const { distanceToSegment, nearestPath } = module.exports

test('calcula distancia al tramo y no sólo a sus vértices', () => {
  assert.equal(distanceToSegment({ x: 5, y: 3 }, { x: 0, y: 0 }, { x: 10, y: 0 }), 3)
})

test('el trazo elige el lado más cercano dentro del umbral', () => {
  const paths = [
    { id: 'norte', points: [{ x: 0, y: 0 }, { x: 100, y: 0 }] },
    { id: 'sur', points: [{ x: 0, y: 50 }, { x: 100, y: 50 }] },
  ]
  assert.equal(nearestPath({ x: 40, y: 44 }, paths, 12), 'sur')
  assert.equal(nearestPath({ x: 40, y: 25 }, paths, 12), null)
})
