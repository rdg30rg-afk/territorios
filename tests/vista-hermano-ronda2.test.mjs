import assert from 'node:assert/strict'
import test from 'node:test'
import { CreateOutbox, mensajeSiFaltaHabilitarOrigen, MENSAJE_FALTA_HABILITAR_ADMIN } from '../src/lib/coverageOutbox.ts'
import { pendingBeforeLogout } from '../src/lib/pendingBeforeLogout.ts'
import { esAdminQueMarca, territorioDeLaDireccion, marcaComoAdmin, conOrigenAdmin, avisoMarcandoComoAdmin } from '../src/lib/marcaComoAdmin.ts'
import {
  tamanioGuardado, siguienteTamanio, botonDeTamanio, hora24, textoFaltan, rotuloFaltan, rotuloDeLaSalida, resumenDeSoloTipos,
  salidasSinInformar, estadoDeInforme, quienConduce, avisosDeRechazo, leerRechazosCerrados, cerrarRechazo, desdeHaceDias,
} from '../src/lib/vistaHermanoSalidas.ts'

class Mem {
  v = new Map()
  getItem(k) { return this.v.get(k) ?? null }
  setItem(k, x) { this.v.set(k, x) }
}
const candado = () => async (_n, t) => t()
const entrada = (o = {}) => ({ lado_id: 'l1', manzana_id: 'm1', territory_id: 't1', geometry_version: 1, estado: 'recorrido', origen: 'app_hermano', informado_por: 'u1', ...o })

test('la cola acepta el origen admin y rechaza uno desconocido', async () => {
  const caja = CreateOutbox({ storage: new Mem(), projectRef: 'dev', userId: 'u1', lock: candado() })
  const e = await caja.enqueue(entrada({ origen: 'admin' }))
  assert.equal(e.origen, 'admin')
  await assert.rejects(() => caja.enqueue(entrada({ origen: 'otro' })))
})

test('«Origen inválido» de la función vieja se dice en castellano y solo para el origen admin', () => {
  assert.equal(mensajeSiFaltaHabilitarOrigen('admin', 'Origen inválido'), MENSAJE_FALTA_HABILITAR_ADMIN)
  assert.match(MENSAJE_FALTA_HABILITAR_ADMIN, /^Falta habilitar esto en la base/)
  assert.equal(mensajeSiFaltaHabilitarOrigen('app_hermano', 'Origen inválido'), null)
  assert.equal(mensajeSiFaltaHabilitarOrigen('admin', 'sin red'), null)
})

test('una marca de admin rechazada no frena cerrar sesión', async () => {
  const almacen = new Mem()
  const caja = CreateOutbox({ storage: almacen, projectRef: 'dev', userId: 'u1', lock: candado() })
  await caja.enqueue(entrada({ origen: 'admin' }))
  await caja.drain(async () => ({ confirmed: false, error: MENSAJE_FALTA_HABILITAR_ADMIN }))
  assert.equal(caja.getEvents()[0].status, 'error')
  const s = { length: 1, key: () => caja.key, getItem: (k) => almacen.getItem(k) }
  assert.equal(pendingBeforeLogout(s, 'dev', 'u1'), null)
})

test('cerrar sesión cuenta las marcas en camino pero no las rechazadas', () => {
  const ev = (status) => ({ status })
  const s = (events) => {
    const m = new Map([['coverage-outbox:v1:dev:u1', JSON.stringify({ version: 1, projectRef: 'dev', userId: 'u1', events })]])
    return { length: 1, key: () => 'coverage-outbox:v1:dev:u1', getItem: (k) => m.get(k) ?? null }
  }
  assert.equal(pendingBeforeLogout(s([ev('error')]), 'dev', 'u1'), null)
  assert.match(pendingBeforeLogout(s([ev('error'), ev('pending'), ev('sending')]), 'dev', 'u1'), /2 marcas/)
})

