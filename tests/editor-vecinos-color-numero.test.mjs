import test from 'node:test'
import assert from 'node:assert/strict'
import vm from 'node:vm'
import { area } from '@turf/area'
import { booleanIntersects } from '@turf/boolean-intersects'
import { html, tramo } from './fixtures/editor-fuente.mjs'

const cuadrado = (x, y, s = 0.001) => ({
  type: 'Polygon',
  coordinates: [[[x, y], [x + s, y], [x + s, y + s], [x, y + s], [x, y]]],
})
// Lo que sale de un vm trae los prototipos de OTRO contexto: para comparar con
// deepEqual se pasa por JSON.
const plano = (x) => JSON.parse(JSON.stringify(x))
const feat = vm.runInContext(html.match(/const feat = (\(geom\) => \(\{[^\n]*\}\))\n/)[1], vm.createContext({}))
const PALETA = vm.runInContext(html.match(/const PALETA = (\[[^\]]*\])/)[1], vm.createContext({}))
const nombresColores = vm.runInContext(html.match(/const nombresColores = (\[[^\]]*\])/)[1], vm.createContext({}))

// ====================================================== quién toca a quién
function armarVecinos (extra = {}) {
  const llamadas = { intersects: 0 }
  const manzanas = new Map()
  const poner = (id, territorio, geom) => manzanas.set(id, { id, territorio, geom })
  // A (dos manzanas) toca a B por un borde; B toca a D; C está lejos; E toca a A por una punta.
  poner('a1', 'A', cuadrado(0, 0))
  poner('a2', 'A', cuadrado(0.01, 0))
  poner('b1', 'B', cuadrado(0.001, 0))
  poner('b2', 'B', cuadrado(0.011, 0))
  poner('d1', 'D', cuadrado(0.002, 0))
  poner('c1', 'C', cuadrado(0.5, 0.5))
  poner('e1', 'E', cuadrado(-0.001, -0.001))
  poner('libre', null, cuadrado(0, 0.001))
  const ctx = vm.createContext({
    manzanas, feat, activo: 'A', vecinos: 2,
    booleanIntersects: (a, b) => { llamadas.intersects++; return booleanIntersects(a, b) },
    ...extra,
  })
  vm.runInContext(tramo('function bbox', 'const enBbox'), ctx)
  vm.runInContext(tramo('const idsDeGeom', '// ---------------------------------------------------------------- acciones'), ctx)
  return { ctx, manzanas, llamadas, vecinosDe: (id) => vm.runInContext(`vecinosDe(${JSON.stringify(id)})`, ctx) }
}

test('vecinosDe cuenta cuántas manzanas de cada otro territorio tocan al elegido', () => {
  const { vecinosDe } = armarVecinos()
  assert.deepEqual(plano([...vecinosDe('A')]), [['B', 2], ['E', 1]])
  assert.deepEqual(plano([...vecinosDe('B')]).sort(), [['A', 2], ['D', 1]])
  assert.deepEqual(plano([...vecinosDe('C')]), [])
  assert.deepEqual(plano([...vecinosDe('no-existe')]), [])
})

test('vecinosDe evita el booleanIntersects entre cajas que no se cruzan y guarda el resultado', () => {
  const { vecinosDe, llamadas, manzanas } = armarVecinos()
  vecinosDe('A')
  const primera = llamadas.intersects
  // 7 manzanas ajenas al lado de 2 propias son 14 pares en el peor caso; las cajas dejan unos pocos.
  assert.ok(primera > 0 && primera < 8, `llamadas a booleanIntersects: ${primera}`)
  vecinosDe('A')
  vecinosDe('A')
  assert.equal(llamadas.intersects, primera, 'la segunda y la tercera salen del caché')

  // Cambia el dueño de una manzana: se recalcula.
  manzanas.get('b2').territorio = 'C'
  const sinB2 = vecinosDe('A')
  assert.ok(llamadas.intersects > primera)
  assert.equal(sinB2.get('B'), 1)

  // La forma se reemplaza por un objeto nuevo (nunca se muta): también invalida.
  const antes = llamadas.intersects
  manzanas.get('b1').geom = cuadrado(0.5, 0.5)
  assert.equal(vecinosDe('A').has('B'), false)
  assert.ok(llamadas.intersects >= antes)
})

