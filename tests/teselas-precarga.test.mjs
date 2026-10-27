import assert from 'node:assert/strict'
import test from 'node:test'
import {
  NOMBRE_CACHE_TESELAS,
  TOPE_TESELAS,
  TOPE_TESELAS_OSM,
  ZOOM_PRECARGA_MAX,
  ZOOM_PRECARGA_MIN,
  clavePrecarga,
  contarTeselas,
  describirPrecarga,
  ejecutarPrecarga,
  esPrecargaCompleta,
  muestraDeUrls,
  planificarTeselas,
  precargarUrls,
  recuadroDeManzanas,
  recuadroDePuntos,
  teselasDelRecuadro,
  urlDeTesela,
  xDeTesela,
  yDeTesela,
} from '../src/lib/teselasPrecarga.ts'

// La fórmula inversa, escrita aparte: esquina noroeste de una tesela.
const lngDe = (x, z) => (x / 2 ** z) * 360 - 180
const latDe = (y, z) => (Math.atan(Math.sinh(Math.PI * (1 - (2 * y) / 2 ** z))) * 180) / Math.PI

const SAN_JUAN = [-31.5375, -68.5364]
/** Un territorio de un kilómetro de lado, en el centro de San Juan. */
const kilometro = () => recuadroDePuntos([
  [SAN_JUAN[0] - 0.0045, SAN_JUAN[1] - 0.0052],
  [SAN_JUAN[0] + 0.0045, SAN_JUAN[1] + 0.0052],
])

test('la tesela de un punto lo contiene, en todos los zooms', () => {
  const puntos = [SAN_JUAN, [51.4779, -0.0015], [-33.86, 151.21], [0, 0], [84.9, 179.99], [-84.9, -179.99]]
  for (const [lat, lng] of puntos) {
    for (let z = 0; z <= 19; z++) {
      const x = xDeTesela(lng, z)
      const y = yDeTesela(lat, z)
      assert.ok(lngDe(x, z) <= lng + 1e-9 && lng < lngDe(x + 1, z) + 1e-9, `lng ${lng} z${z}`)
      assert.ok(latDe(y + 1, z) - 1e-9 <= lat && lat <= latDe(y, z) + 1e-9, `lat ${lat} z${z}`)
    }
  }
})

test('valores conocidos y bordes del mundo', () => {
  assert.deepEqual([xDeTesela(0, 1), yDeTesela(0, 1)], [1, 1])
  assert.deepEqual([xDeTesela(0, 2), yDeTesela(0, 2)], [2, 2])
  assert.deepEqual([xDeTesela(10, 1), yDeTesela(10, 1)], [1, 0])
  assert.deepEqual([xDeTesela(-10, 1), yDeTesela(-10, 1)], [0, 1])
  assert.equal(xDeTesela(180, 5), 31)
  assert.equal(xDeTesela(-180, 5), 0)
  assert.equal(yDeTesela(90, 5), 0)
  assert.equal(yDeTesela(-90, 5), 31)
})

test('el recuadro agranda los puntos, ignora los inválidos y no se achata', () => {
  const r = recuadroDePuntos([[-31.54, -68.54], [-31.53, -68.53], [Number.NaN, 0], [100, 0]], 0.1)
  assert.ok(r.sur < -31.54 && r.norte > -31.53 && r.oeste < -68.54 && r.este > -68.53)
  // 10% de margen a cada lado: el alto pasa de 0,01 a 0,012.
  assert.ok(Math.abs(r.norte - r.sur - 0.012) < 1e-9)
  assert.equal(recuadroDePuntos([]), null)
  assert.equal(recuadroDePuntos([[Number.NaN, 1]]), null)
  const punto = recuadroDePuntos([[-31.5, -68.5]], 0)
  assert.ok(punto.norte - punto.sur >= 0.001 - 1e-12 && punto.este - punto.oeste >= 0.001 - 1e-12)
})

