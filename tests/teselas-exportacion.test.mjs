import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import {
  CREDITO_MAPTILER_Y_OSM,
  CREDITO_OSM,
  FALLAS_PARA_VOLVER_A_OSM,
  crearCargadorDeTeselas,
  urlTeselaMapTiler,
  urlTeselaOsm,
} from '../src/lib/teselasExportacion.ts'

// `cargar` de mentira: anota cada URL pedida y falla cuando `falla(url)` dice
// que sí, como una imagen que no se puede bajar.
function cargadorDeMentira(falla = () => false) {
  const pedidas = []
  return {
    pedidas,
    cargar: async (url) => {
      pedidas.push(url)
      if (falla(url)) throw new Error(`no se pudo cargar ${url}`)
      return { url }
    },
  }
}

const esMapTiler = (url) => url.startsWith('https://api.maptiler.com/')
const armar = (opciones = {}) => {
  const { pedidas, cargar } = cargadorDeMentira(opciones.falla)
  const avisos = []
  const cargador = crearCargadorDeTeselas({
    clave: 'clave-de-prueba',
    estilo: 'dataviz-light',
    cargar,
    avisar: (mensaje) => avisos.push(mensaje),
    ...opciones.crear,
  })
  return { cargador, pedidas, avisos }
}

test('las URL son las mismas que usa el mapa en pantalla', () => {
  assert.equal(
    urlTeselaMapTiler('dataviz-light', 'K', 15, 10, 20),
    'https://api.maptiler.com/maps/dataviz-light/256/15/10/20.png?key=K',
  )
  assert.equal(urlTeselaOsm(15, 10, 20), 'https://tile.openstreetmap.org/15/10/20.png')
})

test('con clave, las teselas se piden a MapTiler y no a OpenStreetMap', async () => {
  const { cargador, pedidas } = armar()
  const resultado = await cargador.cargar(16, 5, 7)
  assert.equal(resultado.fuente, 'maptiler')
  assert.deepEqual(pedidas, [
    'https://api.maptiler.com/maps/dataviz-light/256/16/5/7.png?key=clave-de-prueba',
  ])
  assert.equal(cargador.credito(), CREDITO_MAPTILER_Y_OSM)
})

test('sin clave se usa OpenStreetMap directo y no se nombra a MapTiler', async () => {
  const { cargador, pedidas } = armar({ crear: { clave: undefined } })
  const resultado = await cargador.cargar(16, 5, 7)
  assert.equal(resultado.fuente, 'osm')
  assert.deepEqual(pedidas, ['https://tile.openstreetmap.org/16/5/7.png'])
  assert.equal(cargador.credito(), CREDITO_OSM)
})

test('una clave vacía cuenta como sin clave', async () => {
  const { cargador, pedidas } = armar({ crear: { clave: '' } })
  await cargador.cargar(1, 0, 0)
  assert.ok(pedidas.every((url) => !esMapTiler(url)))
})

test('si una tesela de MapTiler falla, esa tesela sale de OpenStreetMap y las demás siguen en MapTiler', async () => {
  const { cargador, pedidas } = armar({ falla: (url) => esMapTiler(url) && url.includes('/16/5/7.png') })
  const mala = await cargador.cargar(16, 5, 7)
  const buena = await cargador.cargar(16, 5, 8)
  assert.equal(mala.fuente, 'osm')
  assert.equal(buena.fuente, 'maptiler')
  assert.deepEqual(pedidas, [
    'https://api.maptiler.com/maps/dataviz-light/256/16/5/7.png?key=clave-de-prueba',
    'https://tile.openstreetmap.org/16/5/7.png',
    'https://api.maptiler.com/maps/dataviz-light/256/16/5/8.png?key=clave-de-prueba',
  ])
  // Quedó MapTiler en la imagen: hay que nombrarlo.
  assert.equal(cargador.credito(), CREDITO_MAPTILER_Y_OSM)
})

test('seis fallas seguidas de MapTiler lo dejan de lado y se avisa una sola vez', async () => {
  const { cargador, pedidas, avisos } = armar({ falla: esMapTiler })
  assert.equal(FALLAS_PARA_VOLVER_A_OSM, 6)

  for (let y = 0; y < FALLAS_PARA_VOLVER_A_OSM; y += 1) await cargador.cargar(16, 1, y)
  assert.equal(avisos.length, 1)
  const pedidasAMapTiler = pedidas.filter(esMapTiler).length
  assert.equal(pedidasAMapTiler, 6)

  // De la séptima en adelante no se vuelve a golpear a MapTiler.
  for (let y = 6; y < 12; y += 1) {
    const resultado = await cargador.cargar(16, 1, y)
    assert.equal(resultado.fuente, 'osm')
  }
  assert.equal(pedidas.filter(esMapTiler).length, pedidasAMapTiler)
  assert.equal(avisos.length, 1)
  // Ni una tesela de MapTiler quedó en la imagen: solo se nombra a OSM.
  assert.equal(cargador.credito(), CREDITO_OSM)
})

test('un acierto empieza la cuenta de nuevo: las fallas sueltas no cortan MapTiler', async () => {
  let turno = 0
  // Falla, falla, acierta, falla, falla, acierta... nunca seis seguidas.
  const { cargador, pedidas } = armar({
    falla: (url) => esMapTiler(url) && ++turno % 3 !== 0,
  })
  for (let y = 0; y < 30; y += 1) await cargador.cargar(16, 2, y)
  const aMapTiler = pedidas.filter(esMapTiler).length
  assert.equal(aMapTiler, 30)
})

test('si OpenStreetMap también falla, el error llega a quien exporta', async () => {
  const { cargador } = armar({ falla: () => true })
  await assert.rejects(() => cargador.cargar(16, 1, 1), /tile\.openstreetmap\.org/)
})

test('sin clave y con OpenStreetMap caído, falla como antes', async () => {
  const { cargador } = armar({ crear: { clave: undefined }, falla: () => true })
  await assert.rejects(() => cargador.cargar(16, 1, 1), /no se pudo cargar/)
})

test('SanJuanMap exporta con el cargador de fondoMapa y no pide teselas a OpenStreetMap a mano', async () => {
  const fuente = await readFile(new URL('../src/components/SanJuanMap.tsx', import.meta.url), 'utf8')
  assert.match(fuente, /crearCargadorTeselasExportacion\(loadTileImage\)/)
  assert.match(fuente, /from '\.\.\/lib\/fondoMapa'/)
  assert.doesNotMatch(fuente, /tile\.openstreetmap\.org/)
  assert.doesNotMatch(fuente, /'© OpenStreetMap contributors'/)
})
