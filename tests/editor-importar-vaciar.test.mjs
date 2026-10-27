import test from 'node:test'
import assert from 'node:assert/strict'
import vm from 'node:vm'
import { body, html, tramo } from './fixtures/editor-fuente.mjs'

// ---------------------------------------------------------------- utilidades
const util = vm.createContext({})
vm.runInContext(tramo('function escHtml', 'function numerosEnTexto'), util)
const { escHtml, esColorHex } = util
const PALETA = vm.runInContext(html.match(/const PALETA = (\[[^\]]*\])/)[1], vm.createContext({}))

const cuadrado = (x = -68.5, y = -31.5, s = 0.001) => ({
  type: 'Polygon',
  coordinates: [[[x, y], [x + s, y], [x + s, y + s], [x, y + s], [x, y]]],
})

// ------------------------------------------------------ Importar (validación)
const fuenteImportar = tramo('function gestoSinCerrar', '// "Más": se cierra tocando afuera')

function cargarValidacion () {
  const ctx = vm.createContext({ escHtml, esColorHex, PALETA })
  vm.runInContext(tramo('function geometriaValida', "document.getElementById('bImport').onclick"), ctx)
  return ctx
}

test('validarImportacion acepta un respaldo mínimo y devuelve copias limpias', () => {
  const ctx = cargarValidacion()
  const geometria = cuadrado()
  const entrada = {
    generado: 'x',
    territorios: [{ id: 'a', numero: 5, sector: 'II', color: '#407dfe', letras: 'proximidad', raro: '<script>' }],
    manzanas: [{ id: 'm1', letra: 'a', territorio: 'a', geometria }],
  }
  const v = vm.runInContext('validarImportacion', ctx)(entrada)
  assert.equal(v.ok, true)
  assert.deepEqual(JSON.parse(JSON.stringify(v.territorios)), [{ id: 'a', numero: '5', sector: 'II', color: '#407dfe', letras: 'proximidad' }])
  assert.equal(v.manzanas[0].id, 'm1')
  assert.notEqual(v.manzanas[0].geometria, geometria, 'la geometría del archivo no se reutiliza: se copia')
  assert.deepEqual(JSON.parse(JSON.stringify(v.manzanas[0].geometria)), geometria)
})

test('validarImportacion ignora numeroBase y colorBase y cuenta los territorios que los traían', () => {
  const ctx = cargarValidacion()
  const v = vm.runInContext('validarImportacion', ctx)({
    territorios: [
      { id: 'a', numero: '58', numeroBase: '57', color: '#01bc73' },
      { id: 'b', numero: '57', color: '#407dfe', colorBase: '#fa5d27' },
      { id: 'c', numero: '60', color: '#407dfe' },
    ],
    manzanas: [],
  })
  assert.equal(v.ok, true)
  assert.equal(v.pendientes, 2)
  for (const t of v.territorios) {
    assert.equal('numeroBase' in t, false)
    assert.equal('colorBase' in t, false)
  }
})

test('validarImportacion sanea sector y color, cierra el anillo y descarta huecos', () => {
  const ctx = cargarValidacion()
  const abierto = { type: 'Polygon', coordinates: [[[0, 0], [1, 0], [1, 1]], [[0.2, 0.2], [0.3, 0.2], [0.3, 0.3], [0.2, 0.2]]] }
  const v = vm.runInContext('validarImportacion', ctx)({
    territorios: [{ id: 'a', numero: '1', sector: '<x>', color: 'red;background:url(x)' }],
    manzanas: [{ id: 'm', territorio: 'a', geometria: abierto }],
  })
  assert.equal(v.ok, true)
  assert.equal(v.territorios[0].sector, 'I')
  assert.equal(v.territorios[0].color, PALETA[0])
  const anillo = v.manzanas[0].geometria.coordinates
  assert.equal(anillo.length, 1, 'solo el anillo exterior')
  assert.deepEqual(anillo[0][0], anillo[0][anillo[0].length - 1], 'el anillo queda cerrado')
  assert.equal(anillo[0].length, 4)
})