test('el recuadro de las manzanas lee GeoJSON como [lng, lat] y salta las que no tienen forma', () => {
  const r = recuadroDeManzanas([
    { geometry_geojson: { coordinates: [[[-68.54, -31.54], [-68.53, -31.54], [-68.53, -31.53], [-68.54, -31.53]]] } },
    { geometry_geojson: null },
    { geometry_geojson: { coordinates: [] } },
  ], 0)
  for (const [lado, esperado] of Object.entries({ sur: -31.54, norte: -31.53, oeste: -68.54, este: -68.53 })) {
    assert.ok(Math.abs(r[lado] - esperado) < 1e-9, `${lado}: ${r[lado]}`)
  }
  assert.equal(recuadroDeManzanas([{ geometry_geojson: null }]), null)
})

test('teselasDelRecuadro cubre el recuadro entero y contarTeselas coincide', () => {
  const r = kilometro()
  for (let z = 15; z <= 18; z++) {
    const lista = teselasDelRecuadro(r, z)
    assert.equal(lista.length, contarTeselas(r, z))
    assert.equal(new Set(lista.map((t) => `${t.z}/${t.x}/${t.y}`)).size, lista.length)
    // Las cuatro esquinas del recuadro caen en teselas de la lista.
    for (const [lat, lng] of [[r.sur, r.oeste], [r.sur, r.este], [r.norte, r.oeste], [r.norte, r.este]]) {
      assert.ok(lista.some((t) => t.x === xDeTesela(lng, z) && t.y === yDeTesela(lat, z)))
    }
  }
})

test('un territorio normal entra entero en el tope, de menos a más zoom', () => {
  const plan = planificarTeselas(kilometro())
  assert.equal(plan.recortado, false)
  assert.equal(plan.teselas.length, plan.totalSinTope)
  assert.ok(plan.teselas.length <= TOPE_TESELAS)
  assert.deepEqual(plan.porZoom.map((p) => p.z), [15, 16, 17, 18])
  // Cada zoom tiene más teselas que el anterior.
  for (let i = 1; i < plan.porZoom.length; i++) assert.ok(plan.porZoom[i].total >= plan.porZoom[i - 1].total)
  // Y salen ordenadas por zoom.
  const zooms = plan.teselas.map((t) => t.z)
  assert.deepEqual(zooms, [...zooms].sort((a, b) => a - b))
  assert.equal(ZOOM_PRECARGA_MIN, 15)
  assert.equal(ZOOM_PRECARGA_MAX, 18)
})

test('el tope corta por el zoom más alto: los bajos van completos primero', () => {
  // Cinco kilómetros de lado: sin tope serían miles de teselas.
  const grande = recuadroDePuntos([
    [SAN_JUAN[0] - 0.0225, SAN_JUAN[1] - 0.026],
    [SAN_JUAN[0] + 0.0225, SAN_JUAN[1] + 0.026],
  ])
  const plan = planificarTeselas(grande)
  assert.equal(plan.teselas.length, TOPE_TESELAS)
  assert.equal(plan.recortado, true)
  assert.ok(plan.totalSinTope > TOPE_TESELAS)
  assert.equal(new Set(plan.teselas.map((t) => `${t.z}/${t.x}/${t.y}`)).size, TOPE_TESELAS)
  // Una vez que un zoom no entra entero, los siguientes no entran en absoluto.
  const incompleto = plan.porZoom.findIndex((p) => p.incluidas < p.total)
  assert.ok(incompleto >= 0)
  for (const p of plan.porZoom.slice(0, incompleto)) assert.equal(p.incluidas, p.total)
  for (const p of plan.porZoom.slice(incompleto + 1)) assert.equal(p.incluidas, 0)
  // El zoom 15 siempre queda completo: es el mapa de la zona.
  assert.equal(plan.porZoom[0].incluidas, plan.porZoom[0].total)
})

test('el zoom que no entra entero se completa con las teselas del centro', () => {
  const grande = recuadroDePuntos([
    [SAN_JUAN[0] - 0.0225, SAN_JUAN[1] - 0.026],
    [SAN_JUAN[0] + 0.0225, SAN_JUAN[1] + 0.026],
  ])
  const plan = planificarTeselas(grande, { zoomMin: 17, zoomMax: 17, tope: 25 })
  assert.equal(plan.teselas.length, 25)
  const cx = xDeTesela((grande.oeste + grande.este) / 2, 17)
  const cy = yDeTesela((grande.norte + grande.sur) / 2, 17)
  assert.ok(plan.teselas.some((t) => Math.abs(t.x - cx) <= 1 && Math.abs(t.y - cy) <= 1))
  // Un cuadrado de 5 x 5 alrededor del centro, no una franja de un borde.
  const xs = plan.teselas.map((t) => t.x)
  const ys = plan.teselas.map((t) => t.y)
  assert.equal(Math.max(...xs) - Math.min(...xs), 4)
  assert.equal(Math.max(...ys) - Math.min(...ys), 4)
})

