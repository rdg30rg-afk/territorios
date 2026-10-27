// Paridad de las caras entre las tres copias del algoritmo.
//
// El calculo de caras (tramos casi colineales del borde de la manzana) vive en
// tres lugares y tiene que dar lo mismo en los tres:
//   - src/features/map-editor/geometry/blockGeometry.ts: el canonico. Lo importa
//     scripts/cargar-geometrias-y-lados.mjs para cargar `manzana_lados`.
//   - editor-manzanas.html: `tramosAutomaticos` y compania.
//   - vista-hermano.html: `ladosDe`.
// Las dos paginas no se pueden importar: se extrae su codigo de caras del
// texto del HTML y se ejecuta con `vm`, como hace editor-renumeracion.test.mjs.
//
// Un test de texto no alcanza para esto. La diferencia de angulos estuvo mal
// en las tres copias a la vez (daba 356 en vez de 4 para +178 y -178 grados),
// asi que cualquier test que solo comparara una con otra habria pasado.
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'
import vm from 'node:vm'
import {
  angleDifference,
  automaticSideGroups,
  polygonRingLatLng,
  sidesForBlock,
} from '../src/features/map-editor/geometry/blockGeometry.ts'

const leer = (nombre) => readFile(new URL(`../${nombre}`, import.meta.url), 'utf8')
const [htmlEditor, htmlVista, jsonFormas] = await Promise.all([
  leer('editor-manzanas.html'),
  leer('vista-hermano.html'),
  leer('public/datos/manzanas-territorios.json'),
])
const formas = JSON.parse(jsonFormas)
const manzanasReales = Object.entries(formas.territorios).flatMap(([territorio, lista]) =>
  lista.map((mz) => ({ territorio, letra: mz.letra, geom: mz.geom })),
)

// ------------------------------------------------- extraer las copias
function bloque(fuente, desde, hasta, donde) {
  const a = fuente.indexOf(desde)
  assert.ok(a >= 0, `No encontré «${desde}» en ${donde}: ¿se movió la sección de caras?`)
  const b = fuente.indexOf(hasta, a)
  assert.ok(b > a, `No encontré «${hasta}» después de «${desde}» en ${donde}.`)
  return fuente.slice(a, b)
}

// Los objetos que crea `vm` son de otro "reino": deepStrictEqual los rechaza
// por el prototipo. Se pasan por JSON para compararlos como datos.
const plano = (x) => JSON.parse(JSON.stringify(x))

const codigoEditor = bloque(htmlEditor, 'const TOL_GRADOS = 25', 'function areaM2De', 'editor-manzanas.html')

function cargarEditor(codigo) {
  const contexto = vm.createContext({})
  vm.runInContext(codigo, contexto)
  return vm.runInContext(
    '({ difAng, rmb, mts, tramosAutomaticos, carasDeMz, largoDe, anilloLatLng, LARGO_MINIMO, TOL_GRADOS })',
    contexto,
  )
}
const editor = cargarEditor(codigoEditor)

// El mismo codigo con el largo minimo en 0: devuelve TODOS los grupos, sin
// descartar ninguno. Sirve para comprobar cuanto se descarta.
const codigoSinFiltro = codigoEditor.replace('const LARGO_MINIMO = 12', 'const LARGO_MINIMO = 0')
assert.notEqual(codigoSinFiltro, codigoEditor, 'No encontré LARGO_MINIMO = 12 en el editor.')
const editorSinFiltro = cargarEditor(codigoSinFiltro)

const codigoVista = bloque(htmlVista, 'const TOL_GRADOS = 25', 'const hechosDe', 'vista-hermano.html')
const contextoVista = vm.createContext({})
vm.runInContext(codigoVista, contextoVista)
const vista = vm.runInContext('({ ladosDe, difAngulo, rumbo, metros, TOL_GRADOS, LARGO_MINIMO })', contextoVista)

