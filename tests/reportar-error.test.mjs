import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import vm from 'node:vm'
import ts from 'typescript'
import * as nucleo from '../src/lib/reportarErrorNucleo.ts'
import {
  MAX_MENSAJE,
  MAX_PILA,
  MAX_REPORTES_POR_SESION,
  crearReportero,
  describirError,
  esFuncionInexistente,
  limpiarTexto,
  normalizarRuta,
} from '../src/lib/reportarErrorNucleo.ts'

const CASOS_DE_LIMPIEZA = JSON.parse(
  readFileSync(new URL('./fixtures/limpieza-errores.json', import.meta.url), 'utf8'),
)

const CONTEXTO = { ruta: '/mapas', version: 'v1.2.3', userAgent: 'Mozilla/5.0 (Linux; Android 12)' }

// Un reportero con un `enviar` que anota lo que recibe y responde `estado`.
function armar(estado = 'ok', extra = {}) {
  const enviados = []
  const reportero = crearReportero({
    enviar: async (reporte) => {
      enviados.push(reporte)
      return typeof estado === 'function' ? estado(reporte, enviados.length) : estado
    },
    contexto: () => CONTEXTO,
    ...extra,
  })
  return { reportero, enviados }
}

test('el tope por sesión es 20', () => {
  assert.equal(MAX_REPORTES_POR_SESION, 20)
})

test('deduplica por mensaje: el mismo error no se manda dos veces', async () => {
  const { reportero, enviados } = armar()
  await reportero.reportar(new Error('Se rompió el mapa'))
  await reportero.reportar(new Error('Se rompió el mapa'))
  await reportero.reportar('Se rompió el mapa')
  await reportero.reportar(new Error('Se rompió otra cosa'))
  assert.deepEqual(enviados.map((reporte) => reporte.mensaje), ['Se rompió el mapa', 'Se rompió otra cosa'])
})

test('deduplica aunque cambie lo que se limpia: dos emails distintos son el mismo mensaje', async () => {
  const { reportero, enviados } = armar()
  await reportero.reportar('No se pudo avisar a ana@example.com')
  await reportero.reportar('No se pudo avisar a beto@example.com')
  assert.equal(enviados.length, 1)
  assert.equal(enviados[0].mensaje, 'No se pudo avisar a [email]')
})

test('manda como máximo 20 por sesión, de a uno', async () => {
  const { reportero, enviados } = armar()
  for (let i = 0; i < 35; i += 1) await reportero.reportar(new Error(`falla ${i}`))
  assert.equal(enviados.length, 20)
  assert.equal(reportero.cantidadEnviada(), 20)
  assert.equal(enviados.at(-1).mensaje, 'falla 19')
})

test('el tope también vale con 50 errores juntos, sin esperar la red', async () => {
  const { reportero, enviados } = armar()
  await Promise.all(Array.from({ length: 50 }, (_, i) => reportero.reportar(new Error(`junto ${i}`))))
  assert.equal(enviados.length, 20)
})

test('los repetidos no gastan el tope', async () => {
  const { reportero, enviados } = armar()
  for (let i = 0; i < 100; i += 1) await reportero.reportar(new Error('siempre el mismo'))
  assert.equal(enviados.length, 1)
  assert.equal(reportero.cantidadEnviada(), 1)
})

test('se apaga en silencio cuando la RPC no existe y no vuelve a mandar', async () => {
  const { reportero, enviados } = armar('no_disponible')
  await reportero.reportar(new Error('primero'))
  assert.equal(reportero.estaApagado(), true)
  await reportero.reportar(new Error('segundo'))
  await reportero.reportar(new Error('tercero'))
  assert.equal(enviados.length, 1)
})

test('un error de red o de permisos no apaga el reporte', async () => {
  const { reportero, enviados } = armar('error')
  await reportero.reportar(new Error('uno'))
  await reportero.reportar(new Error('dos'))
  assert.equal(reportero.estaApagado(), false)
  assert.equal(enviados.length, 2)
})

