import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import vm from 'node:vm'
import ts from 'typescript'
import { canReportSalidaCoverage, prepareSalidaCoverage } from '../src/lib/salidaCoverage.ts'
import { linePoints } from '../src/lib/heatmapGeometry.ts'

// Ejecuta el componente TSX real transpilado con hooks y transporte controlados.
// Leaflet queda reducido a capas que conservan sus handlers: no se monta DOM ni
// se depende del comportamiento interno de Leaflet para probar la selección.
const source = await readFile(new URL('../src/components/SalidaCoverageForm.tsx', import.meta.url), 'utf8')
const code = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX },
}).outputText

const polygon = (west, south) => ({
  type: 'Polygon',
  coordinates: [[
    [west, south], [west + 0.01, south], [west + 0.01, south + 0.01],
    [west, south + 0.01], [west, south],
  ]],
})

const validSides = [
  {
    id: 'side-a-1', manzana_id: 'block-1', territory_id: 'territory', orden: 0,
    geometry_version: 1, vigente_hasta: null,
    geometry_geojson: { type: 'LineString', coordinates: [[-68.5, -31.5], [-68.49, -31.5]] },
  },
  {
    id: 'side-a-2', manzana_id: 'block-1', territory_id: 'territory', orden: 1,
    geometry_version: 1, vigente_hasta: null,
    geometry_geojson: { type: 'LineString', coordinates: [[-68.49, -31.5], [-68.49, -31.49]] },
  },
  {
    id: 'side-b-1', manzana_id: 'block-2', territory_id: 'territory', orden: 0,
    geometry_version: 2, vigente_hasta: null,
    geometry_geojson: { type: 'LineString', coordinates: [[-68.48, -31.5], [-68.47, -31.5]] },
  },
]
const validBlocks = [
  { id: 'block-1', label: 'A-01', geometry_geojson: polygon(-68.5, -31.5) },
  { id: 'block-2', label: 'B-02', geometry_geojson: polygon(-68.48, -31.5) },
]
const currentCoverage = [{ lado_id: 'side-a-1', estado: 'recorrido' }]
const outing = { id: 'outing', driverId: 'driver', terrId: 'territory' }
const driverProfile = { id: 'person', access_status: 'active', driver_id: 'driver' }

function createLeafletMock() {
  const maps = []
  const layers = []

  function recordLayer(kind, points, options = {}) {
    const record = { kind, points, options, handlers: {}, tooltip: '', removed: false, map: null }
    const layer = {
      addTo(target) {
        record.map = target.map ?? target
        return layer
      },
      bindTooltip(content) {
        record.tooltip = String(content)
        return layer
      },
      on(event, handler) {
        record.handlers[event] = handler
        return layer
      },
    }
    record.layer = layer
    layers.push(record)
    return layer
  }

  const leaflet = {
    map(_element, options) {
      const mapRecord = { options, removed: false, fitBounds: null }
      const map = {
        attributionControl: { setPrefix() {} },
        getPane() { return { style: {} } },
        fitBounds(bounds, fitOptions) { mapRecord.fitBounds = { bounds, fitOptions } },
        remove() {
          mapRecord.removed = true
          for (const layer of layers) if (layer.map === map) layer.removed = true
        },
      }
      mapRecord.map = map
      maps.push(mapRecord)
      return map
    },
    tileLayer() { return { addTo() { return this } } },
    layerGroup() {
      const group = {
        map: null,
        addTo(map) {
          group.map = map
          return group
        },
      }
      return group
    },
    polygon(points, options) { return recordLayer('polygon', points, options) },
    polyline(points, options) { return recordLayer('polyline', points, options) },
    latLngBounds(points) {
      return { points, pad() { return this } }
    },
  }

  return {
    leaflet,
    maps,
    layers,
    activeLayers() { return layers.filter(layer => !layer.removed) },
  }
}