// ------------------------------------------------- comparaciones
// La vista del hermano devuelve PUNTOS, no indices, y los devuelve corridos
// hacia adentro (para que el dedo pueda elegir entre la cuadra de esta
// manzana y la de enfrente). Esta es la misma regla de `haciaAdentro` de
// vista-hermano.html: 9 m hacia el centro, sin pasar del 35% del camino.
function haciaAdentro(q, centro) {
  const d = vista.metros(q, centro)
  const k = d ? Math.min(9 / d, 0.35) : 0
  return [q[0] + (centro[0] - q[0]) * k, q[1] + (centro[1] - q[1]) * k]
}
function centroDe(pts) {
  const n = pts.length
  return pts.reduce((a, q) => [a[0] + q[0] / n, a[1] + q[1] / n], [0, 0])
}
// Lo que tendria que devolver la vista, a partir de los indices del canonico.
function esperadoEnVista(geom, grupos) {
  const pts = polygonRingLatLng(geom)
  const centro = centroDe(pts)
  return grupos.map((g) => g.map((i) => haciaAdentro(pts[i], centro)))
}
function mismosPuntos(a, b) {
  return (
    a.length === b.length &&
    a.every(
      (cara, i) =>
        cara.length === b[i].length &&
        cara.every((p, j) => Math.abs(p[0] - b[i][j][0]) < 1e-9 && Math.abs(p[1] - b[i][j][1]) < 1e-9),
    )
  )
}

// Corre las tres sobre una geometria y devuelve lo que dice cada una, o por
// que no pudo.
function lasTres(geom) {
  const canonico = automaticSideGroups(geom)
  const delEditor = plano(editor.tramosAutomaticos(geom))
  const delaVista = plano(vista.ladosDe({ geom }))
  return {
    canonico,
    delEditor,
    delaVista,
    iguales:
      JSON.stringify(canonico) === JSON.stringify(delEditor) &&
      mismosPuntos(delaVista, esperadoEnVista(geom, canonico)),
  }
}

// ------------------------------------------------- construir poligonos
// Un paso es [rumbo en grados, metros] con la convencion de `rmb`: 0 = este,
// 90 = norte, +-180 = oeste, -90 = sur. Cada vertice se calcula de forma que
// el rumbo que mide el algoritmo sea EXACTAMENTE el pedido, y por eso se puede
// apuntar justo al corte de +-180.
const LNG0 = -68.5355
const LAT0 = -31.5365
function caminar(pasos, [lng0, lat0] = [LNG0, LAT0]) {
  const vertices = [[lng0, lat0]]
  let lng = lng0
  let lat = lat0
  for (const [rumbo, metros] of pasos) {
    const t = metros / 111000
    const th = (rumbo * Math.PI) / 180
    const nuevoLng = lng + (t * Math.cos(th)) / Math.cos((lat * Math.PI) / 180)
    lat += t * Math.sin(th)
    lng = nuevoLng
    vertices.push([lng, lat])
  }
  return vertices
}
const cerrado = (vertices) => ({ type: 'Polygon', coordinates: [[...vertices, vertices[0]]] })
const abierto = (vertices) => ({ type: 'Polygon', coordinates: [[...vertices]] })
// Los mismos vertices sin el punto de cierre repetido (si lo tenian).
function sinCerrar(geom) {
  const anillo = geom.coordinates[0]
  const f = anillo[0]
  const l = anillo[anillo.length - 1]
  const estaCerrado = f[0] === l[0] && f[1] === l[1]
  return { type: 'Polygon', coordinates: [estaCerrado ? anillo.slice(0, -1) : [...anillo]] }
}

// La diferencia de angulos VIEJA, solo para comprobar que los casos de abajo
// de verdad ejercitan el error y no pasan por casualidad.
const difVieja = (a, b) => Math.abs((((a - b) + 180) % 360) - 180)
const difReferencia = (a, b) => {
  const r = (((a - b) % 360) + 360) % 360
  return Math.min(r, 360 - r)
}
// Con tolerancia: las dos formulas redondean distinto en el ultimo decimal
// (4.000000000000028 contra 4.000000000000014) y eso no es "equivocarse".
const laViejaSeEquivoca = (a, b) => Math.abs(difVieja(a, b) - difReferencia(a, b)) > 1e-6

// ====================================================================
// Q1: PARIDAD REAL
// ====================================================================