test('reconoce una RPC inexistente por 404 o por PGRST202', () => {
  assert.equal(esFuncionInexistente({ code: 'PGRST202' }, 404), true)
  assert.equal(esFuncionInexistente({ code: 'PGRST202' }, undefined), true)
  assert.equal(esFuncionInexistente({ code: 'otro' }, 404), true)
  assert.equal(esFuncionInexistente({ code: '42501' }, 403), false)
  assert.equal(esFuncionInexistente({ code: 'PGRST303' }, 401), false)
  assert.equal(esFuncionInexistente(null, undefined), false)
  assert.equal(esFuncionInexistente({}, 0), false)
})

test('nunca lanza: ni si enviar falla, ni si el contexto falla, ni con valores raros', async () => {
  const roto = crearReportero({
    enviar: async () => {
      throw new Error('sin red')
    },
    contexto: () => CONTEXTO,
  })
  await roto.reportar(new Error('a'))
  assert.equal(roto.estaApagado(), false)

  const sinContexto = crearReportero({
    enviar: async () => 'ok',
    contexto: () => {
      throw new Error('sin window')
    },
  })
  await sinContexto.reportar(new Error('b'))

  const circular = {}
  circular.yo = circular
  const { reportero, enviados } = armar()
  for (const valor of [null, undefined, 0, false, circular, Symbol('x'), () => {}, {}, []]) {
    await reportero.reportar(valor)
  }
  // Todos los valores sin mensaje se juntan en un solo reporte.
  assert.equal(enviados.length, 1)
  assert.equal(enviados[0].mensaje, '(sin mensaje)')
})

test('trunca mensaje y pila, y los limpia de datos personales', async () => {
  const { reportero, enviados } = armar()
  const error = new Error(`${'fallo '.repeat(150)} para ana@example.com`)
  error.stack = `${'at x '.repeat(1000)} en -31.537512`
  await reportero.reportar(error)
  const [reporte] = enviados
  assert.equal(reporte.mensaje.length, MAX_MENSAJE)
  assert.equal(reporte.pila.length, MAX_PILA)

  await reportero.reportar(new Error('avisar a ana@example.com en -31.537512, -68.536412'))
  assert.equal(enviados[1].mensaje, 'avisar a [email] en [coord], [coord]')
})

test('la ruta va sin query ni hash y con los UUID como :id', async () => {
  const { reportero, enviados } = armar('ok', {
    contexto: () => ({
      ...CONTEXTO,
      ruta: '/mapas/81000000-0000-0000-0000-000000000091?code=secreto&email=ana@example.com#sec',
    }),
  })
  await reportero.reportar(new Error('falla con ruta'))
  assert.equal(enviados[0].ruta, '/mapas/:id')
  assert.equal(normalizarRuta('/salidas?x=1'), '/salidas')
  assert.equal(normalizarRuta('#solo-hash'), '/')
  assert.equal(normalizarRuta(`/${'a/'.repeat(300)}`).length, 200)
})

test('manda versión y user agent del contexto', async () => {
  const { reportero, enviados } = armar()
  await reportero.reportar(new Error('con contexto'))
  assert.equal(enviados[0].version_app, 'v1.2.3')
  assert.equal(enviados[0].user_agent, 'Mozilla/5.0 (Linux; Android 12)')
})

test('ignora los avisos de ResizeObserver y no gastan el tope', async () => {
  const { reportero, enviados } = armar()
  await reportero.reportar('ResizeObserver loop completed with undelivered notifications.')
  await reportero.reportar('ResizeObserver loop limit exceeded')
  assert.equal(enviados.length, 0)
  assert.equal(reportero.cantidadEnviada(), 0)
})

test('describirError: Error, texto y objetos de Supabase sin details ni hint', () => {
  assert.deepEqual(describirError(new TypeError('x es undefined')).mensaje, 'x es undefined')
  assert.equal(describirError('texto suelto').mensaje, 'texto suelto')
  const deSupabase = {
    message: 'duplicate key value violates unique constraint',
    code: '23505',
    details: 'Key (name)=(Ana Pérez) already exists.',
    hint: 'otra cosa privada',
  }
  const descrito = describirError(deSupabase)
  assert.equal(descrito.mensaje, '23505: duplicate key value violates unique constraint')
  assert.ok(!JSON.stringify(descrito).includes('Ana'))
  assert.ok(!JSON.stringify(descrito).includes('privada'))
  assert.equal(describirError(undefined).mensaje, '(sin mensaje)')
  assert.equal(describirError(new Error('')).mensaje, 'Error')
})

