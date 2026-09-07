import test from 'node:test'
import assert from 'node:assert/strict'
import {
  accessLanding,
  canManageAdministrators,
  canOpenAdminPanel,
  effectiveSystemRole,
  hasActiveAccess,
  hasModuleAccess,
} from '../src/lib/access.ts'

const profile = (role = 'viewer', access_status = 'active', system_role) => ({
  id: 'test', full_name: 'Prueba', role, access_status, driver_id: null, system_role,
})

test('miembro activo aterriza en predicación aunque conserve módulos viejos', () => {
  assert.equal(hasActiveAccess(profile()), true)
  assert.equal(hasModuleAccess(profile(), ['mapas'], 'mapas'), false)
  assert.equal(accessLanding(profile(), []), '/predicacion')
  assert.equal(accessLanding(profile(), [], '/mapas'), '/predicacion')
  assert.equal(canOpenAdminPanel(profile(), { puede_abrir_panel: true }), true)
})

test('admin territorial y superadmin ven todos los módulos', () => {
  const admin = profile('viewer', 'active', 'admin_territorios')
  const superadmin = profile('viewer', 'active', 'superadmin')
  for (const p of [admin, superadmin]) {
    assert.equal(hasModuleAccess(p, [], 'mapas'), true)
    assert.equal(hasModuleAccess(p, [], 'salidas'), true)
    assert.equal(accessLanding(p, [], '/importacion'), '/importacion')
  }
  assert.equal(canManageAdministrators(admin), false)
  assert.equal(canManageAdministrators(superadmin), true)
})

test('rol legacy admin sólo funciona si system_role no está definido', () => {
  const legacy = profile('admin')
  assert.equal(effectiveSystemRole(legacy), 'admin_territorios')
  assert.equal(canOpenAdminPanel(legacy), true)
  assert.equal(canOpenAdminPanel(profile('admin', 'active', null)), true)
  assert.equal(effectiveSystemRole(profile('admin', 'active', 'miembro')), 'miembro')
  assert.equal(canOpenAdminPanel(profile('admin', 'active', 'miembro')), false)
})

test('las banderas explícitas de mi_contexto son autoritativas', () => {
  const admin = profile('viewer', 'active', 'admin_territorios')
  const superadmin = profile('viewer', 'active', 'superadmin')
  assert.equal(canOpenAdminPanel(admin, { puede_abrir_panel: false }), false)
  assert.equal(canOpenAdminPanel(profile(), { puede_abrir_panel: true }), true)
  assert.equal(canManageAdministrators(superadmin, {
    puede_abrir_panel: true,
    puede_administrar_admins: false,
  }), false)
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
  assert.equal(accessLanding(profile(), ['mapas'], '/mapas'), '/predicacion')
  assert.equal(accessLanding(profile(), ['mapas'], '/salidas'), '/predicacion')
  assert.equal(accessLanding(profile(), ['mapas'], '/importacion'), '/predicacion')
  assert.equal(accessLanding(profile('admin'), [], '/importacion'), '/importacion')
  assert.equal(accessLanding(profile('admin'), [], '//example.com'), '/')
  assert.equal(accessLanding(profile(), [], '/predicacion'), '/predicacion')
})
