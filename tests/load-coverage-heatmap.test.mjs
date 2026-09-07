import test from 'node:test'
import assert from 'node:assert/strict'
import { loadCoverageHeatmap } from '../src/lib/loadCoverageHeatmap.ts'

function clientFor(rows,failTable){
  const calls=[]
  return {calls,client:{from(table){
    const q={select(){return q},order(){return q},lte(column,value){calls.push({table,column,value});return q},
      eq(column,value){calls.push({table,eq:column,value});return q},
      async range(from,to){calls.push({table,from,to});return {data:(rows[table]??[]).slice(from,to+1),error:table===failTable?{message:'consulta fallida'}:null}}}
    return q
  }}}
}
test('página más de 1000 territorios y limita eventos/dibujos al instante',async()=>{
  const territories=Array.from({length:1031},(_,i)=>({id:String(i),name:String(i)}))
  const {client,calls}=clientFor({territorios:territories})
  const result=await loadCoverageHeatmap(client,'2026-09-05T10:00:00Z')
  assert.equal(result.territories.length,1031)
  assert.ok(result.territories.every(t=>t.percent===null))
  assert.equal(calls.filter(c=>c.table==='territorios'&&c.from!==undefined).length,3)
  for(const table of ['cobertura_eventos','territorio_manzanas','manzana_lados'])
    assert.ok(calls.some(c=>c.table===table&&c.value==='2026-09-05T10:00:00.000Z'))
})
test('una consulta fallida no devuelve mapa parcial',async()=>{
  const {client}=clientFor({territorios:[{id:'a',name:'57'}]},'cobertura_eventos')
  await assert.rejects(()=>loadCoverageHeatmap(client,'2026-09-05'),/consulta fallida/)
})
test('fecha inválida no hace consultas',async()=>{
  const {client,calls}=clientFor({})
  await assert.rejects(()=>loadCoverageHeatmap(client,'inválida'),/inválida/)
  assert.equal(calls.length,0)
})

test('con un territorio elegido, los dibujos se piden solo de ese territorio',async()=>{
  const {client,calls}=clientFor({territorios:[{id:'a',name:'57'},{id:'b',name:'58'}]})
  await loadCoverageHeatmap(client,'2026-09-05T10:00:00Z','a')
  const acotadas=calls.filter(c=>c.eq==='territory_id')
  assert.deepEqual(acotadas.map(c=>c.table).sort(),['manzana_lados','territorio_manzanas'])
  assert.ok(acotadas.every(c=>c.value==='a'))
  // Los nombres de los 70 y los eventos siguen enteros: son 4 kB y 13 kB, y
  // sin los nombres no se puede ni ofrecer la lista para elegir.
  assert.equal(calls.filter(c=>c.table==='territorios'&&c.eq).length,0)
  assert.equal(calls.filter(c=>c.table==='cobertura_eventos'&&c.eq).length,0)
})

test('sin territorio elegido no se acota nada, como antes',async()=>{
  const {client,calls}=clientFor({territorios:[{id:'a',name:'57'}]})
  await loadCoverageHeatmap(client,'2026-09-05T10:00:00Z')
  assert.equal(calls.filter(c=>c.eq).length,0)
})