test('instalar engancha error y unhandledrejection, y se puede soltar', async () => {
  const ventana = new EventTarget()
  const { reportero, enviados } = armar()
  const soltar = reportero.instalar(ventana)

  const falla = Object.assign(new Event('error'), {
    error: new Error('falló un script'),
    message: 'Uncaught Error: falló un script',
    filename: 'https://h.test/a.js?token=abc',
    lineno: 7,
    colno: 9,
  })
  ventana.dispatchEvent(falla)
  const rechazo = Object.assign(new Event('unhandledrejection'), { reason: new Error('promesa sin catch') })
  ventana.dispatchEvent(rechazo)
  // Un error sin objeto Error (script de otro origen): queda el mensaje y el lugar.
  ventana.dispatchEvent(
    Object.assign(new Event('error'), { error: null, message: 'Script error.', filename: 'https://cdn.test/x.js', lineno: 1, colno: 2 }),
  )
  await new Promise((resolver) => setImmediate(resolver))

  assert.deepEqual(
    enviados.map((reporte) => reporte.mensaje),
    ['falló un script', 'promesa sin catch', 'Script error.'],
  )
  assert.match(enviados[2].pila, /^https:\/\/cdn\.test\/x\.js:1:2$/)

  soltar()
  ventana.dispatchEvent(Object.assign(new Event('error'), { error: new Error('después de soltar') }))
  await new Promise((resolver) => setImmediate(resolver))
  assert.equal(enviados.length, 3)
})

test('limpiarTexto: los casos compartidos con la base', () => {
  for (const caso of CASOS_DE_LIMPIEZA) {
    assert.equal(limpiarTexto(caso.entrada), caso.salida, caso.nombre)
  }
})

test('el cliente llama a la RPC con los mismos parámetros que define la migración', () => {
  const migracion = readFileSync(
    new URL('../supabase/migrations/20261027151500_errores_cliente.sql', import.meta.url),
    'utf8',
  )
  const cliente = readFileSync(new URL('../src/lib/reportarError.ts', import.meta.url), 'utf8')
  const parametrosSql = [...migracion.match(/function public\.reportar_error_cliente\(([\s\S]*?)\)\s*returns/)[1].matchAll(/\bp_[a-z_]+/g)].map(
    (m) => m[0],
  )
  const parametrosCliente = [...cliente.match(/rpc\('reportar_error_cliente', \{([\s\S]*?)\}\)/)[1].matchAll(/\bp_[a-z_]+/g)].map(
    (m) => m[0],
  )
  assert.deepEqual(parametrosCliente.sort(), parametrosSql.sort())
  assert.ok(parametrosSql.length === 5)
})

test('main.tsx importa el reporte antes que la app, para atrapar fallas de arranque', () => {
  const main = readFileSync(new URL('../src/main.tsx', import.meta.url), 'utf8')
  const importar = main.indexOf("import './lib/reportarError'")
  assert.ok(importar >= 0, 'main.tsx no importa ./lib/reportarError')
  assert.ok(importar < main.indexOf("import App from"), 'el reporte debe importarse antes que App')
})

// --- El cableado real (src/lib/reportarError.ts) con window y Supabase falsos ---

const CODIGO_DEL_CABLEADO = ts.transpileModule(
  readFileSync(new URL('../src/lib/reportarError.ts', import.meta.url), 'utf8')
    .replace('import.meta.env.VITE_APP_VERSION', "'v-test'")
    .replace('import.meta.env.VITE_APP_COMMIT', 'undefined'),
  { compilerOptions: { module: ts.ModuleKind.CommonJS } },
).outputText

const pausa = () => new Promise((resolver) => setTimeout(resolver, 5))

