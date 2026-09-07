import test from 'node:test'
import assert from 'node:assert/strict'
import { prepareCoverageCorrection } from '../src/lib/coverageCorrection.ts'
const admin={id:'admin',role:'admin',access_status:'active'}
const event={id:'original',lado_id:'lado',manzana_id:'manzana'}
const side={id:'lado',manzana_id:'manzana',geometry_version:1,vigente_hasta:'2026-09-01'}
test('corregir conserva referencia al evento y versión original aunque el dibujo esté retirado',()=>{
  const input=prepareCoverageCorrection(admin,event,side,'territorio','sin_dato','  Error de carga  ')
  assert.equal(input.corrige_evento_id,'original');assert.equal(input.geometry_version,1)
  assert.equal(input.origen,'correccion');assert.equal(input.nota,'Error de carga')
})
test('rechaza actor sin permiso, lado ajeno, motivo vacío y versión desconocida',()=>{
  for(const actor of [{...admin,role:'viewer'},{...admin,access_status:'inactive'}])
    assert.throws(()=>prepareCoverageCorrection(actor,event,side,'t','recorrido','motivo'),/administrador activo/)
  assert.throws(()=>prepareCoverageCorrection(admin,event,{...side,id:'otra'},'t','recorrido','motivo'),/dibujo original/)
  assert.throws(()=>prepareCoverageCorrection(admin,event,{...side,geometry_version:0},'t','recorrido','motivo'),/dibujo original/)
  assert.throws(()=>prepareCoverageCorrection(admin,event,side,'t','recorrido',' '),/motivo/)
})
