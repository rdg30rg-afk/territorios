import test from 'node:test'
import assert from 'node:assert/strict'
import { buildCoverageHeatmap, coverageLegend } from '../src/lib/coverageHeatmap.ts'
const validity={vigente_desde:'2026-09-01T00:00:00Z',vigente_hasta:null}
const block={...validity,id:'b',territory_id:'t',geometry_version:1}
const side={...validity,id:'s',territory_id:'t',manzana_id:'b',geometry_version:1,largo_m:80,geometry_geojson:{type:'LineString',coordinates:[[0,0],[1,1]]}}
const territory={id:'t',name:'57'}
const event={id:'e',lado_id:'s',estado:'recorrido',informado_at:'2026-09-02T00:00:00Z'}
const build=(blocks=[block],sides=[side],events=[],instant='2026-09-03T00:00:00Z')=>buildCoverageHeatmap([territory],blocks,sides,events,instant)
test('sin eventos o sin geometría no inventa cobertura cero ni completa',()=>{
  assert.equal(build().sides[0].state,'sin_dato')
  assert.equal(build().territories[0].percent,null)
  assert.equal(build([],[]).territories[0].complete,false)
  assert.equal(build([],[]).territories[0].percent,null)
})
test('corrección posterior solo aparece desde su registro',()=>{
  const correction={...event,id:'correction',estado:'revisitar',informado_at:'2026-09-04T00:00:00Z'}
  assert.equal(build([block],[side],[event,correction]).sides[0].state,'recorrido')
  const later=build([block],[side],[event,correction],'2026-09-05T00:00:00Z')
  assert.equal(later.sides[0].state,'revisitar');assert.equal(later.sides[0].ageDays,1)
  assert.equal(later.territories[0].complete,false)
})
test('cambio de dibujo usa intervalos exactos; no hereda cobertura de otro lado',()=>{
  const until='2026-09-03T00:00:00Z'
  const blocks=[{...block,vigente_hasta:until},{...block,id:'b2',geometry_version:2,vigente_desde:until}]
  const sides=[{...side,vigente_hasta:until},{...side,id:'s2',manzana_id:'b2',geometry_version:2,vigente_desde:until}]
  const result=build(blocks,sides,[event],until)
  assert.deepEqual(result.sides.map(s=>s.id),['s2'])
  assert.equal(result.sides[0].state,'sin_dato')
})
test('rechaza fechas inválidas y reporta lados incoherentes sin dibujarlos',()=>{
  assert.throws(()=>build(undefined,undefined,undefined,'nada'),/inválida/)
  const result=build([block],[{...side,geometry_version:2}])
  assert.equal(result.inconsistentSides,1);assert.equal(result.sides.length,0)
})
test('leyenda distingue cuatro estados por etiqueta y patrón, no solo color',()=>{
  assert.equal(Object.keys(coverageLegend).length,4)
  assert.equal(new Set(Object.values(coverageLegend).map(v=>v.dash)).size,4)
})
