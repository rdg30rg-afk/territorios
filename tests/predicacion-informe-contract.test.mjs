import assert from 'node:assert/strict'
import test from 'node:test'
import { readFile } from 'node:fs/promises'
import vm from 'node:vm'
import ts from 'typescript'

const root = new URL('..', import.meta.url)
const [page, coverage, result, integrated, permissions] = await Promise.all([
  readFile(new URL('src/pages/PredicacionPage.tsx', root), 'utf8'),
  readFile(new URL('src/components/SalidaCoverageForm.tsx', root), 'utf8'),
  readFile(new URL('src/components/SalidaResultadoForm.tsx', root), 'utf8'),
  readFile(new URL('src/components/InformePredicacion.tsx', root), 'utf8').catch(() => ''),
  readFile(new URL('src/lib/salidaPermissions.ts', root), 'utf8'),
])

const integratedFlow = `${integrated}\n${await readFile(new URL('src/components/InformePredicacionFlow.tsx', root), 'utf8').catch(() => '')}`

function functionSource(source, name) {
  const start = source.indexOf(`function ${name}`)
  assert.notEqual(start, -1, `No se encontró ${name}`)
  const end = source.indexOf('\nfunction ', start + 10)
  return source.slice(start, end === -1 ? source.length : end)
}

const fila = functionSource(page, 'FilaSalida')
const lista = functionSource(page, 'ListaSalidas')
const acciones = functionSource(page, 'AccionesConduccion')
const rowWiring = page.slice(page.lastIndexOf('<FilaSalida'), page.indexOf('/>', page.lastIndexOf('<FilaSalida')) + 2)
const expansionMarker = ['abierta && salida.lugar', 'abierta && puedeAbrir', 'abierta &&'].find((marker) => fila.includes(marker))
assert.ok(expansionMarker, 'No se encontró la rama DOM de la salida expandida')
const expanded = fila.slice(fila.indexOf(expansionMarker))
const expandedSurface = `${expanded}\n${acciones}`
const reportFlow = [page, integratedFlow, coverage, result].join('\n')

const accionesCode = ts.transpileModule(
  `${acciones}\nexports.renderAcciones = AccionesConduccion`,
  { compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX } },
).outputText
const accionesExports = {}
vm.runInNewContext(accionesCode, {
  exports: accionesExports,
  require(name) {
    if (name === 'react/jsx-runtime') return { jsx: (type, props) => ({ type, props }), jsxs: (type, props) => ({ type, props }) }
    throw Error(`Dependencia inesperada: ${name}`)
  },
  Icono: () => null,
})

function domNodes(node) {
  if (!node || typeof node !== 'object') return []
  if (Array.isArray(node)) return node.flatMap(domNodes)
  return [node, ...domNodes(node.props?.children)]
}

function domText(node) {
  if (node == null || typeof node === 'boolean') return ''
  if (typeof node !== 'object') return String(node)
  if (Array.isArray(node)) return node.map(domText).join('')
  return domText(node.props?.children)
}

test('una salida expandida autorizada ofrece la conducción y sus tres acciones', () => {
  assert.match(fila, /onInformar/)
  assert.match(expanded, /<AccionesConduccion/)
  assert.match(expandedSurface, /Conducción/)
  assert.match(expandedSurface, /Informar predicación/)
  assert.match(expandedSurface, /Territorio completo/)
  assert.match(expandedSurface, /No se realizó/)
  assert.match(rowWiring, /puedeInformar|canReport/)
})

test('el DOM oculta No se realizó a otro conductor y lo muestra al autorizado', () => {
  const render = (canMarkNoRealizada) => {
    const calls = []
    const tree = accionesExports.renderAcciones({
      onInformar: (action) => calls.push(action),
      puedeMarcarNoRealizada: canMarkNoRealizada,
    })
    const buttons = domNodes(tree).filter((node) => node.type === 'button')
    return { buttons, calls, text: domText(tree) }
  }

  const assigned = render(true)
  assert.deepEqual(assigned.buttons.map(domText), [
    'Informar predicación', 'Territorio completo', 'No se realizó',
  ])
  assigned.buttons.forEach((button) => button.props.onClick())
  assert.deepEqual(assigned.calls, ['recorrido', 'completo', 'no_realizada'])

  const otherConductor = render(false)
  assert.deepEqual(otherConductor.buttons.map(domText), [
    'Informar predicación', 'Territorio completo',
  ])
  assert.doesNotMatch(otherConductor.text, /No se realizó/)
})

test('No se realizó queda condicionado al conductor asignado o a un administrador', () => {
  assert.match(expandedSurface, /puedeNoRealizada|puedeMarcarNoRealizada|canNoRealizada|esConductorAsignado|esAdmin/)

  assert.match(expanded, /puedeMarcarNoRealizada/)
  assert.match(permissions, /role\s*===\s*['"]admin['"]/)
  assert.match(permissions, /profile\.driver_id[\s\S]{0,180}driverId/)
  assert.match(page, /canReportSalida\(/)
  assert.match(lista, /onInformar/)
})

test('la lista no conserva el panel global que hacía empezar por el resultado', () => {
  const listSurface = page.slice(page.indexOf('<div id="lista-salidas">'), page.indexOf('{/* ----------------------------------------------------- TERRITORIO'))
  assert.doesNotMatch(listSurface, /Cerrar una salida/)
  assert.doesNotMatch(listSurface, /<SalidaResultadoForm[^>]*canReport=\{true\}/)
  assert.doesNotMatch(listSurface, /<SalidaCoverageForm outing=\{s\}/)
})

test('el mapa de informe es una superficie completa y el resultado recibe fecha automática', () => {
  assert.match(reportFlow, /aria-modal=["']true["']|role=["']dialog["']/)
  assert.match(reportFlow, /hideOccurredAt/)
  assert.match(reportFlow, /occurredAt/)
  assert.match(result, /!hideOccurredAt[\s\S]{0,500}datetime-local/)
})

test('el mapa conserva mapa + lista de manzanas y permite detectar una manzana completa', () => {
  assert.match(coverage, /recorrido-mapa/)
  assert.match(coverage, /Manzana /)
  assert.match(coverage, /selectedBlocks|selectedBlockLabels|manzanaCompleta|bloqueCompleto/)
  assert.match(coverage, /completa/i)
  assert.match(coverage, /onPointerDown|pointerdown|touchstart/)
  assert.match(coverage, /onPointerMove|pointermove|touchmove/)
  assert.match(coverage, /onPointerUp|pointerup|touchend/)
})