test('validarImportacion rechaza lo que no sirve, con el motivo en voz rioplatense', () => {
  const ctx = cargarValidacion()
  const validar = vm.runInContext('validarImportacion', ctx)
  const t = (extra = {}) => ({ id: 'a', numero: '5', ...extra })
  const mz = (extra = {}) => ({ id: 'm1', territorio: 'a', geometria: cuadrado(), ...extra })
  const casos = [
    [null, /respaldo de territorios/],
    [[], /respaldo de territorios/],
    ['texto', /respaldo de territorios/],
    [{ territorios: [], manzanas: [] }, /ningún territorio/],
    [{ manzanas: [] }, /ningún territorio/],
    [{ territorios: [t()] }, /lista de manzanas/],
    [{ territorios: [null], manzanas: [] }, /mal formado/],
    [{ territorios: [t({ id: '' })], manzanas: [] }, /identificador/],
    [{ territorios: [t(), t({ numero: '6' })], manzanas: [] }, /mismo identificador/],
    [{ territorios: [t(), t({ id: 'b' })], manzanas: [] }, /repetido/],
    [{ territorios: [t({ numero: '<img src=x onerror=alert(1)>' })], manzanas: [] }, /número válido/],
    [{ territorios: [t({ numero: '' })], manzanas: [] }, /número válido/],
    [{ territorios: [t()], manzanas: [mz({ territorio: 'otro' })] }, /territorio que no está/],
    [{ territorios: [t()], manzanas: [mz({ territorio: null })] }, /territorio que no está/],
    [{ territorios: [t()], manzanas: [mz({ id: '' })] }, /identificador/],
    [{ territorios: [t()], manzanas: [mz(), mz()] }, /dos veces/],
    [{ territorios: [t()], manzanas: [mz({ geometria: null })] }, /forma válida/],
    [{ territorios: [t()], manzanas: [mz({ geometria: { type: 'Point', coordinates: [0, 0] } })] }, /forma válida/],
    [{ territorios: [t()], manzanas: [mz({ geometria: { type: 'Polygon', coordinates: [[[0, 0], [1, 0]]] } })] }, /forma válida/],
    [{ territorios: [t()], manzanas: [mz({ geometria: { type: 'Polygon', coordinates: [[[0, 0], [1, 0], [1, 'x']]] } })] }, /forma válida/],
    [{ territorios: [t()], manzanas: [mz({ geometria: { type: 'Polygon', coordinates: [[[0, 0], [1, 0], [1, 999]]] } })] }, /forma válida/],
  ]
  for (const [entrada, motivo] of casos) {
    const v = validar(entrada)
    assert.equal(v.ok, false, `debería rechazar ${JSON.stringify(entrada)?.slice(0, 80)}`)
    assert.match(v.motivo, motivo)
  }
})

// -------------------------------------------------- Importar (el manejador)
function armarEditor ({ confirmacion = true, dialogoRespuesta = 'vaciar' } = {}) {
  const elementos = {}
  const get = (id) => (elementos[id] ??= { id, open: true, files: [], value: 'archivo.json' })
  const llamadas = []
  const avisos = []
  const confirmaciones = []
  const dialogos = []
  const territorios = new Map([
    ['t1', { id: 't1', numero: '5', sector: 'I', color: '#407DFE', numeroBase: '4', colorBase: '#01BC73' }],
    ['t2', { id: 't2', numero: '6', sector: 'I', color: '#FA5D27' }],
  ])
  const manzanas = new Map([
    ['m1', { id: 'm1', geom: cuadrado(-68.5), territorio: 't1', letra: 'a', orden: 3, editada: false, caras: [[0, 1]], carasN: 4 }],
    ['m2', { id: 'm2', geom: cuadrado(-68.4), territorio: 't2', letra: 'a', orden: 1 }],
    ['m3', { id: 'm3', geom: cuadrado(-68.3), territorio: null }],
  ])
  const ctx = vm.createContext({
    document: { getElementById: get },
    dibujo: [], letrasNuevas: [], mzSel: new Set(['m1']), paraFusionar: ['m1'], cortePuntos: [[0, 0]],
    capaCorte: { clearLayers: () => llamadas.push('capaCorte') },
    capaLetrasNuevas: { clearLayers: () => llamadas.push('capaLetrasNuevas') },
    terminarEdicion: () => llamadas.push('terminarEdicion'),
    cancelarDibujo: () => llamadas.push('cancelarDibujo'),
    resaltarEnMapa: () => llamadas.push('resaltarEnMapa'),
    escHtml, esColorHex, PALETA, icono: () => '',
    avisar: (m) => avisos.push(m),
    confirmar: async (...a) => { confirmaciones.push(a); return confirmacion },
    dialogo: async (o) => { dialogos.push(o); return dialogoRespuesta },
    instantanea: () => llamadas.push('instantanea'),
    limpiarDiag: (m) => { delete m.__diag },
    reletrar: (id) => llamadas.push('reletrar:' + id),
    refrescar: () => llamadas.push('refrescar'),
    prepararIman: () => llamadas.push('prepararIman'),
    // Lee el Map vigente del contexto: el manejador lo reemplaza entero.
    estadoActual: () => JSON.stringify([...ctx.territorios.keys()]),
    pintarEstadoBorrador: () => llamadas.push('pintarEstadoBorrador'),
    territorios, manzanas,
    tocados: new Set(['t1', 't2']),
    descartadas: new Set(['m3', 'm9']),
    activo: 't1',
    vaciadoSinBase: false, estadoVaciado: null,
  })
  vm.runInContext(fuenteImportar, ctx)
  return { ctx, get, llamadas, avisos, confirmaciones, dialogos, manzanas, territorios }
}