function harness({
  profile = driverProfile,
  contexto = null,
  sides = validSides,
  blocks = validBlocks,
  coverage = currentCoverage,
  enqueueImpl = null,
  queueError = null,
} = {}) {
  const slots = []
  const effects = []
  const effectRecords = new Map()
  const enqueued = []
  const loadTables = []
  const syncs = []
  let cursor = 0
  let tree = null

  const same = (a, b) => {
    if (a === b) return true
    if (!Array.isArray(a) || !Array.isArray(b) || a.length !== b.length) return false
    return a.every((value, index) => Object.is(value, b[index]))
  }
  const memoize = (factory, deps) => {
    const index = cursor++
    const previous = slots[index]
    if (!previous || !same(previous.deps, deps)) slots[index] = { deps, value: factory() }
    return slots[index].value
  }
  const hooks = {
    useState(initial) {
      const index = cursor++
      if (!(index in slots)) slots[index] = typeof initial === 'function' ? initial() : initial
      return [slots[index], value => {
        slots[index] = typeof value === 'function' ? value(slots[index]) : value
      }]
    },
    useRef(initial) {
      const index = cursor++
      if (!(index in slots)) slots[index] = { current: initial }
      return slots[index]
    },
    useMemo: memoize,
    useCallback(callback, deps) { return memoize(() => callback, deps) },
    useEffect(effect, deps) {
      const index = cursor++
      const previous = effectRecords.get(index)
      if (previous && same(previous.deps, deps)) return
      if (previous?.cleanup) previous.cleanup()
      const record = { deps, cleanup: null }
      effectRecords.set(index, record)
      effects.push(() => {
        const cleanup = effect()
        if (effectRecords.get(index) === record && typeof cleanup === 'function') record.cleanup = cleanup
      })
    },
  }

  const datasets = {
    manzana_lados: sides,
    territorio_manzanas: blocks,
    cobertura_lado_actual: coverage,
  }
  const client = {
    from(table) {
      loadTables.push(table)
      const data = datasets[table] ?? []
      const query = {
        select() { return query },
        eq() { return query },
        is() { return query },
        order() { return query },
        range() { return Promise.resolve({ data, error: null }) },
      }
      return query
    },
  }
  const queue = {
    events: [],
    confirmed: [],
    error: queueError,
    sending: false,
    async enqueue(payload) {
      enqueued.push(payload)
      if (enqueueImpl) return enqueueImpl(payload)
      return { id: `event-${enqueued.length}` }
    },
    async sync() { syncs.push(true) },
    async retry() {},
  }

  const mapMock = createLeafletMock()
  const jsx = (type, props) => {
    const nextProps = props ?? {}
    if (nextProps.ref && typeof nextProps.ref === 'object') {
      nextProps.ref.current ??= { nodeName: 'DIV' }
    }
    return { type, props: nextProps }
  }
  const exports = {}
  vm.runInNewContext(code, {
    exports,
    require(name) {
      if (name === 'react') return hooks
      if (name === 'react/jsx-runtime') return { jsx, jsxs: jsx, Fragment: 'Fragment' }
      if (name === 'leaflet') return mapMock.leaflet
      if (name.endsWith('useAuth')) return { useAuth: () => ({ profile, contexto }) }
      if (name.endsWith('supabase')) return { supabase: client }
      if (name.endsWith('readAllRows')) return {
        readAllRows: async request => {
          const result = await request(0, 999)
          if (result.error) throw result.error
          return result.data ?? []
        },
      }
      if (name.endsWith('salidaCoverage')) return { canReportSalidaCoverage, prepareSalidaCoverage }
      if (name.endsWith('heatmapGeometry')) return { linePoints }
      if (name.endsWith('fondoMapa')) return { ponerFondo() {} }
      if (name.endsWith('Icono')) return { Icono: () => null }
      throw Error(`Dependencia inesperada: ${name}`)
    },
    Error,
    Promise,
    setTimeout,
    clearTimeout,
  })

  function render() {
    cursor = 0
    tree = exports.SalidaCoverageForm({ outing, queue })
    return tree
  }
  function nodes(node = tree) {
    if (!node || typeof node !== 'object') return []
    if (Array.isArray(node)) return node.flatMap(value => nodes(value ?? null))
    return [node, ...nodes(node.props?.children ?? null)]
  }
  function text(node) {
    if (node == null || typeof node === 'boolean') return ''
    if (typeof node !== 'object') return String(node)
    if (Array.isArray(node)) return node.map(text).join('')
    return text(node.props?.children)
  }
  async function settle() {
    for (let attempt = 0; attempt < 12; attempt++) {
      render()
      for (const effect of effects.splice(0)) effect()
      await new Promise(resolve => setImmediate(resolve))
    }
    render()
  }
  function button(label) {
    const node = nodes().find(value => value.type === 'button' && text(value) === label)
    assert.ok(node, `Botón ausente: ${label}`)
    return node
  }
  function saveButton() {
    const node = nodes().find(value => value.type === 'button' && text(value).startsWith('Guardar '))
    assert.ok(node, 'Botón de guardado ausente')
    return node
  }
  function clickBlock(label) {
    const record = mapMock.activeLayers().find(layer => layer.kind === 'polygon' && layer.tooltip === label.toUpperCase())
    assert.ok(record?.handlers.click, `Manzana sin handler de selección: ${label}`)
    record.handlers.click()
    return settle()
  }
  function clickSide(id) {
    const index = sides.findIndex(side => side.id === id)
    assert.notEqual(index, -1, `Lado inexistente en fixture: ${id}`)
    const hits = mapMock.activeLayers().filter(layer => (
      layer.kind === 'polyline' && layer.options.opacity === 0 && layer.options.weight === 28
    ))
    assert.ok(hits[index]?.handlers.click, `Lado sin hit target de selección: ${id}`)
    hits[index].handlers.click()
    return settle()
  }
  async function openAndLoad() {
    await settle()
    button('Marcar en el mapa').props.onClick()
    await settle()
  }

  return {
    button,
    clickBlock,
    clickSide,
    openAndLoad,
    saveButton,
    nodes,
    text: () => text(tree),
    settle,
    render,
    enqueued,
    loadTables,
    syncs,
    queue,
    mapMock,
  }
}