function cablear({ sesion = true, respuesta = { error: null, status: 204 }, sinSupabase = false, falla = false, ventana } = {}) {
  const llamadas = []
  const window =
    ventana ?? Object.assign(new EventTarget(), { location: { pathname: '/salidas?code=secreto#x' } })
  const cliente = {
    auth: { getSession: async () => ({ data: { session: sesion ? { user: { id: 'u' } } : null } }) },
    rpc: async (nombre, parametros) => {
      llamadas.push({ nombre, parametros })
      if (falla) throw new Error('sin red')
      return typeof respuesta === 'function' ? respuesta(llamadas.length) : respuesta
    },
  }
  const exports = {}
  vm.runInNewContext(CODIGO_DEL_CABLEADO, {
    exports,
    window,
    navigator: { userAgent: 'Mozilla/5.0 (prueba)' },
    require(nombre) {
      if (nombre === './supabase') return { supabase: sinSupabase ? null : cliente }
      if (nombre === './reportarErrorNucleo') return nucleo
      throw new Error(`require inesperado: ${nombre}`)
    },
  })
  const fallar = (mensaje) =>
    window.dispatchEvent(Object.assign(new Event('error'), { error: new Error(mensaje), message: mensaje }))
  return { llamadas, window, fallar, exports }
}

test('cableado: con sesión llama a reportar_error_cliente con los parámetros y la ruta sin query', async () => {
  const { llamadas, fallar } = cablear()
  fallar('se rompió el mapa')
  await pausa()
  assert.equal(llamadas.length, 1)
  assert.equal(llamadas[0].nombre, 'reportar_error_cliente')
  assert.deepEqual(Object.keys(llamadas[0].parametros).sort(), [
    'p_mensaje',
    'p_pila',
    'p_ruta',
    'p_user_agent',
    'p_version_app',
  ])
  assert.equal(llamadas[0].parametros.p_mensaje, 'se rompió el mapa')
  assert.equal(llamadas[0].parametros.p_ruta, '/salidas')
  assert.equal(llamadas[0].parametros.p_version_app, 'v-test')
  assert.equal(llamadas[0].parametros.p_user_agent, 'Mozilla/5.0 (prueba)')
})

test('cableado: sin sesión no llama a la RPC', async () => {
  const { llamadas, fallar } = cablear({ sesion: false })
  fallar('antes de entrar')
  await pausa()
  assert.equal(llamadas.length, 0)
})

test('cableado: con 404 o PGRST202 se apaga y no vuelve a llamar', async () => {
  for (const respuesta of [
    { error: { code: 'PGRST202', message: 'Could not find the function' }, status: 404 },
    { error: { code: 'PGRST202' }, status: 400 },
    { error: { message: 'Not Found' }, status: 404 },
  ]) {
    const { llamadas, fallar } = cablear({ respuesta })
    fallar('primera')
    await pausa()
    fallar('segunda')
    fallar('tercera')
    await pausa()
    assert.equal(llamadas.length, 1, JSON.stringify(respuesta))
  }
})

test('cableado: un error de permisos, de red o una excepción no apagan el reporte', async () => {
  for (const opciones of [
    { respuesta: { error: { code: '42501', message: 'permission denied' }, status: 403 } },
    { respuesta: { error: { code: 'PGRST303', message: 'JWT expired' }, status: 401 } },
    { falla: true },
  ]) {
    const { llamadas, fallar } = cablear(opciones)
    fallar('primera')
    await pausa()
    fallar('segunda')
    await pausa()
    assert.equal(llamadas.length, 2, JSON.stringify(opciones))
  }
})

test('cableado: sin Supabase configurado se apaga sin llamar a nada', async () => {
  const { llamadas, fallar, exports } = cablear({ sinSupabase: true })
  fallar('sin cliente')
  await pausa()
  assert.equal(llamadas.length, 0)
  assert.equal(exports.reportero.estaApagado(), true)
})

test('cableado: tope de 20 por sesión contra la RPC, y rechazos de promesas también se reportan', async () => {
  const { llamadas, fallar } = cablear()
  for (let i = 0; i < 30; i += 1) fallar(`falla distinta ${i}`)
  await pausa()
  assert.equal(llamadas.length, 20)

  const otra = cablear()
  otra.window.dispatchEvent(Object.assign(new Event('unhandledrejection'), { reason: new Error('promesa colgada') }))
  await pausa()
  assert.equal(otra.llamadas[0].parametros.p_mensaje, 'promesa colgada')
})

test('cableado: evaluar el módulo dos veces sobre la misma ventana no duplica los reportes', async () => {
  const primera = cablear()
  const segunda = cablear({ ventana: primera.window })
  segunda.fallar('una sola vez')
  await pausa()
  assert.equal(primera.llamadas.length + segunda.llamadas.length, 1)
})