test('un recuadro del tamaño de una provincia no se arma entero para tirarlo', () => {
  const provincia = { sur: -33, norte: -28, oeste: -70, este: -66 }
  assert.ok(contarTeselas(provincia, 18) > 1_000_000)
  const antes = Date.now()
  const plan = planificarTeselas(provincia)
  assert.ok(Date.now() - antes < 500)
  assert.equal(plan.teselas.length, TOPE_TESELAS)
})

test('tope cero no guarda nada y los topes de cada proveedor son los pedidos', () => {
  assert.equal(planificarTeselas(kilometro(), { tope: 0 }).teselas.length, 0)
  assert.equal(TOPE_TESELAS, 400)
  assert.ok(TOPE_TESELAS_OSM < TOPE_TESELAS)
  assert.equal(NOMBRE_CACHE_TESELAS, 'teselas-mapa')
})

test('las URLs se arman como Leaflet: {r} solo en retina y {s} por |x+y| módulo 3', () => {
  const maptiler = 'https://api.maptiler.com/maps/dataviz-light/256/{z}/{x}/{y}{r}.png?key=K'
  assert.equal(
    urlDeTesela(maptiler, { z: 16, x: 20100, y: 39000 }, { retina: true }),
    'https://api.maptiler.com/maps/dataviz-light/256/16/20100/39000@2x.png?key=K',
  )
  assert.equal(
    urlDeTesela(maptiler, { z: 16, x: 20100, y: 39000 }),
    'https://api.maptiler.com/maps/dataviz-light/256/16/20100/39000.png?key=K',
  )
  const osm = 'https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png'
  assert.equal(urlDeTesela(osm, { z: 15, x: 10, y: 11 }), 'https://a.tile.openstreetmap.org/15/10/11.png')
  assert.equal(urlDeTesela(osm, { z: 15, x: 10, y: 12 }), 'https://b.tile.openstreetmap.org/15/10/12.png')
  assert.equal(urlDeTesela(osm, { z: 15, x: 1, y: 1 }), 'https://c.tile.openstreetmap.org/15/1/1.png')
})

test('la clave de la precarga cambia con el recuadro, la densidad y el fondo', () => {
  const base = { territorioId: 't', recuadro: kilometro(), zoomMin: 15, zoomMax: 18, tope: 400, retina: true, proveedor: 'maptiler' }
  const clave = clavePrecarga(base)
  assert.equal(clave, clavePrecarga({ ...base }))
  assert.notEqual(clave, clavePrecarga({ ...base, retina: false }))
  assert.notEqual(clave, clavePrecarga({ ...base, proveedor: 'osm' }))
  assert.notEqual(clave, clavePrecarga({ ...base, territorioId: 'u' }))
  assert.notEqual(clave, clavePrecarga({ ...base, recuadro: { ...base.recuadro, norte: base.recuadro.norte + 0.01 } }))
  // Un movimiento de menos de 5 metros no cuenta como otro territorio.
  assert.equal(clave, clavePrecarga({ ...base, recuadro: { ...base.recuadro, norte: base.recuadro.norte + 0.00001 } }))
})

// ------------------------------------------------------------ descarga

const urls = (n) => Array.from({ length: n }, (_, i) => `https://t/${i}`)

test('precargarUrls pide todo, respeta la concurrencia y cuenta el progreso', async () => {
  let enVuelo = 0
  let maximo = 0
  const progreso = []
  const resultado = await precargarUrls(urls(20), {
    concurrencia: 3,
    traer: async () => {
      enVuelo++
      maximo = Math.max(maximo, enVuelo)
      await new Promise((r) => setTimeout(r, 1))
      enVuelo--
      return { ok: true }
    },
    alProgreso: (hechas, total) => progreso.push([hechas, total]),
  })
  assert.deepEqual(resultado, { total: 20, ok: 20, falladas: 0, sinIntentar: 0, cancelada: false, cortada: false })
  assert.ok(maximo <= 3 && maximo >= 2)
  assert.equal(progreso.length, 20)
  assert.deepEqual(progreso.at(-1), [20, 20])
  assert.equal(esPrecargaCompleta(resultado), true)
})