test('modo inicial no carga las tres tablas ni encola marcas', async () => {
  const h = harness()
  await h.settle()
  assert.equal(h.loadTables.length, 0)
  assert.equal(h.enqueued.length, 0)
})

test('abre con Marcar en el mapa, carga las tres tablas y selecciona una manzana', async () => {
  const h = harness()
  await h.openAndLoad()
  assert.deepEqual([...new Set(h.loadTables)].sort(), [
    'cobertura_lado_actual', 'manzana_lados', 'territorio_manzanas',
  ])
  await h.clickBlock('B-02')
  assert.match(h.text(), /1 manzana · 1 calle seleccionada/)
  assert.equal(h.saveButton().props.disabled, false)
  assert.equal(h.enqueued.length, 0)
})

test('en modo Por calles selecciona un lado con el handler de la hit-line', async () => {
  const h = harness()
  await h.openAndLoad()
  h.button('Por calles').props.onClick()
  await h.settle()
  assert.equal(h.button('Por calles').props['aria-pressed'], true)
  await h.clickSide('side-a-2')
  assert.match(h.text(), /1 calle seleccionada/)
  assert.equal(h.saveButton().props.disabled, false)
})

test('selección múltiple y doble clic producen un solo envío por lado y payloads correctos', async () => {
  const h = harness()
  await h.openAndLoad()
  await h.clickBlock('A-01')
  await h.clickBlock('B-02')
  assert.match(h.text(), /2 manzanas · 2 calles seleccionadas/)

  const save = h.saveButton()
  await Promise.all([save.props.onClick(), save.props.onClick()])
  await h.settle()

  assert.equal(h.enqueued.length, 2)
  assert.deepEqual(h.enqueued, [
    {
      lado_id: 'side-a-2', manzana_id: 'block-1', territory_id: 'territory',
      geometry_version: 1, estado: 'recorrido', origen: 'cierre_salida',
      salida_id: 'outing', informado_por: 'person',
    },
    {
      lado_id: 'side-b-1', manzana_id: 'block-2', territory_id: 'territory',
      geometry_version: 2, estado: 'recorrido', origen: 'cierre_salida',
      salida_id: 'outing', informado_por: 'person',
    },
  ])
  assert.equal(h.syncs.length, 1)
  assert.match(h.text(), /Tocá una manzana en el mapa/)
})

test('un error de enqueue conserva la selección pendiente y muestra el error', async () => {
  const h = harness({ enqueueImpl: async () => { throw Error('almacenamiento local lleno') } })
  await h.openAndLoad()
  await h.clickBlock('B-02')
  await h.saveButton().props.onClick()
  await h.settle()

  assert.match(h.text(), /almacenamiento local lleno/)
  assert.match(h.text(), /1 manzana · 1 calle seleccionada/)
  assert.doesNotMatch(h.text(), /El servidor confirmó la última marca/)
  assert.equal(h.enqueued.length, 1)
  assert.equal(h.saveButton().props.disabled, false)
})

test('otro conductor activo puede informar, pero un publicador o una cuenta inactiva no ve el formulario', async () => {
  const otherDriver = harness({ profile: { ...driverProfile, driver_id: 'other-driver' } })
  await otherDriver.settle()
  assert.notEqual(otherDriver.render(), null)

  const publisher = harness({
    profile: { ...driverProfile, driver_id: null },
    contexto: { puede_informar_salidas: false },
  })
  await publisher.settle()
  assert.equal(publisher.render(), null)
  assert.equal(publisher.nodes().length, 0)

  const inactive = harness({ profile: { ...driverProfile, access_status: 'revoked' } })
  await inactive.settle()
  assert.equal(inactive.render(), null)
})
