import assert from 'node:assert/strict'
import test from 'node:test'
import { describirCuadra, motivoHumano, agruparRechazadas } from '../src/lib/marcasRechazadas.ts'

const mz = [{ id: 'm1', label: 'b' }]
const ld = [{ id: '043de5fc-aaaa', manzana_id: 'm1', orden: 1 }]
test('texto humano, sin id crudo', () => {
  const t = describirCuadra({ lado_id: '043de5fc-aaaa', manzana_id: 'm1', estado: 'recorrido' }, mz, ld)
  assert.equal(t, 'Manzana B, cuadra 2 (recorrida)')
  assert.ok(!t.includes('043de5fc'))
  assert.match(describirCuadra({ lado_id: 'x', manzana_id: 'zz', estado: 'revisitar' }, mz, ld), /otro territorio/)
})
test('motivos conocidos', () => {
  assert.match(motivoHumano('Reservation is not active'), /asignado/)
  assert.match(motivoHumano('geometry_version mismatch'), /dibujo/)
  assert.match(motivoHumano('boom'), /no la aceptó/)
})
test('agrupa por manzana', () => {
  const g = agruparRechazadas([{ id: '1', manzana_id: 'm1' }, { id: '2', manzana_id: 'm1' }, { id: '3', manzana_id: 'q' }], mz)
  assert.equal(g.length, 2); assert.deepEqual(g[0].ids, ['1', '2'])
})
