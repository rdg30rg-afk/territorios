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
test('capacidad operativa habilita aunque conduzca otro; cuenta común e inactiva no',()=>{
  assert.equal(canReportSalidaCoverage({...actor,driver_id:'another'},outing),true)
  assert.equal(canReportSalidaCoverage({...actor,driver_id:null,puede_informar_salidas:true},outing),true)
  assert.equal(canReportSalidaCoverage({...actor,role:'admin',driver_id:null,puede_informar_salidas:false},outing),true)
  for(const person of [null,{...actor,driver_id:null,puede_informar_salidas:false}, {...actor,access_status:'inactive'}]){
    assert.equal(canReportSalidaCoverage(person,outing),false)
    assert.throws(()=>prepareSalidaCoverage(person,outing,side,'recorrido'),/no puede informar/)
  }
  for(const missing of [{...outing,id:undefined},{...outing,terrId:undefined}])
    assert.equal(canReportSalidaCoverage(actor,missing),false)
})
test('no traslada marcas a otro territorio o a lados retirados o sin versión',()=>{
  for(const invalid of [{...side,territory_id:'other'},{...side,vigente_hasta:'2026-09-05'},{...side,geometry_version:0}])
    assert.throws(()=>prepareSalidaCoverage(actor,outing,invalid,'recorrido'),/dibujo vigente/)
})