test('precargarUrls cuenta las respuestas malas y las que tiran error como falladas', async () => {
  const resultado = await precargarUrls(urls(10), {
    maxFallasSeguidas: 100,
    traer: async (url) => {
      if (url.endsWith('/3')) return { ok: false }
      if (url.endsWith('/7')) throw new Error('sin red')
      return { ok: true }
    },
  })
  assert.equal(resultado.ok, 8)
  assert.equal(resultado.falladas, 2)
  // 2 de 10 son más del 5% que se tolera.
  assert.equal(esPrecargaCompleta(resultado), false)
  assert.equal(esPrecargaCompleta({ ...resultado, total: 100, ok: 96, falladas: 4, sinIntentar: 0 }), true)
})

test('cuando fallan muchas seguidas se corta: no se piden 400 teselas a una clave vencida', async () => {
  let pedidas = 0
  const resultado = await precargarUrls(urls(400), {
    concurrencia: 4,
    maxFallasSeguidas: 12,
    traer: async () => { pedidas++; return { ok: false } },
  })
  assert.equal(resultado.cortada, true)
  assert.ok(pedidas < 30, `se pidieron ${pedidas}`)
  assert.ok(resultado.sinIntentar > 300)
  assert.equal(esPrecargaCompleta(resultado), false)
})

test('abortar frena la descarga y no cuenta como falla', async () => {
  const control = new AbortController()
  let pedidas = 0
  const resultado = await precargarUrls(urls(50), {
    concurrencia: 2,
    senal: control.signal,
    traer: async () => {
      pedidas++
      if (pedidas === 5) control.abort()
      return { ok: true }
    },
  })
  assert.equal(resultado.cancelada, true)
  assert.ok(pedidas < 10)
  assert.equal(resultado.falladas, 0)
  assert.equal(esPrecargaCompleta(resultado), false)
})

// ------------------------------------------------------------ orquestación

const AHORA = Date.parse('2026-10-27T15:00:00Z')
function dependencias(sobreescribir = {}) {
  const guardados = []
  const pedidas = []
  return {
    guardados,
    pedidas,
    deps: {
      traer: async (url) => { pedidas.push(url); return { ok: true } },
      estaEnCache: async () => true,
      leerRegistro: async () => null,
      guardarRegistro: async (r) => { guardados.push(r) },
      esperar: async () => {},
      ahora: () => AHORA,
      ...sobreescribir,
    },
  }
}
const correr = (extra, deps) => {
  const estados = []
  return ejecutarPrecarga({
    urls: urls(30), clave: 'k', enLinea: true, ahorroDeDatos: false,
    alEstado: (e) => estados.push(e), deps, ...extra,
  }).then((final) => ({ final, estados }))
}

test('precarga normal: avisa el avance, espera al service worker y termina en "lista"', async () => {
  const { deps, guardados, pedidas } = dependencias()
  const { final, estados } = await correr({}, deps)
  assert.deepEqual(final, { fase: 'lista' })
  assert.equal(pedidas.length, 30)
  assert.deepEqual(estados[0], { fase: 'guardando', hechas: 0, total: 30 })
  assert.deepEqual(estados.at(-1), { fase: 'lista' })
  assert.deepEqual(guardados, [{ clave: 'k', terminadoEl: new Date(AHORA).toISOString() }])
})

test('con el ahorro de datos activo no se baja nada y se ofrece guardarlo igual', async () => {
  const { deps, pedidas } = dependencias()
  const { final } = await correr({ ahorroDeDatos: true }, deps)
  assert.deepEqual(final, { fase: 'ahorro-de-datos' })
  assert.equal(pedidas.length, 0)

  const forzada = await correr({ ahorroDeDatos: true, forzar: true }, deps)
  assert.deepEqual(forzada.final, { fase: 'lista' })
  assert.equal(pedidas.length, 30)
})

