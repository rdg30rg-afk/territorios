import assert from 'node:assert/strict'
import test from 'node:test'
import { crearPantallaEncendida } from '../src/lib/pantallaEncendida.ts'

const tick = () => new Promise((r) => setTimeout(r, 0))

function entorno({ soportado = true, rechazar = null, visible = true } = {}) {
  const e = { pedidos: 0, centinelas: [], escuchadores: new Set(), visibilityState: visible ? 'visible' : 'hidden' }
  e.nav = soportado
    ? {
        wakeLock: {
          request: async (tipo) => {
            e.pedidos++
            assert.equal(tipo, 'screen')
            if (rechazar) throw Object.assign(new Error('negado'), { name: rechazar })
            const detalle = { liberado: false, escuchadores: [] }
            const centinela = {
              detalle,
              release: async () => { detalle.liberado = true },
              addEventListener: (_t, f) => detalle.escuchadores.push(f),
            }
            e.centinelas.push(centinela)
            return centinela
          },
        },
      }
    : {}
  e.doc = {
    get visibilityState() { return e.visibilityState },
    addEventListener: (_t, f) => e.escuchadores.add(f),
    removeEventListener: (_t, f) => e.escuchadores.delete(f),
  }
  e.cambiarVisibilidad = (estado) => { e.visibilityState = estado; for (const f of [...e.escuchadores]) f() }
  // Lo que hace el navegador al ocultar la pestaña: suelta el bloqueo solo.
  e.soltarElSistema = () => { const c = e.centinelas.at(-1); c.detalle.liberado = true; c.detalle.escuchadores.forEach((f) => f()) }
  return e
}

test('activar pide la pantalla encendida una sola vez, aunque se llame de nuevo', async () => {
  const e = entorno()
  const p = crearPantallaEncendida(e)
  p.activar(); p.activar()
  await tick()
  assert.equal(e.pedidos, 1)
  assert.equal(p.tomada(), true)
  assert.equal(p.soportada, true)
})

test('si el navegador no tiene Wake Lock no falla y no hace nada', async () => {
  const e = entorno({ soportado: false })
  const p = crearPantallaEncendida(e)
  assert.equal(p.soportada, false)
  assert.doesNotThrow(() => p.activar())
  await tick()
  assert.equal(p.tomada(), false)
  assert.doesNotThrow(() => { p.desactivar(); p.destruir() })
})

test('si el sistema lo niega (poca batería) no falla y se puede volver a intentar', async () => {
  const e = entorno({ rechazar: 'NotAllowedError' })
  const p = crearPantallaEncendida(e)
  p.activar()
  await tick()
  assert.equal(p.tomada(), false)
  assert.equal(e.pedidos, 1)
  // Más tarde el sistema lo permite: al volver a la pestaña se pide de nuevo.
  e.nav.wakeLock.request = async () => { e.pedidos++; const c = { release: async () => {}, addEventListener() {} }; e.centinelas.push({ ...c, detalle: { escuchadores: [] } }); return c }
  e.cambiarVisibilidad('visible')
  await tick()
  assert.equal(p.tomada(), true)
})

test('al volver a la pestaña se vuelve a pedir: el navegador lo suelta al ocultarla', async () => {
  const e = entorno()
  const p = crearPantallaEncendida(e)
  p.activar()
  await tick()
  e.cambiarVisibilidad('hidden')
  e.soltarElSistema()
  assert.equal(p.tomada(), false)
  e.cambiarVisibilidad('visible')
  await tick()
  assert.equal(e.pedidos, 2)
  assert.equal(p.tomada(), true)
})

test('con la pestaña oculta no se pide; se pide al volver', async () => {
  const e = entorno({ visible: false })
  const p = crearPantallaEncendida(e)
  p.activar()
  await tick()
  assert.equal(e.pedidos, 0)
  e.cambiarVisibilidad('visible')
  await tick()
  assert.equal(e.pedidos, 1)
  assert.equal(p.tomada(), true)
})

test('al volver a la pestaña no se pide de más si ya se tiene', async () => {
  const e = entorno()
  const p = crearPantallaEncendida(e)
  p.activar()
  await tick()
  e.cambiarVisibilidad('visible')
  e.cambiarVisibilidad('visible')
  await tick()
  assert.equal(e.pedidos, 1)
})

test('desactivar suelta el bloqueo, y no vuelve solo al cambiar de pestaña', async () => {
  const e = entorno()
  const p = crearPantallaEncendida(e)
  p.activar()
  await tick()
  p.desactivar()
  await tick()
  assert.equal(e.centinelas[0].detalle.liberado, true)
  assert.equal(p.tomada(), false)
  e.cambiarVisibilidad('visible')
  await tick()
  assert.equal(e.pedidos, 1)
})

test('desactivar mientras el pedido está en camino suelta lo que llegue después', async () => {
  const e = entorno()
  const p = crearPantallaEncendida(e)
  p.activar()
  p.desactivar()
  await tick()
  assert.equal(e.pedidos, 1)
  assert.equal(e.centinelas[0].detalle.liberado, true)
  assert.equal(p.tomada(), false)
})

test('destruir suelta el bloqueo y deja de escuchar la visibilidad', async () => {
  const e = entorno()
  const p = crearPantallaEncendida(e)
  assert.equal(e.escuchadores.size, 1)
  p.activar()
  await tick()
  p.destruir()
  await tick()
  assert.equal(e.escuchadores.size, 0)
  assert.equal(e.centinelas[0].detalle.liberado, true)
  p.activar()
  await tick()
  assert.equal(e.pedidos, 1, 'una pantalla destruida no vuelve a pedir')
})