test('calcularVisibles usa los vecinos que más se tocan y respeta Solo este y Todos', () => {
  const { ctx } = armarVecinos()
  const visibles = () => [...vm.runInContext('calcularVisibles()', ctx)]
  assert.deepEqual(visibles(), ['A', 'B', 'E'])
  ctx.vecinos = 1
  assert.deepEqual(visibles(), ['A', 'B'], 'B se toca con dos manzanas y E con una')
  ctx.vecinos = 0
  assert.deepEqual(visibles(), ['A'])
  ctx.vecinos = 99
  assert.equal(vm.runInContext('calcularVisibles()', ctx), null)
  ctx.vecinos = 2
  ctx.activo = null
  assert.equal(vm.runInContext('calcularVisibles()', ctx), null)
})

test('un geom que hace fallar a booleanIntersects no rompe el panel', () => {
  const { vecinosDe } = armarVecinos({
    booleanIntersects: () => { throw new Error('geometría rota') },
  })
  assert.deepEqual([...vecinosDe('A')], [])
})

// ============================================== colores de los vecinos (E3)
function armarColores ({ vecinos = [], propio = '#407DFE', otros = [], cambia = true } = {}) {
  // `vecinos`: [numero, color] de los territorios que tocan al activo ('10').
  const territorios = new Map([['t', { id: 't', numero: '10', color: propio }]])
  const toques = new Map()
  vecinos.forEach(([numero, color], i) => { territorios.set('v' + i, { id: 'v' + i, numero, color }); toques.set('v' + i, 1) })
  otros.forEach((color, i) => territorios.set('o' + i, { id: 'o' + i, numero: String(100 + i), color }))
  const botones = PALETA.map((color, i) => ({
    dataset: { color, nombre: nombresColores[i] }, clases: {}, attrs: {}, title: nombresColores[i],
    classList: { toggle (n, v) { this.f[n] = v }, f: {} },
    setAttribute (k, v) { this.attrs[k] = v },
  }))
  const leyenda = { innerHTML: '', textContent: '' }
  const avisos = []
  const cambios = []
  const ctx = vm.createContext({
    PALETA, nombresColores, territorios, activo: 't', icono: (n) => `[${n}]`,
    vecinosDe: () => toques,
    document: {
      querySelectorAll: () => botones,
      getElementById: (id) => (id === 'coloresAlLado' ? leyenda : {}),
    },
    avisar: (m) => avisos.push(m),
    cambiarColorTerritorio: (c) => { cambios.push(c); if (cambia) territorios.get('t').color = c },
  })
  vm.runInContext(tramo('function escHtml', "document.getElementById('bSugerirColor').onclick"), ctx)
  return { ctx, territorios, botones, leyenda, avisos, cambios, toques }
}

