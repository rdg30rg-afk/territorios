import test from 'node:test'
import assert from 'node:assert/strict'
import { loadCoverageHeatmap } from '../src/lib/loadCoverageHeatmap.ts'

function clientFor(rows,failTable){
  const calls=[]
  return {calls,client:{from(table){
    const q={select(){return q},order(){return q},lte(column,value){calls.push({table,column,value});return q},
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
