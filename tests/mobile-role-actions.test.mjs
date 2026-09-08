import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

const root = new URL('..', import.meta.url)
const [page, groupSheet, groupOutings, permissions, migration] = await Promise.all([
  readFile(new URL('src/pages/PredicacionPage.tsx', root), 'utf8'),
  readFile(new URL('src/components/HojaMiGrupo.tsx', root), 'utf8'),
  readFile(new URL('src/components/GestionSalidasGrupo.tsx', root), 'utf8'),
  readFile(new URL('src/lib/salidaCoverage.ts', root), 'utf8'),
  readFile(new URL('supabase/migrations/20260908050000_informar_salidas_y_programar_grupo.sql', root), 'utf8'),
])

test('la vista móvil usa la capacidad del servidor y no el conductor exacto', () => {
  assert.match(page, /contexto\?\.puede_informar_salidas/)
  assert.doesNotMatch(page, /query = query\.eq\('driver_id'/)
  assert.match(permissions, /puede_informar_salidas \?\? Boolean\(actor\?\.driver_id\)/)
  assert.doesNotMatch(permissions, /outing\.driverId === actor\.driver_id/)
})

test('Mi grupo permite programar con fecha, territorio, conductor y punto propio', () => {
  assert.match(groupSheet, /<GestionSalidasGrupo contexto=\{contexto\}/)
  assert.match(groupOutings, /type="date"/)
  assert.match(groupOutings, /etiqueta="Territorio"/)
  assert.match(groupOutings, /etiqueta="Conductor"/)
  assert.match(groupOutings, /p_scope: 'grupo'/)
  assert.match(groupOutings, /p_group_id: contexto\.group_id/)
  assert.match(groupOutings, /p_meeting_point_id: contexto\.punto_grupo_id/)
})

test('el servidor autoriza la capacidad, conserva auditoría y restringe el selector al responsable', () => {
  assert.match(migration, /public\.puede_informar_salidas\(auth\.uid\(\)\)/)
  assert.match(migration, /informado_por[\s\S]*?auth\.uid\(\)/)
  assert.match(migration, /public\.es_responsable_de_grupo\(p_group_id, auth\.uid\(\)\)/)
  assert.match(migration, /conductor\.status = 'activo'/)
  assert.match(migration, /Sólo un administrador puede corregir un resultado/)
})

test('conductor es una capacidad independiente y no un cargo editable del grupo', () => {
  assert.doesNotMatch(groupSheet, /'cambiar_rol', 'conductor'/)
  assert.match(groupSheet, /Conductor vinculado/)
})
