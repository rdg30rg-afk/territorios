import test from 'node:test'
import assert from 'node:assert/strict'
import {
  filtrosSalidas,
  normalizarCodigoGrupo,
  panelesHoy,
  puedeMarcarTerritorio,
  puedePedirTerritorio,
  tituloSalidaGrupo,
} from '../src/lib/vistaHermano.ts'

const base = {
  role: 'viewer',
  access_status: 'active',
  driver_id: null,
  group_id: null,
  group_number: null,
  group_name: null,
  rol_en_grupo: null,
  miembro_estado: null,
  punto_grupo_id: null,
  punto_grupo_nombre: null,
  punto_grupo_lat: null,
  punto_grupo_lng: null,
  es_super_de_grupo: false,
}

test('1: publicador sin grupo ve el código y puede pedir territorio', () => {
  const ctx = { ...base }
  assert.deepEqual(panelesHoy(ctx), ['saludo', 'sinGrupo', 'tuTerritorio'])
  assert.equal(puedePedirTerritorio(ctx), true)
  assert.equal(filtrosSalidas(ctx).lasMias, false)
})

test('2: publicador confirmado ve la salida del grupo', () => {
  const ctx = {
    ...base,
    group_id: 'g1',
    group_number: 3,
    miembro_estado: 'confirmado',
    rol_en_grupo: 'publicador',
  }
  assert.ok(panelesHoy(ctx).includes('tuGrupoSale'))
  assert.equal(panelesHoy(ctx).includes('sinGrupo'), false)
  assert.equal(puedePedirTerritorio(ctx), true)
})

test('3: miembro pendiente no puede pedir ni marcar', () => {
  const ctx = { ...base, group_id: 'g1', miembro_estado: 'pendiente' }
  assert.equal(puedePedirTerritorio(ctx), false)
  assert.equal(puedeMarcarTerritorio(ctx, true), false)
  assert.ok(panelesHoy(ctx).includes('tuGrupoSale'))
})

test('9: conductor sin grupo ve sus salidas, no las del grupo', () => {
  const ctx = { ...base, role: 'conductor', driver_id: 'd1' }
  assert.ok(panelesHoy(ctx).includes('sosConductor'))
  assert.ok(panelesHoy(ctx).includes('sinGrupo'))
  assert.equal(filtrosSalidas(ctx).lasMias, true)
  assert.equal(filtrosSalidas(ctx).resultado, true)
})

test('12: super sin driver_id ve Mi grupo, no conduce', () => {
  const ctx = {
    ...base,
    role: 'superintendente',
    group_id: 'g1',
    miembro_estado: 'confirmado',
    rol_en_grupo: 'superintendente',
    es_super_de_grupo: true,
  }
  assert.ok(panelesHoy(ctx).includes('resumenGrupo'))
  assert.equal(panelesHoy(ctx).includes('sosConductor'), false)
  assert.equal(filtrosSalidas(ctx).lasDeMiGrupo, true)
  assert.equal(filtrosSalidas(ctx).lasMias, false)
})

test('13: super que además conduce ve todo', () => {
  const ctx = {
    ...base,
    role: 'superintendente',
    driver_id: 'd1',
    group_id: 'g1',
    miembro_estado: 'confirmado',
    rol_en_grupo: 'superintendente',
    es_super_de_grupo: true,
  }
  const paneles = panelesHoy(ctx)
  assert.ok(paneles.includes('tuGrupoSale'))
  assert.ok(paneles.includes('sosConductor'))
  assert.ok(paneles.includes('resumenGrupo'))
})

test('17: admin sin grupo no ve Mi grupo', () => {
  const ctx = { ...base, role: 'admin', driver_id: 'd1' }
  assert.equal(panelesHoy(ctx).includes('resumenGrupo'), false)
  assert.equal(filtrosSalidas(ctx).resultado, true)
})

test('22: la fila de grupos habla distinto según el grupo', () => {
  assert.equal(
    tituloSalidaGrupo({ tipo: 'grupos', tieneGrupo: false }),
    'Cada grupo por su lado · preguntá en tu grupo',
  )
  assert.equal(
    tituloSalidaGrupo({ tipo: 'grupos', tieneGrupo: true, puntoNombre: 'Plaza' }),
    'Tu grupo sale de Plaza',
  )
})

test('el código del grupo se limpia a 6 letras', () => {
  assert.equal(normalizarCodigoGrupo('kp mr tx'), 'KPMRTX')
  assert.equal(normalizarCodigoGrupo('k1o'), 'K')
})