test('la paleta marca con raya y con texto los colores que usan los vecinos', () => {
  const e = armarColores({
    vecinos: [['6', '#407DFE'], ['12', '#01bc73'], ['8', '#01BC73'], ['7', '#abcdef']],
  })
  vm.runInContext("pintarColoresVecinos(territorios.get('t'), 5)", e.ctx)
  const por = Object.fromEntries(e.botones.map((b) => [b.dataset.nombre, b]))
  assert.equal(por.Azul.classList.f['al-lado'], true)
  assert.equal(por.Verde.classList.f['al-lado'], true)
  assert.equal(por.Naranja.classList.f['al-lado'], false)
  assert.equal(por.Azul.title, 'Azul, en uso al lado (territorio 6)')
  assert.equal(por.Verde.attrs['aria-label'], 'Verde, en uso al lado (territorios 8 y 12)', 'ordenados de menor a mayor, en lenguaje de persona')
  assert.equal(por.Naranja.title, 'Naranja', 'los libres conservan su nombre solo')
  // Y el texto de abajo dice lo mismo sin depender del color.
  assert.match(e.leyenda.innerHTML, /En uso al lado:/)
  assert.match(e.leyenda.innerHTML, /Azul \(territorio 6\)/)
  assert.match(e.leyenda.innerHTML, /Verde \(territorios 8 y 12\)/)
  assert.match(e.leyenda.innerHTML, /#ABCDEF \(territorio 7\)/, 'un color propio se nombra por su código')
  // El color del activo ya lo usa el 6: se avisa con palabras y con ícono.
  assert.match(e.leyenda.innerHTML, /El color de este territorio ya lo usa el territorio 6/)
  assert.match(e.leyenda.innerHTML, /Sugerir color/)
  assert.match(e.leyenda.innerHTML, /\[error\]/)
})

test('sin choque la leyenda lista a los vecinos pero no alarma', () => {
  const e = armarColores({ propio: '#E0447C', vecinos: [['6', '#407DFE']] })
  vm.runInContext("pintarColoresVecinos(territorios.get('t'), 5)", e.ctx)
  assert.match(e.leyenda.innerHTML, /En uso al lado:/)
  assert.doesNotMatch(e.leyenda.innerHTML, /ya lo usa/)
})

test('la leyenda cuenta cada caso: sin vecinos, sin manzanas, colores inválidos', () => {
  const solo = armarColores()
  vm.runInContext("pintarColoresVecinos(territorios.get('t'), 5)", solo.ctx)
  assert.match(solo.leyenda.textContent, /no toca a ningún otro/)
  assert.ok(solo.botones.every((b) => b.classList.f['al-lado'] === false))

  const vacio = armarColores({ vecinos: [['6', '#407DFE']] })
  vm.runInContext("pintarColoresVecinos(territorios.get('t'), 0)", vacio.ctx)
  assert.match(vacio.leyenda.textContent, /Sumale manzanas/)

  const roto = armarColores({ vecinos: [['6', 'red;x'], ['7', null]] })
  vm.runInContext("pintarColoresVecinos(territorios.get('t'), 3)", roto.ctx)
  assert.match(roto.leyenda.textContent, /no tienen un color válido/)
})

test('lo que viene de la base se escapa antes de entrar al HTML de la leyenda', () => {
  const e = armarColores({ propio: '#E0447C', vecinos: [['5<img src=x onerror=alert(1)>', '#407DFE'], ['a&b', '#407DFE']] })
  vm.runInContext("pintarColoresVecinos(territorios.get('t'), 5)", e.ctx)
  assert.doesNotMatch(e.leyenda.innerHTML, /<img/)
  assert.match(e.leyenda.innerHTML, /a&amp;b/)
})

test('Sugerir color elige uno de la paleta que ningún vecino use, el menos repetido en el mapa', () => {
  const e = armarColores({
    vecinos: [['6', '#407DFE'], ['8', '#01BC73'], ['7', '#FA5D27']],
    // Violeta lo usan tres territorios lejanos; Índigo, ninguno: gana Índigo.
    otros: ['#8D5AF8', '#8D5AF8', '#8D5AF8', '#CAD510', '#E0447C', '#0FB5C9'],
  })
  vm.runInContext('sugerirColor()', e.ctx)
  assert.deepEqual(e.cambios, ['#5554F2'])
  assert.match(e.avisos.at(-1), /Color cambiado a <b>Índigo<\/b>/)
  assert.match(e.avisos.at(-1), /Cmd\+Z/)
})

test('Sugerir color no inventa nada cuando no hace falta o no se puede', () => {
  // El color actual ya está libre: se deja.
  const libre = armarColores({ propio: '#E0447C', vecinos: [['6', '#407DFE']] })
  vm.runInContext('sugerirColor()', libre.ctx)
  assert.deepEqual(libre.cambios, [])
  assert.match(libre.avisos.at(-1), /Lo dejé como está/)

  // No toca a nadie.
  const solo = armarColores()
  vm.runInContext('sugerirColor()', solo.ctx)
  assert.deepEqual(solo.cambios, [])
  assert.match(solo.avisos.at(-1), /no toca a ningún otro/)

  // Los vecinos ya usan los ocho colores.
  const todos = armarColores({ vecinos: PALETA.map((c, i) => [String(i + 1), c]) })
  vm.runInContext('sugerirColor()', todos.ctx)
  assert.deepEqual(todos.cambios, [])
  assert.match(todos.avisos.at(-1), /ocho colores/)

  // cambiarColorTerritorio se negó (guardado en curso): no se anuncia un cambio que no ocurrió.
  const negado = armarColores({ vecinos: [['6', '#407DFE']], cambia: false })
  vm.runInContext('sugerirColor()', negado.ctx)
  assert.equal(negado.cambios.length, 1)
  assert.equal(negado.avisos.length, 0)
})

test('el selector de color de la ficha tiene su botón, de 38 px, y la paleta usa muestras de 38 px', () => {
  assert.match(html, /<button class="b sec" id="bSugerirColor"[^>]*min-height:38px[^>]*>[\s\S]*?Sugerir color<\/button>/)
  assert.match(html, /\.muestra\{[^}]*width:38px;height:38px/)
  assert.match(html, /\.muestra\.al-lado::after/)
  assert.match(html, /id="colorTerritorio"[^>]*aria-describedby="coloresAlLado"/)
  assert.match(html, /<p class="color-vecinos" id="coloresAlLado" aria-live="polite">/)
  // El panel repinta la leyenda cada vez, con el territorio abierto.
  assert.match(tramo('function refrescarPanel', '// Volver a "nada seleccionado"'), /pintarColoresVecinos\(t, propias\.length\)/)
})

// ============================================== el número dentro del polígono (E4)
function armarNumero ({ rotulo } = {}) {
  const llamadas = { rotulo: 0 }
  const ctx = vm.createContext({
    area, feat,
    puntoDeRotulo: rotulo || ((g) => { llamadas.rotulo++; const r = g.coordinates[0]; return [r[0][0] + 0.0005, r[0][1] + 0.0005] }),
  })
  vm.runInContext(tramo('const areaDeGeom', 'function guardar ()'), ctx)
  const manzana = (id, geom) => ({ id, geom })
  return { ctx, llamadas, manzana, punto: (id, propias) => vm.runInContext('puntoDeNumero', ctx)(id, propias) }
}

test('el número va sobre la manzana más grande, no en el promedio de los vértices', () => {
  const e = armarNumero()
  // Territorio "en L": una manzana grande y otra chica, con una calle y un hueco entre las dos.
  const grande = e.manzana('g', cuadrado(0, 0, 0.002))
  const chica = e.manzana('c', cuadrado(0.01, 0, 0.0005))
  const { punto, idManzana } = e.punto('t', [chica, grande])
  assert.equal(idManzana, 'g')
  assert.ok(punto[0] >= 0 && punto[0] <= 0.002 && punto[1] >= 0 && punto[1] <= 0.002, 'cae adentro de la grande')
  // El promedio de vértices de las dos caía en el hueco: ahí no hay manzana.
  const todos = [...grande.geom.coordinates[0], ...chica.geom.coordinates[0]]
  const promedio = todos.reduce((s, p) => s + p[0], 0) / todos.length
  assert.ok(promedio > 0.002 && promedio < 0.01, 'el promedio viejo estaba en el hueco')
})

test('el punto del número se cachea por territorio y se recalcula solo si cambian sus manzanas', () => {
  const e = armarNumero()
  const g = e.manzana('g', cuadrado(0, 0, 0.002))
  const c = e.manzana('c', cuadrado(0.01, 0, 0.0005))
  const primero = e.punto('t', [g, c])
  const otraVez = e.punto('t', [g, c])
  assert.equal(otraVez, primero, 'mismo resultado, mismo objeto')
  assert.equal(e.llamadas.rotulo, 1, 'pan y zoom no recalculan: puntoDeRotulo corrió una sola vez')

  // Otro territorio tiene su propio caché.
  e.punto('u', [e.manzana('x', cuadrado(1, 1))])
  assert.equal(e.llamadas.rotulo, 2)
  e.punto('t', [g, c])
  assert.equal(e.llamadas.rotulo, 2)

  // La forma de una manzana se reemplaza por un objeto nuevo: recalcula.
  const g2 = { ...g, geom: cuadrado(0, 0, 0.003) }
  e.punto('t', [g2, c])
  assert.equal(e.llamadas.rotulo, 3)
  // Una manzana que entra o sale también.
  e.punto('t', [g2])
  assert.equal(e.llamadas.rotulo, 4)
  // Un territorio sin manzanas no tiene dónde ponerlo.
  assert.equal(e.punto('vacio', []).punto, null)
})

test('si no hay forma de rotular la manzana más grande se cae al promedio de sus vértices', () => {
  const e = armarNumero({ rotulo: () => { throw new Error('geometría imposible') } })
  const { punto } = e.punto('t', [e.manzana('g', cuadrado(0, 0, 0.002))])
  assert.ok(Math.abs(punto[0] - 0.0008) < 1e-9 && Math.abs(punto[1] - 0.0008) < 1e-9)
})

test('refrescarMapa ubica el número con puntoDeNumero y lo sube si tapa la letra del activo', () => {
  const fuente = tramo('function refrescarMapa', 'function resaltarEnMapa')
  assert.match(fuente, /puntoDeNumero\(t\.id, propiasDe\.get\(t\.id\) \|\| \[\]\)/)
  assert.doesNotMatch(fuente, /acum\.sx|sx \/ n/, 'ya no se promedia')
  // Solo con letras a la vista, y solo para el activo, el número se corre por encima de la letra.
  assert.match(fuente, /const sobreLetra = esActivo && verLetras && zoom >= ZOOM_LETRAS && manzanas\.get\(idManzana\)\?\.letra/)
  assert.match(fuente, /iconAnchor: \[lado \/ 2, lado \/ 2 \+ subir\]/)
})