test('administrador que marca: solo admin_territorios o superadmin activos, solo el territorio pedido', () => {
  assert.equal(esAdminQueMarca({ access_status: 'active', system_role: 'admin_territorios' }), true)
  assert.equal(esAdminQueMarca({ access_status: 'active', system_role: 'superadmin' }), true)
  assert.equal(esAdminQueMarca({ access_status: 'active', system_role: 'miembro' }), false)
  assert.equal(esAdminQueMarca({ access_status: 'inactive', system_role: 'superadmin' }), false)
  assert.equal(esAdminQueMarca(null), false)
  const id = '3f2a9c1e-1111-4222-8333-444455556666'
  assert.equal(territorioDeLaDireccion(`?territorio=${id}`), id)
  assert.equal(territorioDeLaDireccion('?territorio=<script>'), null)
  assert.equal(territorioDeLaDireccion(''), null)
  const admin = { access_status: 'active', system_role: 'admin_territorios' }
  const base = { perfil: admin, territorioPedido: id, territorioAbierto: id, esPropio: false }
  assert.equal(marcaComoAdmin(base), true)
  assert.equal(marcaComoAdmin({ ...base, perfil: { access_status: 'active', system_role: 'miembro' } }), false)
  assert.equal(marcaComoAdmin({ ...base, esPropio: true }), false)
  assert.equal(marcaComoAdmin({ ...base, territorioAbierto: 'otro' }), false)
  assert.equal(marcaComoAdmin({ ...base, territorioPedido: null }), false)
  assert.deepEqual(conOrigenAdmin([entrada()], true).map((e) => e.origen), ['admin'])
  assert.deepEqual(conOrigenAdmin([entrada()], false).map((e) => e.origen), ['app_hermano'])
  assert.equal(avisoMarcandoComoAdmin('53'), 'Estás marcando como administrador el territorio 53')
})

test('tamaños de letra: tres, sin saltos raros y con lo viejo guardado', () => {
  assert.equal(tamanioGuardado(null), 1)
  assert.equal(tamanioGuardado('1.15'), 1.25)
  assert.equal(tamanioGuardado('1.3'), 1.25)
  assert.equal(tamanioGuardado('1.5'), 1.5)
  assert.equal(tamanioGuardado('basura'), 1)
  assert.deepEqual([1, 1.25, 1.5].map(siguienteTamanio), [1.25, 1.5, 1])
  assert.deepEqual([1, 1.25, 1.5].map((p) => botonDeTamanio(p).texto), ['Letra', 'Letra', 'Letra'])
  assert.deepEqual([1, 1.25, 1.5].map((p) => botonDeTamanio(p).nivel), ['Normal', 'Grande', 'Muy grande'])
})

test('la hora va en 24 h, sin a. m. ni p. m.', () => {
  assert.equal(hora24(new Date(2026, 10, 12, 22, 25, 2)), '22:25')
  assert.equal(hora24(new Date(2026, 10, 12, 9, 5, 2), true), '09:05:02')
  assert.doesNotMatch(hora24(new Date(2026, 10, 12, 22, 25, 2), true), /[ap]\.? ?m/i)
  assert.equal(hora24('no es fecha'), '')
})

test('textos: singular, la salida de mañana y solo tipos', () => {
  assert.equal(textoFaltan(1), 'Te falta 1 manzana')
  assert.equal(textoFaltan(4), 'Te faltan 4 manzanas')
  assert.equal(rotuloFaltan(1), 'Te falta')
  assert.equal(rotuloDeLaSalida('2026-11-13', '2026-11-13', '2026-11-14'), 'La salida de hoy')
  assert.equal(rotuloDeLaSalida('2026-11-14', '2026-11-13', '2026-11-14'), 'La salida de mañana')
  assert.equal(rotuloDeLaSalida('2026-11-20', '2026-11-13', '2026-11-14'), 'La próxima salida')
  assert.equal(resumenDeSoloTipos([{ tipo: 'telefonica' }]), 'Hoy es predicación telefónica.')
  assert.equal(resumenDeSoloTipos([{ tipo: 'grupos' }]), 'Hoy hay salidas de grupos.')
  assert.equal(resumenDeSoloTipos([{ tipo: 'telefonica' }, { tipo: 'grupos' }]), 'Hoy hay predicación telefónica y salidas de grupos.')
})

