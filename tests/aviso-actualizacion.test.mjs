import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import test from 'node:test'

import { CreateOutbox } from '../src/lib/coverageOutbox.ts'
import {
  INTERVALO_BUSCAR_VERSION_MS,
  INTERVALO_REVISION_MS,
  PREFIJO_COLA_COBERTURA,
  decidirActualizacion,
  leerColaCobertura,
  mismaLectura,
  textoDeEspera,
} from '../src/components/avisoActualizacionEstado.ts'

const repoRoot = fileURLToPath(new URL('..', import.meta.url))

/** Un localStorage mínimo, con el recorrido por índice que usa el lector. */
class AlmacenEnMemoria {
  valores = new Map()
  get length() { return this.valores.size }
  key(indice) { return [...this.valores.keys()][indice] ?? null }
  getItem(clave) { return this.valores.get(clave) ?? null }
  setItem(clave, valor) { this.valores.set(clave, String(valor)) }
}

const cola = (eventos, extra = {}) =>
  JSON.stringify({ version: 1, projectRef: 'dev', userId: 'u1', events: eventos, ...extra })
const evento = (id, status = 'pending') => ({ id, status })

function candado() {
  const colas = new Map()
  return async (nombre, tarea) => {
    const anterior = colas.get(nombre) ?? Promise.resolve()
    let liberar
    colas.set(nombre, new Promise((resolve) => { liberar = resolve }))
    await anterior
    try { return await tarea() } finally { liberar() }
  }
}

const marca = (overrides = {}) => ({
  lado_id: 'lado', manzana_id: 'manzana', territory_id: 'territorio', geometry_version: 1,
  estado: 'recorrido', origen: 'app_hermano', informado_por: 'u1', ...overrides,
})

test('sin cola de cobertura se puede actualizar', () => {
  const almacen = new AlmacenEnMemoria()
  almacen.setItem('otra-cosa', 'x')
  const lectura = leerColaCobertura(almacen)
  assert.deepEqual(lectura, { marcas: 0, ilegible: false })
  assert.deepEqual(decidirActualizacion(lectura), { puedeActualizar: true, motivo: 'libre', marcas: 0 })
})

test('una cola vacía no frena la actualización', () => {
  const almacen = new AlmacenEnMemoria()
  almacen.setItem('coverage-outbox:v1:dev:u1', cola([]))
  assert.equal(decidirActualizacion(leerColaCobertura(almacen)).puedeActualizar, true)
})

test('cualquier marca que siga en la cola frena la actualización, sea cual sea su estado', () => {
  for (const status of ['pending', 'sending', 'error']) {
    const almacen = new AlmacenEnMemoria()
    almacen.setItem('coverage-outbox:v1:dev:u1', cola([evento('a', status)]))
    const decision = decidirActualizacion(leerColaCobertura(almacen))
    assert.equal(decision.puedeActualizar, false, status)
    assert.equal(decision.motivo, 'marcas', status)
    assert.equal(decision.marcas, 1, status)
  }
})

test('suma las marcas de todas las cuentas y proyectos de este navegador', () => {
  const almacen = new AlmacenEnMemoria()
  almacen.setItem('coverage-outbox:v1:dev:u1', cola([evento('a'), evento('b')]))
  almacen.setItem('coverage-outbox:v1:dev:u2', cola([evento('c')], { userId: 'u2' }))
  assert.equal(leerColaCobertura(almacen).marcas, 3)
})

test('detecta la cola aunque cambie la versión del formato (coverage-outbox:v2:...)', () => {
  const almacen = new AlmacenEnMemoria()
  almacen.setItem('coverage-outbox:v2:dev:u1', cola([evento('a')], { version: 2 }))
  assert.equal(decidirActualizacion(leerColaCobertura(almacen)).puedeActualizar, false)
})