async function importar (editor, contenido) {
  const entrada = editor.get('fImport')
  entrada.files = [{ text: async () => contenido }]
  await editor.get('fImport').onchange({ target: entrada })
  return entrada
}

test('un archivo que no es JSON avisa y no toca nada, ni siquiera el historial', async () => {
  const e = armarEditor()
  const entrada = await importar(e, 'esto no es json {')
  assert.equal(e.avisos.length, 1)
  assert.match(e.avisos[0], /No pude leer ese archivo/)
  assert.match(e.avisos[0], /No se cambió nada/)
  assert.equal(e.llamadas.length, 0, 'ni instantánea ni refrescar')
  assert.equal(e.territorios.size, 2)
  assert.equal(entrada.value, '', 'se vacía el input para poder elegir de nuevo el mismo archivo')
})

test('un JSON de otra forma avisa por qué y la instantánea no se toma', async () => {
  const e = armarEditor()
  await importar(e, JSON.stringify({ territorios: [{ id: 'a', numero: '1' }], manzanas: [{ id: 'm', territorio: 'zzz', geometria: cuadrado() }] }))
  assert.match(e.avisos[0], /Ese archivo no sirve para importar/)
  assert.match(e.avisos[0], /territorio que no está/)
  assert.equal(e.llamadas.includes('instantanea'), false)
  assert.equal(e.confirmaciones.length, 0, 'ni siquiera se pregunta')
  assert.equal(e.territorios.size, 2)
  assert.equal(e.ctx.tocados.size, 2)
})

