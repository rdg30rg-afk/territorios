import assert from 'node:assert/strict'
import test from 'node:test'
import { readFile } from 'node:fs/promises'
import ts from 'typescript'
import vm from 'node:vm'

const source = await readFile(new URL('../src/pages/PredicacionPage.tsx', import.meta.url), 'utf8')
const ast = ts.createSourceFile('PredicacionPage.tsx', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX)
const declaration = ast.statements.find(
  (node) => ts.isFunctionDeclaration(node) && node.name?.text === 'conLimiteDeCarga',
)
assert.ok(declaration, 'no se encontró conLimiteDeCarga')
const constants = source.slice(
  source.indexOf('const LIMITE_CARGA_PROGRAMA_MS'),
  source.indexOf('// Las manzanas que hoy existen'),
)
const code = ts.transpileModule(
  `${constants}\n${declaration.getText(ast)}\nexports.conLimiteDeCarga = conLimiteDeCarga`,
  { compilerOptions: { module: ts.ModuleKind.CommonJS } },
).outputText
const exports = {}
vm.runInNewContext(code, { exports, Promise, setTimeout, clearTimeout })

test('una carga que no resuelve termina y deja reintentar', async () => {
  await assert.rejects(
    () => exports.conLimiteDeCarga(new Promise(() => {}), 5),
    /La carga del programa tardó demasiado/,
  )
})

test('una carga resuelta cancela su límite y la recarga no reactiva el loader', async () => {
  let activeTimers = 0
  let nextTimer = 0
  const timers = new Map()
  const fakeSetTimeout = (callback, ms) => {
    const id = ++nextTimer
    activeTimers++
    timers.set(id, { callback, ms })
    return id
  }
  const fakeClearTimeout = (id) => {
    if (timers.delete(id)) activeTimers--
  }

  const isolatedExports = {}
  vm.runInNewContext(code, {
    exports: isolatedExports,
    Promise,
    setTimeout: fakeSetTimeout,
    clearTimeout: fakeClearTimeout,
  })
  const value = await isolatedExports.conLimiteDeCarga(Promise.resolve('ok'), 50)
  assert.equal(value, 'ok')

  assert.match(source, /await conLimiteDeCarga\(Promise\.all\(/)
  assert.doesNotMatch(source, /setCargando\(true\)/)
  assert.equal(activeTimers, 0)
})
