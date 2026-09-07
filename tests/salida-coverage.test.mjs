import test from 'node:test'
import assert from 'node:assert/strict'
import { canReportSalidaCoverage, prepareSalidaCoverage } from '../src/lib/salidaCoverage.ts'
const actor={id:'person',access_status:'active',driver_id:'driver'}
const outing={id:'outing',driverId:'driver',terrId:'territory'}
const side={id:'side',manzana_id:'block',territory_id:'territory',geometry_version:2,vigente_hasta:null}
test('marca del grupo conserva salida, persona y versión exactas para la cola',()=>{
  assert.deepEqual(prepareSalidaCoverage(actor,outing,side,'sin_dato'),{
    lado_id:'side',manzana_id:'block',territory_id:'territory',geometry_version:2,
    estado:'sin_dato',origen:'cierre_salida',salida_id:'outing',informado_por:'person',
  })
})
test('admin sin conductor vinculado, conductor ajeno e inactivo no pueden marcar',()=>{
  for(const person of [null,{...actor,role:'admin',driver_id:null},{...actor,driver_id:'another'}, {...actor,access_status:'inactive'}]){
    assert.equal(canReportSalidaCoverage(person,outing),false)
    assert.throws(()=>prepareSalidaCoverage(person,outing,side,'recorrido'),/conductor asignado/)
  }
  for(const missing of [{...outing,id:undefined},{...outing,terrId:undefined}])
    assert.equal(canReportSalidaCoverage(actor,missing),false)
})
test('no traslada marcas a otro territorio o a lados retirados o sin versión',()=>{
  for(const invalid of [{...side,territory_id:'other'},{...side,vigente_hasta:'2026-09-05'},{...side,geometry_version:0}])
    assert.throws(()=>prepareSalidaCoverage(actor,outing,invalid,'recorrido'),/dibujo vigente/)
})
