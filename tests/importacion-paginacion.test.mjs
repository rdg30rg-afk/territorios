import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import vm from 'node:vm'
import ts from 'typescript'

const source = await readFile(new URL('../src/pages/ImportacionPage.tsx', import.meta.url), 'utf8')
const helpers = source.slice(
  source.indexOf('export const IMPORTACION_PAGE_SIZE'),
  source.indexOf('const fecha'),
)
const compiled = ts.transpileModule(helpers, {
  compilerOptions: { module: ts.ModuleKind.CommonJS },
}).outputText
const exports = {}
vm.runInNewContext(compiled, { exports, AbortController })

const {
  IMPORTACION_PAGE_SIZE,
  initialImportacionViewState,
  importacionViewReducer,
  importacionPagination,
  exactImportacionCount,
  createImportacionRequestGate,
  executeImportacionDecision,
} = exports

test('página calcula rangos de 200 y total exacto sin truncar el último rango', () => {
  assert.equal(IMPORTACION_PAGE_SIZE, 200)
  assert.deepEqual({ ...importacionPagination(401, 0) }, {
    page: 0,
    from: 0,
    to: 199,
    pageCount: 3,
    firstShown: 1,
    lastShown: 200,
    canPrevious: false,
    canNext: true,
  })
  assert.equal(importacionPagination(401, 1).firstShown, 201)
  assert.equal(importacionPagination(401, 1).lastShown, 400)
  assert.equal(importacionPagination(401, 2).firstShown, 401)
  assert.equal(importacionPagination(401, 2).lastShown, 401)
  assert.equal(importacionPagination(0, 0).firstShown, 0)
})

test('corrida y filtros reinician la página; avanzar y volver no la cambia por accidente', () => {
  let state = { ...initialImportacionViewState }
  state = importacionViewReducer(state, { type: 'setPagina', pagina: 4 })
  assert.equal(state.pagina, 4)
  state = importacionViewReducer(state, { type: 'setFiltroTipo', filtroTipo: 'salida' })
  assert.equal(state.pagina, 0)
  state = importacionViewReducer(state, { type: 'setPagina', pagina: 2 })
  state = importacionViewReducer(state, { type: 'setFiltroEstado', filtroEstado: 'aplicado' })
  assert.equal(state.pagina, 0)
  state = importacionViewReducer(state, { type: 'setPagina', pagina: 3 })
  state = importacionViewReducer(state, { type: 'setCorrida', corrida: 'otra-corrida' })
  assert.deepEqual({ ...state }, {
    corrida: 'otra-corrida',
    filtroTipo: 'salida',
    filtroEstado: 'aplicado',
    pagina: 0,
  })
})

test('una respuesta tardía queda inválida cuando empieza otra o se cancela', () => {
  const gate = createImportacionRequestGate()
  const first = gate.start()
  const second = gate.start()
  const applied = []
  if (first.isCurrent()) applied.push('primera')
  if (second.isCurrent()) applied.push('segunda')
  assert.equal(first.signal.aborted, true)
  assert.deepEqual(applied, ['segunda'])
  gate.cancel()
  assert.equal(second.signal.aborted, true)
  assert.equal(second.isCurrent(), false)
})

test('los conteos fallidos no se convierten en cero ni en corrida vacía', () => {
  assert.equal(exactImportacionCount({ count: 0, error: null }, 'filas'), 0)
  assert.throws(
    () => exactImportacionCount({ count: null, error: null }, 'filas'),
    /no devolvió un total exacto/,
  )
  assert.throws(
    () => exactImportacionCount({ count: null, error: { message: 'sin conexión' } }, 'filas'),
    /filas: sin conexión/,
  )
})

test('la lista usa count exacto, orden estable, rango servidor y cancelación', () => {
  assert.match(source, /select\([^\n]+count: 'exact'/)
  assert.match(source, /\.order\('pestania'.*\.order\('fila'.*\.order\('id'/s)
  assert.match(source, /\.range\(bounds\.from, bounds\.to\)/)
  assert.match(source, /\.abortSignal\(request\.signal\)/)
  assert.match(source, /No se pudieron contar las filas/)
  assert.match(source, /Reintentar lista/)
  assert.doesNotMatch(source, /\.limit\(200\)/)
  assert.doesNotMatch(source, /registros\.length === 200/)
})

test('una decisión en vuelo bloquea navegación y edición concurrente', () => {
  assert.match(source, /if \(guardando \|\| decisionGuard\.current\)/)
  assert.match(source, /Esperá a que termine de guardarse la decisión antes de navegar/)
  assert.match(source, /decisionGuard\.current = \{ id: r\.id, generation \}/)
  assert.match(source, /disabled=\{guardando\}/)
  assert.match(source, /const sigueSiendoLaDecision = \(\) =>/)
})

test('el helper captura un rechazo de transporte y libera el guard', async () => {
  let error = null
  let exitos = 0
  let finalizaciones = 0
  let vigente = true
  const rechazo = vm.runInNewContext('new Error("transporte rechazado")')

  await executeImportacionDecision(
    async () => {
      await Promise.resolve()
      throw rechazo
    },
    () => vigente,
    message => { error = message },
    () => { exitos++ },
    () => { finalizaciones++; vigente = false },
  )

  assert.equal(error, 'transporte rechazado')
  assert.equal(exitos, 0)
  assert.equal(finalizaciones, 1)
  assert.equal(vigente, false)
})