test('importar bien: reemplaza, reinicia lo pendiente y la instantánea va después de validar', async () => {
  const e = armarEditor()
  const gm1 = cuadrado(-68.5, -31.5, 0.002)
  await importar(e, JSON.stringify({
    territorios: [{ id: 'n1', numero: '5', color: '#01bc73', numeroBase: '4', colorBase: '#fa5d27' }],
    manzanas: [
      { id: 'm1', territorio: 'n1', geometria: gm1 },
      { id: 'm9', territorio: 'n1', geometria: cuadrado(-68.2) },
      { id: 'm-nueva', territorio: 'n1', geometria: cuadrado(-68.1) },
    ],
  }))
  assert.equal(e.confirmaciones.length, 1, 'se pide confirmar porque se reemplaza lo de antes')
  assert.match(e.confirmaciones[0][1], /borrador compartido/)

  // Orden: primero se cortan los gestos, después la instantánea, y refrescar al final.
  const i = e.llamadas.indexOf('instantanea')
  assert.ok(i > e.llamadas.indexOf('terminarEdicion'))
  assert.equal(e.llamadas.filter((x) => x === 'instantanea').length, 1)
  assert.ok(e.llamadas.indexOf('refrescar') > i)
  assert.ok(e.llamadas.indexOf('prepararIman') > e.llamadas.indexOf('refrescar'), 'el imán rehace sus vecinos con las formas nuevas')

  const { territorios, manzanas, ctx } = e
  assert.deepEqual([...ctx.territorios.keys()], ['n1'], 'el Map se reemplaza entero')
  assert.notEqual(ctx.territorios, territorios)
  const t = ctx.territorios.get('n1')
  assert.equal('numeroBase' in t, false)
  assert.equal('colorBase' in t, false)
  assert.equal(ctx.tocados.size, 0)
  assert.equal(ctx.activo, null)
  assert.equal(ctx.mzSel.size, 0)
  assert.equal(ctx.paraFusionar.length, 0)
  assert.equal(ctx.cortePuntos.length, 0)

  // Lo que el archivo vuelve a traer deja de estar descartado; lo demás sigue.
  assert.deepEqual([...ctx.descartadas].sort(), ['m3'])
  // Las manzanas que el archivo no menciona quedan libres y sin letra ni turno.
  assert.equal(manzanas.get('m2').territorio, null)
  assert.equal('letra' in manzanas.get('m2'), false)
  assert.equal('orden' in manzanas.get('m2'), false)
  // Una manzana con otra forma pasa a "editada" (si no, al recargar vuelve la de antes) y pierde sus caras a mano.
  const m1 = manzanas.get('m1')
  assert.deepEqual(JSON.parse(JSON.stringify(m1.geom)), gm1)
  assert.equal(m1.editada, true)
  assert.equal('caras' in m1, false)
  assert.equal('carasN' in m1, false)
  assert.equal(m1.territorio, 'n1')
  // Una manzana que no existía se crea editada.
  assert.equal(manzanas.get('m-nueva').editada, true)
  assert.equal(manzanas.get('m-nueva').territorio, 'n1')
  assert.ok(e.llamadas.includes('reletrar:n1'))
  assert.match(e.avisos.at(-1), /Importados <b>1<\/b> territorio/)
  assert.match(e.avisos.at(-1), /no se arrastran/)
})

test('importar con la forma igual a la que ya hay no la marca como editada', async () => {
  const e = armarEditor()
  await importar(e, JSON.stringify({
    territorios: [{ id: 'n1', numero: '5' }],
    manzanas: [{ id: 'm1', territorio: 'n1', geometria: cuadrado(-68.5) }],
  }))
  assert.equal(e.manzanas.get('m1').editada, false)
  assert.deepEqual(e.manzanas.get('m1').caras, [[0, 1]], 'las caras a mano valen: la forma es la misma')
})

test('cancelar la confirmación deja todo como estaba', async () => {
  const e = armarEditor({ confirmacion: false })
  await importar(e, JSON.stringify({ territorios: [{ id: 'n1', numero: '5' }], manzanas: [] }))
  assert.equal(e.confirmaciones.length, 1)
  assert.equal(e.llamadas.includes('instantanea'), false)
  assert.equal(e.territorios.size, 2)
  assert.equal(e.ctx.tocados.size, 2)
})

test('con un dibujo o letras a medias, importar no tira nada en silencio', async () => {
  const e = armarEditor()
  e.ctx.dibujo = [[0, 0], [1, 1]]
  e.get('bImport').onclick()
  assert.match(e.avisos[0], /a medio dibujar con <b>2 puntos<\/b>/)
  assert.equal(e.get('fImport').click, undefined, 'no se abrió el selector de archivos')
  await importar(e, JSON.stringify({ territorios: [{ id: 'n1', numero: '5' }], manzanas: [] }))
  assert.equal(e.territorios.size, 2)
  assert.equal(e.llamadas.includes('instantanea'), false)

  const f = armarEditor()
  f.ctx.letrasNuevas = ['m1']
  f.get('bImport').onclick()
  assert.match(f.avisos[0], /Llevás <b>1<\/b> manzana con letra nueva/)
})