test('te quedó sin informar: solo las del conductor, pasadas y sin informe', () => {
  const salidas = [
    { id: 'a', driverId: 'd1', fecha: '2026-11-10', hora: '09:00' },
    { id: 'b', driverId: 'd1', fecha: '2026-11-12', hora: '09:00' },
    { id: 'c', driverId: 'd2', fecha: '2026-11-11', hora: '09:00' },
    { id: 'd', driverId: 'd1', fecha: '2026-11-11', hora: '09:00' },
    { id: 'e', driverId: 'd1', fecha: '2026-11-13', hora: '09:00' },
  ]
  const r = salidasSinInformar(salidas, new Set(['d']), 'd1', '2026-11-13')
  assert.deepEqual(r.map((s) => s.id), ['b', 'a'])
  assert.deepEqual(salidasSinInformar(salidas, new Set(), null, '2026-11-13'), [])
  const desde = desdeHaceDias(new Date(2026, 10, 13, 15, 0), 7)
  assert.equal(desde.getDate(), 6)
  assert.equal(desde.getHours(), 0)
})

test('la tarjeta dice si la salida se informó, quién y quién conduce', () => {
  const res = new Map([['s1', { salida_id: 's1', estado: 'realizada', informado_por: 'u1' }], ['s2', { salida_id: 's2', estado: 'sin_dato', informado_por: null }]])
  const nombres = { u1: 'Marta' }
  assert.deepEqual(estadoDeInforme('s1', res, nombres, true), { informada: true, texto: 'Informada por Marta' })
  assert.deepEqual(estadoDeInforme('s2', res, nombres, true), { informada: false, texto: 'Todavía sin informar' })
  assert.deepEqual(estadoDeInforme('s3', res, nombres, true), { informada: false, texto: 'Todavía sin informar' })
  assert.equal(estadoDeInforme('s3', res, nombres, false), null)
  assert.equal(estadoDeInforme(undefined, res, nombres, true), null)
  assert.deepEqual(quienConduce({ driverId: 'd1', conductor: 'Juan' }, 'd1'), { esMia: true, texto: 'Conducís vos' })
  assert.deepEqual(quienConduce({ driverId: 'd2', conductor: 'Juan' }, 'd1'), { esMia: false, texto: 'Conduce Juan' })
  assert.deepEqual(quienConduce({}, 'd1'), { esMia: false, texto: null })
})

test('el aviso de pedido no aprobado se cierra, se recuerda y se va si ya hay otro territorio', () => {
  const reservas = [
    { id: 'r1', territory_id: 't1', status: 'rechazada', assigned_to: null },
    { id: 'r2', territory_id: 't2', status: 'rechazada', assigned_to: null },
  ]
  assert.equal(avisosDeRechazo(reservas, 'u1', new Set()).length, 2)
  const almacen = new Mem()
  const cerrados = cerrarRechazo(almacen, 'u1', 'r1')
  assert.deepEqual(avisosDeRechazo(reservas, 'u1', cerrados).map((r) => r.id), ['r2'])
  assert.deepEqual([...leerRechazosCerrados(almacen, 'u1')], ['r1'])
  assert.equal(leerRechazosCerrados(almacen, 'otro').size, 0)
  const conOtro = [...reservas, { id: 'r3', territory_id: 't3', status: 'activa', assigned_to: 'u1' }]
  assert.deepEqual(avisosDeRechazo(conOtro, 'u1', new Set()), [])
  // Sin almacenamiento (ventana privada) igual se cierra en pantalla.
  const roto = { getItem() { throw Error('x') }, setItem() { throw Error('x') } }
  assert.equal(cerrarRechazo(roto, 'u1', 'r1').has('r1'), true)
})