test('ignora claves que no son de la cola de cobertura', () => {
  const almacen = new AlmacenEnMemoria()
  almacen.setItem('editor:borrador', cola([evento('a')]))
  almacen.setItem('coverage-history:v1', cola([evento('a')]))
  assert.equal(PREFIJO_COLA_COBERTURA, 'coverage-outbox:')
  assert.deepEqual(leerColaCobertura(almacen), { marcas: 0, ilegible: false })
})

test('lo que no se puede leer no se da por vacío: frena y lo dice', () => {
  for (const crudo of ['{roto', 'null', '[]', JSON.stringify({ events: 'no-es-lista' }), JSON.stringify({ version: 1 })]) {
    const almacen = new AlmacenEnMemoria()
    almacen.setItem('coverage-outbox:v1:dev:u1', crudo)
    const lectura = leerColaCobertura(almacen)
    assert.equal(lectura.ilegible, true, crudo)
    const decision = decidirActualizacion(lectura)
    assert.equal(decision.puedeActualizar, false, crudo)
    assert.equal(decision.motivo, 'ilegible', crudo)
  }
})

test('si el almacenamiento tira una excepción al recorrerlo, tampoco se actualiza', () => {
  const roto = { get length() { throw new Error('bloqueado') }, key: () => null, getItem: () => null }
  assert.equal(leerColaCobertura(roto).ilegible, true)
  const rotoAlLeer = { length: 1, key: () => 'coverage-outbox:v1:dev:u1', getItem: () => { throw new Error('bloqueado') } }
  assert.equal(decidirActualizacion(leerColaCobertura(rotoAlLeer)).puedeActualizar, false)
})

test('si hay marcas y además una entrada ilegible, manda el conteo de marcas', () => {
  const almacen = new AlmacenEnMemoria()
  almacen.setItem('coverage-outbox:v1:dev:u1', cola([evento('a')]))
  almacen.setItem('coverage-outbox:v1:dev:u2', '{roto')
  const decision = decidirActualizacion(leerColaCobertura(almacen))
  assert.equal(decision.motivo, 'marcas')
  assert.equal(decision.marcas, 1)
})

test('contrato con la cola real: lee lo que escribe CreateOutbox y se libera al enviar', async () => {
  const almacen = new AlmacenEnMemoria()
  const caja = CreateOutbox({ storage: almacen, projectRef: 'dev', userId: 'u1', lock: candado() })

  assert.equal(decidirActualizacion(leerColaCobertura(almacen)).puedeActualizar, true)

  await caja.enqueue(marca())
  await caja.enqueue(marca({ lado_id: 'otro-lado' }))
  const conMarcas = decidirActualizacion(leerColaCobertura(almacen))
  assert.equal(conMarcas.puedeActualizar, false)
  assert.equal(conMarcas.marcas, 2)

  // Una marca que falla queda en la cola con estado "error": sigue frenando.
  await caja.drain(async () => ({ confirmed: false, error: 'sin red' }))
  assert.equal(decidirActualizacion(leerColaCobertura(almacen)).puedeActualizar, false)

  // Cuando el servidor las confirma, la cola queda vacía y se puede actualizar.
  await caja.retryErrors()
  await caja.drain(async () => true)
  assert.equal(caja.getEvents().length, 0)
  assert.deepEqual(decidirActualizacion(leerColaCobertura(almacen)), { puedeActualizar: true, motivo: 'libre', marcas: 0 })
})

test('leer la cola no la modifica', async () => {
  const almacen = new AlmacenEnMemoria()
  const caja = CreateOutbox({ storage: almacen, projectRef: 'dev', userId: 'u1', lock: candado() })
  await caja.enqueue(marca())
  const antes = JSON.stringify([...almacen.valores])
  leerColaCobertura(almacen)
  leerColaCobertura(almacen)
  assert.equal(JSON.stringify([...almacen.valores]), antes)
})

test('mismaLectura evita redibujar el aviso cuando nada cambió', () => {
  assert.equal(mismaLectura({ marcas: 2, ilegible: false }, { marcas: 2, ilegible: false }), true)
  assert.equal(mismaLectura({ marcas: 2, ilegible: false }, { marcas: 1, ilegible: false }), false)
  assert.equal(mismaLectura({ marcas: 0, ilegible: false }, { marcas: 0, ilegible: true }), false)
})

