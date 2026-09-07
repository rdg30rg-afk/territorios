import test from 'node:test'
import assert from 'node:assert/strict'
import { hasActiveAccess, hasModuleAccess, accessLanding } from '../src/lib/access.ts'

const profile = (role = 'viewer', access_status = 'active') => ({ id: 'test', full_name: 'Prueba', role, access_status, driver_id: null })
test('publicador activo entra sin módulos, pero no administra', () => {
  assert.equal(hasActiveAccess(profile()), true)
  assert.equal(hasModuleAccess(profile(), [], 'mapas'), false)
  assert.equal(accessLanding(profile(), []), '/predicacion')
  assert.equal(accessLanding(profile(), [], '/mapas'), '/predicacion')
})
test('ni rol admin ni módulos autorizan una cuenta inactiva, pendiente o sin estado', () => {
  for (const status of ['pending','inactive',null,undefined]) {
    const p = { ...profile('admin'), access_status: status }
    assert.equal(hasActiveAccess(p), false)
    assert.equal(hasModuleAccess(p, ['mapas'], 'mapas'), false)
    assert.equal(accessLanding(p, ['mapas'], '/mapas'), '/predicacion')
  }
  assert.equal(hasActiveAccess(null), false)
})
test('solo conserva destinos internos autorizados', () => {
  assert.equal(accessLanding(profile(), ['mapas'], '/mapas'), '/mapas')
  assert.equal(accessLanding(profile(), ['mapas'], '/salidas'), '/')
  assert.equal(accessLanding(profile(), ['mapas'], '/importacion'), '/')
  assert.equal(accessLanding(profile('admin'), [], '/importacion'), '/importacion')
  assert.equal(accessLanding(profile('admin'), [], '//example.com'), '/')
  assert.equal(accessLanding(profile(), [], '/predicacion'), '/predicacion')
})
