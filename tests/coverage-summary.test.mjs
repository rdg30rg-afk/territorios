import test from 'node:test'
import assert from 'node:assert/strict'
import { coverageSummary } from '../src/lib/coverageSummary.ts'
const sides=[{id:'a',largo_m:80},{id:'b',largo_m:20}]
test('desconocido no es cero ni completo',()=>{
 assert.equal(coverageSummary(sides,{}).percent,null)
 assert.equal(coverageSummary([],{}).complete,false)
 assert.equal(coverageSummary(sides,{a:'sin_dato',b:'sin_dato'}).percent,null)
})
test('porcentaje por metros, no por cantidad de lados',()=>{
 assert.equal(coverageSummary(sides,{a:'recorrido'}).percent,80)
 assert.equal(coverageSummary(sides,{a:'recorrido'}).counts.sin_dato,1)
 assert.equal(coverageSummary(sides,{a:'recorrido',b:'recorrido'}).complete,true)
})
test('inaccesible y revisitar son información, no recorrido',()=>{
 const summary=coverageSummary(sides,{a:'no_accesible',b:'revisitar'})
 assert.equal(summary.percent,0)
 assert.equal(summary.complete,false)
 assert.equal(summary.counts.no_accesible,1)
 assert.equal(summary.counts.revisitar,1)
})
test('longitudes inválidas no producen un porcentaje engañoso',()=>{
 assert.equal(coverageSummary([{id:'a',largo_m:'NaN'}],{a:'recorrido'}).percent,null)
})