test('los textos están en voseo, con singular y plural', () => {
  assert.equal(textoDeEspera(decidirActualizacion({ marcas: 0, ilegible: false })), null)
  assert.equal(
    textoDeEspera(decidirActualizacion({ marcas: 1, ilegible: false })),
    'Tenés 1 marca sin enviar. Cuando se envíen, tocá Actualizar.',
  )
  assert.equal(
    textoDeEspera(decidirActualizacion({ marcas: 3, ilegible: false })),
    'Tenés 3 marcas sin enviar. Cuando se envíen, tocá Actualizar.',
  )
  assert.match(textoDeEspera(decidirActualizacion({ marcas: 0, ilegible: true })), /No pudimos revisar tus marcas/)
  assert.doesNotMatch(textoDeEspera(decidirActualizacion({ marcas: 2, ilegible: false })), /\b(Tienes|Pulsa|Toca)\b/)
})

test('los intervalos son razonables: revisar la cola seguido, buscar versión una vez por hora', () => {
  assert.ok(INTERVALO_REVISION_MS >= 1000 && INTERVALO_REVISION_MS <= 5000)
  assert.equal(INTERVALO_BUSCAR_VERSION_MS, 60 * 60 * 1000)
})

// ------------------------------------------------ componente y hoja de estilos
test('el aviso está montado en main.tsx y registra el worker con virtual:pwa-register', async () => {
  const [main, componente] = await Promise.all([
    readFile(join(repoRoot, 'src/main.tsx'), 'utf8'),
    readFile(join(repoRoot, 'src/components/AvisoActualizacion.tsx'), 'utf8'),
  ])
  assert.match(main, /import \{ AvisoActualizacion \} from '\.\/components\/AvisoActualizacion'/)
  assert.match(main, /<AvisoActualizacion \/>/)
  assert.match(componente, /from 'virtual:pwa-register\/react'/)
  // Dice lo que tiene que decir, con icono más palabra.
  assert.match(componente, /Hay una versión nueva/)
  assert.match(componente, /Actualizar/)
  assert.match(componente, /<svg[^>]*aria-hidden="true"/)
  assert.match(componente, /role="status"/)
  // No se actualiza sola: la única llamada a updateServiceWorker está detrás
  // de la decisión sobre la cola, dentro del clic.
  assert.equal((componente.match(/updateServiceWorker\(/g) ?? []).length, 1)
  assert.match(componente, /if \(!decidirActualizacion\(ahora\)\.puedeActualizar\) return/)
})

test('el aviso cumple las reglas de la vista del hermano: 16 px, 56 px y no solo color', async () => {
  const css = await readFile(join(repoRoot, 'src/components/AvisoActualizacion.css'), 'utf8')
  // Todo tamaño de letra declarado es de 16 px o más.
  const tamanos = [...css.matchAll(/font(?:-size)?\s*:[^;]*?(\d+(?:\.\d+)?)px/g)].map((m) => Number(m[1]))
  assert.ok(tamanos.length >= 4, 'tiene que declarar sus tamaños de letra')
  for (const tamano of tamanos) assert.ok(tamano >= 16, `${tamano}px es menor a 16 px`)
  assert.doesNotMatch(css, /font-size\s*:\s*[\d.]+(?:rem|em)/)
  // El botón mide 56 px o más.
  assert.match(css, /\.aviso-actualizacion-boton\s*\{[^}]*min-height:\s*56px/)
  // En espera no depende solo del color: cambia el trazo del borde.
  assert.match(css, /\[aria-disabled='true'\][^}]*border-style:\s*dashed/)
  // Fijo abajo y por encima de las capas de la app (la más alta es 1000).
  assert.match(css, /\.aviso-actualizacion\s*\{[^}]*position:\s*fixed[^}]*bottom:\s*0/)
  assert.match(css, /z-index:\s*2000/)
})
