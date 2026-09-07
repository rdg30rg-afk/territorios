import test from 'node:test'
import assert from 'node:assert/strict'
import { validAt, latestEventsAt } from '../src/lib/coverageHistory.ts'
import { readAllRows } from '../src/lib/readAllRows.ts'

test('dos dibujos en el mismo día se eligen por instante, nunca por votos', () => {
  const old={vigente_desde:'2026-09-01T00:00:00Z',vigente_hasta:'2026-09-05T12:00:00Z'}
  const next={vigente_desde:old.vigente_hasta,vigente_hasta:null}
  assert.equal(validAt(old,'2026-09-05T11:59:59Z'),true)
  assert.equal(validAt(old,'2026-09-05T12:00:00Z'),false)
  assert.equal(validAt(next,'2026-09-05T12:00:00Z'),true)
  assert.equal(validAt({},'2026-09-05T12:00:00Z'),false)
})
test('historial ordena por fecha e ID, excluye el futuro y conserva correcciones', () => {
  const earlier={id:'a',lado_id:'lado',informado_at:'2026-09-05T10:00:00Z',estado:'recorrido'}
  const correction={...earlier,id:'b',estado:'sin_dato'}
  const future={...earlier,id:'c',informado_at:'2026-09-06T10:00:00Z'}
  assert.equal(latestEventsAt([future,correction,earlier],'2026-09-05T11:00:00Z').get('lado').id,'b')
  assert.equal(latestEventsAt([earlier],'2026-09-04T11:00:00Z').size,0)
})
test('pagina más de 1000 registros y nunca entrega una lista parcial ante error', async () => {
  const rows=Array.from({length:1503},(_,id)=>({id}))
  const result=await readAllRows(async(from,to)=>({data:rows.slice(from,to+1),error:null}))
  assert.deepEqual(result,rows)
  await assert.rejects(()=>readAllRows(async(from,to)=>from ? {data:null,error:{message:'sin conexión'}} : {data:rows.slice(from,to+1),error:null}),/sin conexión/)
})