test('Q1: las tres implementaciones agrupan igual las 605 manzanas reales', () => {
  assert.equal(Object.keys(formas.territorios).length, 68)
  assert.equal(manzanasReales.length, 605)

  const distintas = []
  let lados = 0
  for (const mz of manzanasReales) {
    const r = lasTres(mz.geom)
    lados += r.canonico.length
    if (!r.iguales) {
      distintas.push({
        manzana: `${mz.territorio}/${mz.letra}`,
        canonico: r.canonico,
        editor: r.delEditor,
        vistaCoincide: mismosPuntos(r.delaVista, esperadoEnVista(mz.geom, r.canonico)),
      })
    }
  }
  assert.deepEqual(distintas, [], `${distintas.length} manzanas se agrupan distinto en las tres copias`)
  assert.ok(lados > 0)
})

test('Q1: el editor y el canonico calculan igual largo, rumbo y punto medio de cada cara', () => {
  // Esto es lo que `cargar-geometrias-y-lados.mjs` escribe en `manzana_lados`
  // (largo_m, rumbo_grados, medio): el editor tiene que mostrar los mismos.
  const distintas = []
  for (const mz of manzanasReales) {
    const delCanonico = sidesForBlock({ geometry: mz.geom })
    const delEditor = plano(editor.carasDeMz({ geom: mz.geom }))
    const resumenCanonico = delCanonico.map((s) => ({
      indices: s.indices,
      largo: s.lengthMeters,
      rumbo: s.bearingDegrees,
      medio: s.midpoint,
      puntos: s.points,
    }))
    const resumenEditor = delEditor.map((c) => ({
      indices: c.indices,
      largo: c.largo_m,
      rumbo: c.rumbo_grados,
      medio: c.medio,
      puntos: c.puntos,
    }))
    if (JSON.stringify(resumenCanonico) !== JSON.stringify(resumenEditor)) {
      distintas.push(`${mz.territorio}/${mz.letra}`)
    }
  }
  assert.deepEqual(distintas, [])
})

test('Q1: los umbrales de las tres copias son los mismos', () => {
  assert.equal(editor.TOL_GRADOS, 25)
  assert.equal(vista.TOL_GRADOS, 25)
  assert.equal(editor.LARGO_MINIMO, 12)
  assert.equal(vista.LARGO_MINIMO, 12)
})

test('Q1: la diferencia de angulos da lo mismo en las tres copias y siempre entre 0 y 180', () => {
  const casos = []
  for (let a = -180; a <= 180; a += 1) for (let b = -180; b <= 180; b += 1) casos.push([a, b])
  // Los rumbos reales no son enteros: tambien con decimales y fuera de rango.
  for (const a of [-179.99, -90.5, -0.25, 0.25, 12.345, 89.9, 90.1, 179.99, 540, -540, 720.5]) {
    for (const b of [-179.99, -90.5, -0.25, 0.25, 12.345, 89.9, 90.1, 179.99, -10, 360]) casos.push([a, b])
  }
  const malas = []
  for (const [a, b] of casos) {
    const esperado = difReferencia(a, b)
    const obtenidas = {
      canonico: angleDifference(a, b),
      editor: editor.difAng(a, b),
      vista: vista.difAngulo(a, b),
    }
    for (const [donde, valor] of Object.entries(obtenidas)) {
      const fueraDeRango = !(valor >= 0 && valor <= 180)
      if (fueraDeRango || Math.abs(valor - esperado) > 1e-9) malas.push({ a, b, donde, valor, esperado })
    }
    if (malas.length > 5) break
  }
  assert.deepEqual(malas, [])
  // La simetria que la formula vieja no tenia.
  for (const [a, b] of [[-178, 178], [178, -178], [-180, 180], [-170, 160], [165, -165]]) {
    assert.equal(angleDifference(a, b), angleDifference(b, a))
    assert.equal(editor.difAng(a, b), editor.difAng(b, a))
    assert.equal(vista.difAngulo(a, b), vista.difAngulo(b, a))
  }
})

test('Q1: la formula vieja es la que fallaba (guarda para que el test no pase en vacio)', () => {
  // `%` en JS conserva el signo: -356 + 180 = -176, que no se "da vuelta".
  assert.equal(difVieja(-178, 178), 356)
  assert.equal(difVieja(178, -178), 4)
  assert.equal(angleDifference(-178, 178), 4)
  assert.equal(editor.difAng(-178, 178), 4)
  assert.equal(vista.difAngulo(-178, 178), 4)
  assert.equal(angleDifference(-180, 180), 0)
})

// ====================================================================
// Q2: CASOS DE BORDE
// ====================================================================