// ------------------------------------------------------------------- Vaciar
test('Vaciar pide escribir "vaciar" y deja el editor en blanco solo en esta pestaña', async () => {
  const e = armarEditor()
  await e.get('bReset').onclick()
  assert.equal(e.dialogos.length, 1)
  assert.equal(e.dialogos[0].exigir, 'vaciar')
  assert.equal(e.dialogos[0].peligro, true)
  assert.match(e.dialogos[0].cuerpo, /solo en esta pestaña/)
  assert.match(e.dialogos[0].cuerpo, /No se escribe nada/)
  assert.doesNotMatch(e.dialogos[0].cuerpo, /no se toca/i, 'ya no dice lo que no era cierto')
  assert.equal(e.get('menuMas').open, false, 'el menú se cierra')

  assert.equal(e.ctx.vaciadoSinBase, true)
  assert.equal(e.ctx.territorios.size, 0)
  assert.equal(e.ctx.tocados.size, 0)
  assert.equal(e.ctx.activo, null)
  assert.equal(e.manzanas.get('m1').territorio, null)
  assert.equal('letra' in e.manzanas.get('m1'), false)
  assert.equal(e.ctx.estadoVaciado, '[]', 'se anota cómo quedó para saber si después se trabajó')
  const i = e.llamadas.indexOf('instantanea')
  assert.ok(i >= 0 && i < e.llamadas.indexOf('refrescar'), 'Cmd+Z puede traerlo de vuelta a la pantalla')
  assert.ok(e.llamadas.includes('pintarEstadoBorrador'))
  assert.match(e.avisos.at(-1), /solo en esta pestaña/)
})

test('cancelar el diálogo de Vaciar no cambia nada', async () => {
  const e = armarEditor({ dialogoRespuesta: null })
  await e.get('bReset').onclick()
  assert.equal(e.ctx.vaciadoSinBase, false)
  assert.equal(e.territorios.size, 2)
  assert.equal(e.llamadas.includes('instantanea'), false)
})

test('Vaciar con un dibujo a medias avisa en vez de descartarlo', async () => {
  const e = armarEditor()
  e.ctx.dibujo = [[0, 0]]
  await e.get('bReset').onclick()
  assert.equal(e.dialogos.length, 0)
  assert.match(e.avisos[0], /a medio dibujar/)
  assert.equal(e.ctx.vaciadoSinBase, false)
})