test('sin red no se intenta nada', async () => {
  const { deps, pedidas } = dependencias()
  const { final } = await correr({ enLinea: false }, deps)
  assert.deepEqual(final, { fase: 'inactiva' })
  assert.equal(pedidas.length, 0)
  assert.deepEqual((await correr({ urls: [] }, deps)).final, { fase: 'inactiva' })
})

test('si ya se bajó hace poco y siguen en la caché, no se vuelve a pedir', async () => {
  const reciente = { clave: 'k', terminadoEl: new Date(AHORA - 3 * 24 * 3600 * 1000).toISOString() }
  const { deps, pedidas } = dependencias({ leerRegistro: async () => reciente })
  assert.deepEqual((await correr({}, deps)).final, { fase: 'lista' })
  assert.equal(pedidas.length, 0)

  // Con ahorro de datos también: no hay nada que descargar.
  assert.deepEqual((await correr({ ahorroDeDatos: true }, deps)).final, { fase: 'lista' })
})

test('registro vencido, de otro recuadro o con la caché vacía: se baja de nuevo', async () => {
  const vencido = { clave: 'k', terminadoEl: new Date(AHORA - 8 * 24 * 3600 * 1000).toISOString() }
  const otro = { clave: 'otra', terminadoEl: new Date(AHORA).toISOString() }
  const vigente = { clave: 'k', terminadoEl: new Date(AHORA).toISOString() }
  for (const [registro, enCache] of [[vencido, true], [otro, true], [vigente, false]]) {
    const { deps, pedidas } = dependencias({ leerRegistro: async () => registro, estaEnCache: async () => enCache })
    await correr({}, deps)
    assert.equal(pedidas.length, 30, JSON.stringify(registro))
  }
})

test('"lista" no se dice si las teselas no quedaron en la caché del service worker', async () => {
  const { deps, guardados } = dependencias({ estaEnCache: async () => false })
  const { final } = await correr({}, deps)
  assert.deepEqual(final, { fase: 'incompleta', motivo: 'sin-cache' })
  assert.deepEqual(guardados, [])
})

test('con demasiadas teselas falladas queda incompleta y no se registra como hecha', async () => {
  const { deps, guardados } = dependencias({
    traer: async (url) => ({ ok: Number(url.split('/').pop()) % 2 === 0 }),
  })
  const { final } = await correr({}, deps)
  assert.deepEqual(final, { fase: 'incompleta', motivo: 'fallas' })
  assert.deepEqual(guardados, [])
})

test('cancelar a mitad no deja ningún estado final', async () => {
  const control = new AbortController()
  const { deps, guardados } = dependencias({
    traer: async () => { control.abort(); return { ok: true } },
  })
  const { final } = await correr({ senal: control.signal }, deps)
  assert.deepEqual(final, { fase: 'inactiva' })
  assert.deepEqual(guardados, [])
})

test('la muestra para mirar la caché son hasta tres teselas distintas', () => {
  assert.deepEqual(muestraDeUrls([]), [])
  assert.deepEqual(muestraDeUrls(['a']), ['a'])
  assert.deepEqual(muestraDeUrls(['a', 'b']), ['a', 'b'])
  assert.deepEqual(muestraDeUrls(['a', 'b', 'c', 'd', 'e']), ['a', 'c', 'e'])
})

test('cada estado de la precarga se dice con icono y palabras', () => {
  assert.equal(describirPrecarga({ fase: 'inactiva' }), null)
  assert.deepEqual(describirPrecarga({ fase: 'lista' }), { texto: 'Listo para usar sin señal', icono: 'completo' })
  assert.match(describirPrecarga({ fase: 'guardando', hechas: 40, total: 120 }).texto, /Guardando el mapa.*40 de 120/)
  const incompleta = describirPrecarga({ fase: 'incompleta', motivo: 'fallas' })
  assert.equal(incompleta.icono, 'error')
  assert.deepEqual(incompleta.accion, { etiqueta: 'Reintentar', icono: 'rehacer' })
  const ahorro = describirPrecarga({ fase: 'ahorro-de-datos' })
  assert.match(ahorro.texto, /Ahorro de datos/)
  assert.deepEqual(ahorro.accion, { etiqueta: 'Guardarlo igual', icono: 'descargar' })
})
