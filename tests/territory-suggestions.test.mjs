import test from 'node:test'
import assert from 'node:assert/strict'
import { suggestTerritories } from '../src/lib/territorySuggestions.ts'
const row={territory_id:'a',name:'57',lados:4,lados_hechos:1,pct_metros:25,ultima_marca:'2026-09-01T00:00:00Z',tiene_dato:true,reservado:false}
test('desconocido nunca se interpreta como cero; sin lados y reservado se separan',()=>{
  assert.equal(suggestTerritories([{...row,pct_metros:0,tiene_dato:false}])[0].percent,null)
  assert.equal(suggestTerritories([{...row,lados:0}])[0].category,'sin_geometria')
  assert.equal(suggestTerritories([{...row,reservado:true}])[0].category,'asignado')
  assert.equal(suggestTerritories([{...row,pct_metros:120}])[0].category,'verificar')
})
test('orden reproducible: porcentaje ascendente y última marca más vieja en empate',()=>{
  const rows=[{...row,territory_id:'c',pct_metros:80},{...row,territory_id:'b',ultima_marca:'2026-09-02T00:00:00Z'},row]
  assert.deepEqual(suggestTerritories(rows,Date.parse('2026-09-05')).map(r=>r.territory_id),['a','b','c'])
  assert.equal(rows[0].territory_id,'c')
})
test('fechas futuras o inválidas no inventan antigüedad',()=>{
  for(const ultima_marca of ['inválida','2099-01-01',null]) assert.equal(suggestTerritories([{...row,ultima_marca}])[0].age,null)
})
test('porcentaje vacío no se convierte en cero conocido',()=>{
  for(const pct_metros of ['', '   ', null]) {
    const result=suggestTerritories([{...row,pct_metros}])[0]
    assert.equal(result.percent,null)
    assert.equal(result.category,'verificar')
  }
})
test('100% redondeado no oculta lados pendientes',()=>{
  const partial=suggestTerritories([{...row,pct_metros:100,lados:2000,lados_hechos:1999}])[0]
  assert.equal(partial.category,'completar')
  assert.match(partial.reason,/1999 de 2000/)
  assert.equal(suggestTerritories([{...row,pct_metros:100,lados_hechos:4}])[0].category,'completo')
})
test('conteos ausentes o incoherentes exigen verificar',()=>{
  for(const lados_hechos of [null,undefined,'',-1,5,0.5])
    assert.equal(suggestTerritories([{...row,lados_hechos}])[0].category,'verificar')
})