// Cuadrilatero con un lado "doblado" justo en el rumbo `fi`: la manzana sale
// por un lado de 100 m, tiene dos tramos de 50 m que apuntan a `fi - e` y
// `fi + e` (en el orden que se pida) y vuelve por el cierre.
//
//   - Si los dos tramos difieren 25 grados o menos, son UNA cara: 3 en total.
//   - Si no, son dos: 4 en total.
//
// Con fi = 180 los dos rumbos caen a uno y otro lado del corte de +-180.
function ladoDoblado(fi, primero, segundo) {
  return caminar([[fi - 90, 100], [primero, 50], [segundo, 50]])
}
const UNIDAS = [[0, 1], [1, 2, 3], [3, 0]]
const SEPARADAS = [[0, 1], [1, 2], [2, 3], [3, 0]]

test('Q2: rumbos alrededor de +-180, 0, 90 y -90 se unen o se separan igual en las tres', () => {
  const fallosDeLaVieja = []
  for (const fi of [180, 0, 90, -90]) {
    for (const e of [2, 12, 12.6]) {
      for (const [primero, segundo] of [[fi - e, fi + e], [fi + e, fi - e]]) {
        const vertices = ladoDoblado(fi, primero, segundo)
        // La diferencia entre los dos tramos es 2e: se unen si 2e <= 25.
        const esperado = 2 * e <= 25 ? UNIDAS : SEPARADAS
        for (const geom of [cerrado(vertices), abierto(vertices)]) {
          const r = lasTres(geom)
          assert.deepEqual(r.canonico, esperado, `canonico fi=${fi} e=${e} orden=${primero},${segundo}`)
          assert.deepEqual(r.delEditor, esperado, `editor fi=${fi} e=${e} orden=${primero},${segundo}`)
          assert.ok(r.iguales, `vista fi=${fi} e=${e} orden=${primero},${segundo}`)
        }
        // Los rumbos que mide el algoritmo son los pedidos y la formula vieja
        // los habria juzgado mal en algunos de estos casos.
        const pts = polygonRingLatLng(cerrado(vertices))
        const r1 = editor.rmb(pts[1], pts[2])
        const r2 = editor.rmb(pts[2], pts[3])
        assert.ok(Math.abs(editor.difAng(r2, r1) - 2 * e) < 1e-6)
        if (laViejaSeEquivoca(r2, r1)) fallosDeLaVieja.push({ fi, e, primero, segundo })
      }
    }
  }
  // Solo los casos que cruzan el corte de +-180 le habrian fallado a la vieja:
  // alrededor de 0, 90 y -90 la vieja y la nueva dan lo mismo.
  assert.ok(fallosDeLaVieja.length > 0, 'ningun caso ejercita el error de la formula vieja')
  assert.ok(fallosDeLaVieja.every((c) => c.fi === 180), 'la vieja solo falla en el corte de +-180')
})

test('Q2: dos tramos a +178 y -178 son una sola cara, en cualquier orden', () => {
  for (const [primero, segundo] of [[178, -178], [-178, 178], [180, -180], [-180, 180], [178, 178], [-178, -178]]) {
    const geom = cerrado(ladoDoblado(180, primero, segundo))
    const r = lasTres(geom)
    assert.deepEqual(r.canonico, UNIDAS, `${primero} y ${segundo}`)
    assert.deepEqual(r.delEditor, UNIDAS, `${primero} y ${segundo}`)
    assert.ok(r.iguales)
  }
})

test('Q2: el cierre del anillo une el ultimo tramo con el primero aunque crucen +-180', () => {
  // Anillo que arranca en la mitad de un lado largo: el primer tramo sale
  // hacia el oeste (+-178) y el ultimo llega desde el este con el rumbo
  // opuesto en signo. Hay que unirlos en una cara que da la vuelta.
  for (const signo of [-1, 1]) {
    const vertices = caminar([[signo * 178, 60], [-90, 100], [0, 120], [90, 100]])
    const pts = polygonRingLatLng(cerrado(vertices))
    const primero = editor.rmb(pts[0], pts[1])
    const ultimo = editor.rmb(pts[4], pts[0])
    assert.ok(Math.abs(Math.abs(primero) - 178) < 0.01 && Math.abs(Math.abs(ultimo) - 178) < 0.01)
    assert.ok(primero * ultimo < 0, 'el primer y el ultimo tramo tienen que caer a lados opuestos del corte')

    const esperado = [[4, 0, 1], [1, 2], [2, 3], [3, 4]]
    const r = lasTres(cerrado(vertices))
    assert.deepEqual(r.canonico, esperado, `signo ${signo}`)
    assert.deepEqual(r.delEditor, esperado, `signo ${signo}`)
    assert.ok(r.iguales, `vista, signo ${signo}`)
  }
})

