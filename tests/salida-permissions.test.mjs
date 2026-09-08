import test from 'node:test'
import assert from 'node:assert/strict'
import { canReportSalida } from '../src/lib/salidaPermissions.ts'
test('cualquier conductor activo o capacidad explícita puede informar', () => {
  const p={access_status:'active',role:'conductor',driver_id:'one'}
  assert.equal(canReportSalida(p,'one'),true)
  assert.equal(canReportSalida(p,'two'),true)
  assert.equal(canReportSalida(p,null),true)
  assert.equal(canReportSalida({...p,driver_id:null},null),false)
  assert.equal(canReportSalida({...p,driver_id:null},null,true),true)
  assert.equal(canReportSalida(p,'one',false),false)
  assert.equal(canReportSalida({...p,access_status:'inactive'},'one'),false)
  assert.equal(canReportSalida({...p,role:'admin'},null),true)
  assert.equal(canReportSalida({...p,role:'admin',access_status:'pending'},null),false)
})
