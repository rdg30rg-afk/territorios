import test from 'node:test'
import assert from 'node:assert/strict'
import { canReportSalida } from '../src/lib/salidaPermissions.ts'
test('cierre exige cuenta activa y conductor exacto, no solo rol', () => {
  const p={access_status:'active',role:'conductor',driver_id:'one'}
  assert.equal(canReportSalida(p,'one'),true)
  assert.equal(canReportSalida(p,'two'),false)
  assert.equal(canReportSalida(p,null),false)
  assert.equal(canReportSalida({...p,driver_id:null},null),false)
  assert.equal(canReportSalida({...p,access_status:'inactive'},'one'),false)
  assert.equal(canReportSalida({...p,role:'admin'},null),true)
  assert.equal(canReportSalida({...p,role:'admin',access_status:'pending'},null),false)
})