test('Q2: un anillo cerrado y el mismo sin cerrar dan las mismas caras', () => {
  const vertices = ladoDoblado(180, 178, -178)
  const conCierre = cerrado(vertices)
  const sinCierre = abierto(vertices)
  assert.equal(conCierre.coordinates[0].length, sinCierre.coordinates[0].length + 1)
  const a = lasTres(conCierre)
  const b = lasTres(sinCierre)
  assert.ok(a.iguales && b.iguales)
  assert.deepEqual(a.canonico, b.canonico)
  assert.deepEqual(a.delEditor, b.delEditor)
  assert.deepEqual(a.delaVista, b.delaVista)
  assert.deepEqual(a.canonico, UNIDAS)
})

test('Q2: abrir el anillo de las 605 manzanas reales no cambia las caras en ninguna copia', () => {
  const cambian = []
  for (const mz of manzanasReales) {
    const abierta = sinCerrar(mz.geom)
    const conCierre = lasTres(mz.geom)
    const sinCierre = lasTres(abierta)
    if (
      !sinCierre.iguales ||
      JSON.stringify(conCierre.canonico) !== JSON.stringify(sinCierre.canonico) ||
      JSON.stringify(conCierre.delEditor) !== JSON.stringify(sinCierre.delEditor) ||
      JSON.stringify(conCierre.delaVista) !== JSON.stringify(sinCierre.delaVista)
    ) {
      cambian.push(`${mz.territorio}/${mz.letra}`)
    }
  }
  assert.deepEqual(cambian, [])
})

test('Q2: un cierre casi igual al primer punto NO cuenta como cerrado, igual en las tres', () => {
  // Las tres comparan coordenadas con ===. Un cierre que difiere en la
  // septima cifra deja un vertice de mas pegado al primero: no se arregla
  // solo, pero tiene que dar lo mismo en las tres copias.
  const vertices = ladoDoblado(180, 178, -178)
  const [lng, lat] = vertices[0]
  const casiCerrado = { type: 'Polygon', coordinates: [[...vertices, [lng + 1e-7, lat]]] }
  assert.equal(polygonRingLatLng(casiCerrado).length, vertices.length + 1)
  const r = lasTres(casiCerrado)
  assert.ok(r.iguales)
})

test('Q2: poligono degenerado: el canonico lanza, el editor devuelve [] y la vista no se defiende (diferencia a proposito)', () => {
  // NO se unifica. El canonico valida antes de escribir en la base: una
  // geometria rota no puede llegar a `manzana_lados`. El editor, en cambio,
  // tiene que seguir dibujando mientras la persona edita vertices a mitad de
  // camino, asi que ante pocos vertices devuelve "ninguna cara" y listo
  // (pintarCaras ademas atrapa lo que lance). La vista del hermano no tiene
  // defensa alguna: recibe geometrias que ya pasaron por el canonico.
  const A = [LNG0, LAT0]
  const B = [LNG0 + 0.001, LAT0]
  const poly = (...pts) => ({ type: 'Polygon', coordinates: [pts] })
  const tresVertices = /tres vértices distintos/

  // Dos puntos distintos, cerrado: A, B, A.
  const dosPuntos = poly(A, B, A)
  assert.throws(() => automaticSideGroups(dosPuntos), tresVertices)
  assert.deepEqual(plano(editor.tramosAutomaticos(dosPuntos)), [])
  assert.deepEqual(plano(editor.carasDeMz({ geom: dosPuntos })), [])
  // La vista no lanza ni valida: devuelve una "cuadra" de ida y otra de vuelta
  // sobre el mismo segmento.
  const deLaVista = vista.ladosDe({ geom: dosPuntos })
  assert.equal(deLaVista.length, 2)

  // Dos puntos sin cerrar: A, B.
  const sinCierreDos = poly(A, B)
  assert.throws(() => automaticSideGroups(sinCierreDos), tresVertices)
  assert.deepEqual(plano(editor.tramosAutomaticos(sinCierreDos)), [])

  // Un solo punto.
  const unPunto = poly(A)
  assert.throws(() => automaticSideGroups(unPunto), tresVertices)
  assert.deepEqual(plano(editor.tramosAutomaticos(unPunto)), [])
  assert.throws(() => vista.ladosDe({ geom: unPunto }))

  // Anillo vacio: el canonico lo dice; el editor ni siquiera lo mira y
  // revienta al leer el primer punto (pintarCaras lo atrapa con try/catch).
  const vacio = poly()
  assert.throws(() => automaticSideGroups(vacio), tresVertices)
  // (El error nace dentro de `vm`: su TypeError es de otro reino y no pasa
  // `instanceof`, por eso se mira el nombre.)
  assert.throws(() => editor.tramosAutomaticos(vacio), (e) => e.name === 'TypeError')
  assert.throws(() => vista.ladosDe({ geom: vacio }))

  // Cuatro vertices pero solo dos distintos (A, A, A, B): el canonico cuenta
  // los DISTINTOS y lanza; el editor cuenta vertices y devuelve caras.
  const repetidos = poly(A, A, A, B)
  assert.throws(() => automaticSideGroups(repetidos), tresVertices)
  const delEditor = plano(editor.tramosAutomaticos(repetidos))
  assert.ok(delEditor.length > 0)

  // El canonico tambien rechaza lo que no es un poligono.
  assert.throws(() => automaticSideGroups({ type: 'Point', coordinates: A }), /polígono GeoJSON/)
})

