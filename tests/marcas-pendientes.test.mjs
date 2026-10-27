import assert from 'node:assert/strict'
import test from 'node:test'
import { TODO_ENVIADO_MS, resumirCola, siguienteModoDeEnvio, textoDeEnvio } from '../src/lib/marcasPendientes.ts'

test('con marcas en la cola se muestra la cuenta, y vaciarse dispara "Todo enviado"', () => {
  assert.equal(siguienteModoDeEnvio('oculto', 3), 'pendientes')
  assert.equal(siguienteModoDeEnvio('pendientes', 2), 'pendientes')
  assert.equal(siguienteModoDeEnvio('pendientes', 0), 'enviado')
  assert.equal(siguienteModoDeEnvio('enviado', 0), 'enviado')
  assert.equal(siguienteModoDeEnvio('enviado', 1), 'pendientes')
})

test('una cola que ya estaba vacía no anuncia que se envió algo', () => {
  assert.equal(siguienteModoDeEnvio('oculto', 0), 'oculto')
})

test('un recorrido completo: marcar, esperar señal, enviar, desaparecer', () => {
  let modo = 'oculto'
  const pasos = []
  for (const cantidad of [0, 1, 3, 3, 2, 0]) {
    modo = siguienteModoDeEnvio(modo, cantidad)
    pasos.push(modo)
  }
  assert.deepEqual(pasos, ['oculto', 'pendientes', 'pendientes', 'pendientes', 'pendientes', 'enviado'])
  // Pasados unos segundos el hook lo retira; el valor es el de la constante.
  assert.ok(TODO_ENVIADO_MS >= 2000 && TODO_ENVIADO_MS <= 8000)
})

test('sin señal dice "esperando señal", con la cuenta bien dicha', () => {
  const datos = (cantidad, extra = {}) => ({ cantidad, conError: false, enLinea: false, ...extra })
  assert.deepEqual(textoDeEnvio('pendientes', datos(3)), { texto: '3 marcas esperando señal', icono: 'sin-conexion' })
  assert.deepEqual(textoDeEnvio('pendientes', datos(1)), { texto: '1 marca esperando señal', icono: 'sin-conexion' })
})

test('con señal dice que las está enviando, y si se trabó lo dice', () => {
  assert.deepEqual(
    textoDeEnvio('pendientes', { cantidad: 2, conError: false, enLinea: true }),
    { texto: 'Enviando 2 marcas', icono: 'guardar' },
  )
  assert.deepEqual(
    textoDeEnvio('pendientes', { cantidad: 1, conError: true, enLinea: true }),
    { texto: '1 marca sin enviar', icono: 'error' },
  )
  // Sin señal manda la señal: con o sin error, esperan.
  assert.equal(textoDeEnvio('pendientes', { cantidad: 1, conError: true, enLinea: false }).texto, '1 marca esperando señal')
})

test('"Todo enviado" lleva el tilde, y oculto no muestra nada', () => {
  assert.deepEqual(
    textoDeEnvio('enviado', { cantidad: 0, conError: false, enLinea: true }),
    { texto: 'Todo enviado', icono: 'completo' },
  )
  assert.equal(textoDeEnvio('oculto', { cantidad: 0, conError: false, enLinea: true }), null)
})

test('la cola se resume en cuántas marcas hay y si alguna falló', () => {
  assert.deepEqual(resumirCola([]), { cantidad: 0, conError: false })
  assert.deepEqual(resumirCola([{ status: 'pending' }, { status: 'sending' }]), { cantidad: 2, conError: false })
  assert.deepEqual(resumirCola([{ status: 'pending' }, { status: 'error' }]), { cantidad: 2, conError: true })
})