test('Vaciar no toca el localStorage ni llama a guardar: la causa del bug E7', () => {
  const vaciar = tramo("document.getElementById('bReset').onclick", '// "Más": se cierra tocando afuera')
  assert.doesNotMatch(vaciar, /localStorage/)
  assert.doesNotMatch(vaciar, /\bguardar\(/)
  assert.doesNotMatch(html, /La base de datos de la app no se toca/)
})

test('guardar() no escribe en ningún lado mientras el editor está vaciado', () => {
  const fuente = tramo('function guardar ()', '// ---------------------------------------------------------- copia en disco')
  const armar = (vaciadoSinBase) => {
    const escrituras = []
    const ctx = vm.createContext({
      vaciadoSinBase, CLAVE: 'k', ultimoTextoGuardado: null,
      territorios: new Map([['a', { id: 'a' }]]), manzanas: new Map(),
      descartadas: new Set(), revisadas: new Set(), tocados: new Set(),
      localStorage: { setItem: (k) => escrituras.push('navegador:' + k) },
      guardarEnArchivo: () => escrituras.push('archivo'),
      guardarBorrador: () => escrituras.push('base'),
    })
    vm.runInContext(fuente, ctx)
    vm.runInContext('guardar()', ctx)
    return escrituras
  }
  assert.deepEqual(armar(true), [])
  assert.deepEqual(armar(false), ['navegador:k', 'navegador:k:at', 'archivo', 'base'])
})

test('la barra de estado dice que nada se guarda mientras está vaciado', () => {
  const fuente = tramo('function pintarEstadoBorrador', 'async function leerBorrador')
  const armar = (vaciadoSinBase) => {
    const txt = { innerHTML: '' }
    const barra = { style: {} }
    const ctx = vm.createContext({
      document: { getElementById: (id) => (id === 'estadoArchivo' ? txt : barra) },
      borradorHora: null, sesionVencida: false, borradorEstado: 'guardado',
      manejadorArchivo: { name: 'copia.json' }, vaciadoSinBase,
    })
    vm.runInContext(fuente, ctx)
    vm.runInContext('pintarEstadoBorrador()', ctx)
    return { txt: txt.innerHTML, color: barra.style.color }
  }
  const vaciado = armar(true)
  assert.match(vaciado.txt, /vaciado solo en esta pestaña/)
  assert.match(vaciado.txt, /no se guarda/)
  assert.doesNotMatch(vaciado.txt, /copia en/, 'la copia en disco tampoco se está escribiendo')
  assert.equal(vaciado.color, '#8a2b1c', 'en rojo, como cualquier estado que no guarda')
  const normal = armar(false)
  assert.match(normal.txt, /Tu trabajo está guardado/)
  assert.match(normal.txt, /copia en <b>copia\.json<\/b>/)
})

test('Vaciar vive en el menú Más, aparte de Exportar e Importar', () => {
  const detalles = body.match(/<details class="mas" id="menuMas">[\s\S]*?<\/details>/)
  assert.ok(detalles, 'falta el menú Más')
  assert.match(detalles[0], /id="bReset"/)
  assert.match(detalles[0], /Vaciar el editor/)
  const fila = body.slice(body.indexOf('id="bExport"'), body.indexOf('<details class="mas"'))
  assert.match(fila, /id="bImport"/)
  assert.doesNotMatch(fila, /id="bReset"/, 'ya no está en la fila de Exportar e Importar')
  // Sin el peso de un botón "peligro" más: es una opción suelta del menú.
  assert.match(detalles[0], /class="b suelto" id="bReset"/)
})

// ------------------------------------------------------- beforeunload y teclas
test('hayTrabajoSinGuardar avisa también si el borrador de la base va atrasado', () => {
  const fuente = tramo('function hayTrabajoSinGuardar', "addEventListener('beforeunload'")
  const caso = (estado) => {
    const ctx = vm.createContext({
      BD_URL: 'https://dev.invalid', BD_KEY: 'k',
      borradorPendiente: null, borradorEnVuelo: false,
      vaciadoSinBase: false, estadoVaciado: null, estadoActual: () => 'actual',
      manejadorArchivo: null, descartadas: new Set(), revisadas: new Set(), manzanas: new Map(),
      ...estado,
    })
    vm.runInContext(fuente, ctx)
    return vm.runInContext('hayTrabajoSinGuardar()', ctx)
  }
  assert.equal(caso({}), false, 'nada pendiente ni editado')
  // La escritura agrupada (debounce de 1,2 s) todavía no salió, o falló, o no hay sesión, o hubo choque.
  assert.equal(caso({ borradorPendiente: { territorios: [] } }), true)
  assert.equal(caso({ borradorEnVuelo: true, borradorPendiente: {} }), true)
  // Una copia en disco no cambia lo que la base NO tiene.
  assert.equal(caso({ borradorPendiente: {}, manejadorArchivo: { name: 'x.json' } }), true)
  // Sin base configurada (desarrollo local) no hay a dónde mandarlo.
  assert.equal(caso({ BD_URL: undefined, BD_KEY: undefined, borradorPendiente: {} }), false)
  // Lo de siempre: lo editado a mano depende de este navegador si no hay archivo.
  const editada = new Map([['m', { id: 'm', editada: true }]])
  assert.equal(caso({ manzanas: editada }), true)
  assert.equal(caso({ manzanas: editada, manejadorArchivo: { name: 'x.json' } }), false)
  assert.equal(caso({ descartadas: new Set(['m']) }), true)
  assert.equal(caso({ revisadas: new Set(['m']) }), true)
  // Vaciado a propósito: solo cuenta lo que se hizo después de vaciar.
  assert.equal(caso({ vaciadoSinBase: true, estadoVaciado: 'actual' }), false)
  assert.equal(caso({ vaciadoSinBase: true, estadoVaciado: 'otro' }), true)
  assert.equal(caso({ vaciadoSinBase: true, estadoVaciado: 'actual', borradorPendiente: {} }), true)

  const registro = tramo("addEventListener('beforeunload'", 'document.getElementById(\'bExport\')')
  assert.match(registro, /if \(!hayTrabajoSinGuardar\(\)\) return/)
  assert.match(registro, /e\.preventDefault\(\)/)
})

test('los atajos de teclado ignoran INPUT, SELECT, TEXTAREA y contenteditable', () => {
  const ctx = vm.createContext({})
  vm.runInContext(tramo('function esCampoDeTexto', "addEventListener('keydown'"), ctx)
  const esCampo = vm.runInContext('esCampoDeTexto', ctx)
  for (const tagName of ['INPUT', 'SELECT', 'TEXTAREA']) assert.equal(esCampo({ tagName }), true, tagName)
  assert.equal(esCampo({ tagName: 'DIV', isContentEditable: true }), true)
  assert.equal(esCampo({ tagName: 'SPAN', isContentEditable: true }), true)
  assert.equal(esCampo({ tagName: 'DIV', isContentEditable: false }), false)
  assert.equal(esCampo({ tagName: 'BUTTON' }), false)
  assert.equal(esCampo({ tagName: 'BODY' }), false)
  assert.equal(esCampo(null), false)
  assert.equal(esCampo(undefined), false)
  // Y el manejador global lo usa en su primera línea, antes que cualquier atajo.
  const manejador = tramo("addEventListener('keydown', (e) => {", "if (e.key === 'Escape')")
  assert.match(manejador, /if \(esCampoDeTexto\(e\.target\)\) return/)
  assert.ok(manejador.indexOf('esCampoDeTexto(e.target)') < manejador.indexOf("e.key.toLowerCase() === 'z'"))
})

// ------------------------------------------------------ diálogo con palabra
function armarDialogo () {
  const oyentes = []
  const entrada = {
    value: '', oyentes: {}, addEventListener (tipo, f) { this.oyentes[tipo] = f }, focus () {}, select () {},
  }
  const botones = [{ dataset: { r: '0' }, disabled: false }, { dataset: { r: '1' }, disabled: false }]
  const velo = {
    className: '', innerHTML: '', quitado: false, remove () { this.quitado = true },
    querySelector (sel) { return sel === '#dlgCampo' ? entrada : sel === '[data-r="1"]' ? botones[1] : null },
    querySelectorAll () { return botones },
  }
  const ctx = vm.createContext({
    document: { createElement: () => velo, body: { appendChild () {} } },
    icono: () => '', escHtml,
    addEventListener: (tipo, f) => oyentes.push([tipo, f]),
    removeEventListener: () => {},
  })
  vm.runInContext(tramo('function dialogo', 'const confirmar ='), ctx)
  const teclear = (key) => oyentes.at(-1)[1]({ key, stopPropagation () {} })
  return { ctx, entrada, botones, velo, teclear }
}

const resuelto = (promesa) => Promise.race([promesa.then((v) => ({ v })), new Promise((r) => setTimeout(() => r('pendiente'), 20))])

test('dialogo con exigir: Aceptar y Enter esperan a que se escriba la palabra', async () => {
  const d = armarDialogo()
  const p = vm.runInContext('dialogo', d.ctx)({ titulo: 'T', cuerpo: 'C', campo: '', exigir: 'vaciar', aceptar: 'Vaciar', peligro: true })
  assert.match(d.velo.innerHTML, /placeholder="Escribí vaciar"/)
  assert.equal(d.botones[1].disabled, true, 'arranca apagado')

  d.entrada.value = 'vacia'
  d.entrada.oyentes.input()
  assert.equal(d.botones[1].disabled, true)
  d.teclear('Enter')
  assert.equal(await resuelto(p), 'pendiente', 'Enter no acepta mientras no coincida')

  d.entrada.value = ' VACIAR '
  d.entrada.oyentes.input()
  assert.equal(d.botones[1].disabled, false, 'sin importar mayúsculas ni espacios')
  d.teclear('Enter')
  assert.deepEqual(await resuelto(p), { v: 'VACIAR' })
  assert.equal(d.velo.quitado, true)
})

test('dialogo con exigir: Cancelar y Esc devuelven null', async () => {
  const a = armarDialogo()
  const pa = vm.runInContext('dialogo', a.ctx)({ titulo: 'T', cuerpo: 'C', campo: '', exigir: 'vaciar' })
  a.botones[0].onclick()
  assert.deepEqual(await resuelto(pa), { v: null })

  const b = armarDialogo()
  const pb = vm.runInContext('dialogo', b.ctx)({ titulo: 'T', cuerpo: 'C', campo: '', exigir: 'vaciar' })
  b.teclear('Escape')
  assert.deepEqual(await resuelto(pb), { v: null })
})

test('dialogo sin exigir sigue igual: Enter acepta el campo', async () => {
  const d = armarDialogo()
  const p = vm.runInContext('dialogo', d.ctx)({ titulo: 'T', cuerpo: 'C', campo: '12' })
  assert.doesNotMatch(d.velo.innerHTML, /placeholder/)
  assert.equal(d.botones[1].disabled, false)
  d.entrada.value = ' 13 '
  d.teclear('Enter')
  assert.deepEqual(await resuelto(p), { v: '13' })
})