// ------------------------------------------------- poligonos al azar
// PRNG con semilla fija (mulberry32): el test es repetible y, si falla, falla
// siempre con los mismos poligonos.
function mulberry32(semilla) {
  let a = semilla >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

// Un paseo cerrado de 3 a 24 vertices: arranca con un rumbo cualquiera (asi se
// cubre todo el circulo, +-180 incluido), mezcla tramos cortos (menos de 12 m,
// que se descartan) con largos, y gira poco (casi colineal) o mucho (esquina).
function poligonoAlAzar(azar) {
  const n = 3 + Math.floor(azar() * 22)
  let rumbo = azar() * 360 - 180
  const pasos = []
  for (let i = 0; i < n - 1; i += 1) {
    const corto = azar() < 0.25
    const metros = corto ? 2 + azar() * 9 : 15 + azar() * 110
    pasos.push([rumbo, metros])
    const giro = azar() < 0.55 ? (azar() - 0.5) * 70 : (azar() < 0.5 ? 1 : -1) * (55 + azar() * 70)
    rumbo += giro
  }
  const vertices = caminar(pasos, [LNG0 + (azar() - 0.5) * 0.02, LAT0 + (azar() - 0.5) * 0.02])
  return azar() < 0.5 ? cerrado(vertices) : abierto(vertices)
}

const aristas = (n) => Array.from({ length: n }, (_, i) => i)
const aristaDe = (g, k) => g[k - 1] // el tramo g[k-1] -> g[k] es la arista g[k-1] del anillo

test('Q2: poligonos al azar (semilla fija): mismas caras en las tres y largo de caras + descartado = perimetro', () => {
  const azar = mulberry32(20261027)
  const CANTIDAD = 3000
  let tocanElCorte = 0
  let conCaraDescartada = 0
  let conCierreUnido = 0
  const problemas = []

  for (let n = 0; n < CANTIDAD; n += 1) {
    const geom = poligonoAlAzar(azar)
    const pts = polygonRingLatLng(geom)
    const cant = pts.length
    const r = lasTres(geom)
    if (!r.iguales) {
      problemas.push({ n, problema: 'las tres no coinciden', canonico: r.canonico, editor: r.delEditor })
      continue
    }

    // Que el generador toque la zona del error: algun par de tramos seguidos
    // que la formula vieja juzga mal y que la nueva une.
    const rumbos = pts.map((p, i) => editor.rmb(p, pts[(i + 1) % cant]))
    for (let i = 1; i < cant; i += 1) {
      const a = rumbos[i]
      const b = rumbos[i - 1]
      if (laViejaSeEquivoca(a, b) && editor.difAng(a, b) <= editor.TOL_GRADOS) {
        tocanElCorte += 1
        break
      }
    }

    // Perimetro: la suma de todas las aristas del anillo, cierre incluido.
    const largoArista = aristas(cant).map((i) => editor.mts(pts[i], pts[(i + 1) % cant]))
    const perimetro = largoArista.reduce((t, x) => t + x, 0)

    // Todos los grupos, sin descartar ninguno: tienen que repartirse las
    // aristas del anillo sin dejar ni repetir ninguna.
    const todos = plano(editorSinFiltro.tramosAutomaticos(geom))
    const vistas = new Map()
    for (const g of todos) {
      for (let k = 1; k < g.length; k += 1) {
        assert.equal(g[k], (g[k - 1] + 1) % cant, `tramo no consecutivo en el poligono ${n}`)
        const arista = aristaDe(g, k)
        vistas.set(arista, (vistas.get(arista) || 0) + 1)
      }
    }
    const repartoBien = vistas.size === cant && [...vistas.values()].every((v) => v === 1)
    if (!repartoBien) {
      problemas.push({ n, problema: 'los grupos no reparten las aristas', todos })
      continue
    }

    // Caras (>= 12 m) + descartado (< 12 m) = perimetro. Lo descartado se
    // calcula con los grupos sin filtrar, no por diferencia.
    const largoGrupo = (g) => editor.largoDe(pts, g)
    const largas = todos.filter((g) => largoGrupo(g) >= editor.LARGO_MINIMO)
    const descartadas = todos.filter((g) => largoGrupo(g) < editor.LARGO_MINIMO)
    const sumaCaras = largas.reduce((t, g) => t + largoGrupo(g), 0)
    const sumaDescartado = descartadas.reduce((t, g) => t + largoGrupo(g), 0)
    if (Math.abs(sumaCaras + sumaDescartado - perimetro) > 1e-6) {
      problemas.push({ n, problema: 'caras + descartado != perimetro', sumaCaras, sumaDescartado, perimetro })
      continue
    }
    if (descartadas.length) conCaraDescartada += 1
    // Una cara que da la vuelta al cierre: pasa del ultimo vertice al 0 y
    // sigue (si el 0 fuera el final del grupo, no habria union).
    const daLaVuelta = (g) => g.some((v, k) => k > 0 && k < g.length - 1 && g[k - 1] === cant - 1 && v === 0)
    if (todos.some(daLaVuelta)) conCierreUnido += 1

    // Lo que devuelven las implementaciones es exactamente lo que queda tras
    // descartar, y si no queda nada, el primer grupo (caso borde conocido).
    const esperado = largas.length ? largas : [todos[0]]
    if (JSON.stringify(r.canonico) !== JSON.stringify(esperado)) {
      problemas.push({ n, problema: 'el resultado no es "todos menos los cortos"', canonico: r.canonico, esperado })
      continue
    }

    // Lo mismo desde el lado del canonico: sus caras no se pisan, y sumadas
    // con las aristas que quedaron fuera dan el perimetro.
    const cubiertas = new Set()
    let sumaCanonico = 0
    for (const g of r.canonico) {
      for (let k = 1; k < g.length; k += 1) {
        assert.ok(!cubiertas.has(aristaDe(g, k)), `arista repetida en el poligono ${n}`)
        cubiertas.add(aristaDe(g, k))
        sumaCanonico += largoArista[aristaDe(g, k)]
      }
    }
    const fuera = aristas(cant).filter((i) => !cubiertas.has(i)).reduce((t, i) => t + largoArista[i], 0)
    if (Math.abs(sumaCanonico + fuera - perimetro) > 1e-6) {
      problemas.push({ n, problema: 'canonico: caras + aristas fuera != perimetro', sumaCanonico, fuera, perimetro })
    }
  }

  assert.deepEqual(problemas.slice(0, 3), [], `${problemas.length} de ${CANTIDAD} poligonos con problemas`)
  // El generador tiene que ejercitar lo que se quiere probar.
  assert.ok(tocanElCorte >= 100, `solo ${tocanElCorte} poligonos tocan el corte de +-180`)
  assert.ok(conCaraDescartada >= 100, `solo ${conCaraDescartada} poligonos descartan alguna cara`)
  assert.ok(conCierreUnido >= 20, `solo ${conCierreUnido} poligonos unen el cierre del anillo`)
})
