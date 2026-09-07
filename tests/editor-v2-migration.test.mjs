import assert from 'node:assert/strict'
import test from 'node:test'
import { readFile } from 'node:fs/promises'

const sql = await readFile(
  new URL('../supabase/migrations/20260908050000_editor_candidatas_y_borrador_v2.sql', import.meta.url),
  'utf8',
)

test('la fuente candidata es versionada, paginable y sólo de lectura para admins', () => {
  assert.match(sql, /create table if not exists public\.manzana_candidatas/)
  assert.match(sql, /unique \(dataset_version, source_key\)/)
  assert.match(sql, /manzana_candidatas_activas_bbox_idx/)
  assert.match(sql, /using \(public\.es_admin_territorios\(auth\.uid\(\)\)\)/)
  assert.match(sql, /revoke all on table public\.manzana_candidatas/)
  assert.match(sql, /grant select on table public\.manzana_candidatas to authenticated/)
})

test('el borrador usa revisión monotónica y lock antes de comparar', () => {
  assert.match(sql, /add column if not exists revision bigint not null default 0/)
  assert.match(sql, /create or replace function public\.guardar_borrador_editor/)
  const save = sql.slice(sql.indexOf('create or replace function public.guardar_borrador_editor'))
  assert.ok(save.indexOf('for update') < save.indexOf('v_fila.revision <> p_revision'))
  assert.match(save, /v_revision := v_fila\.revision \+ 1/)
  assert.match(save, /using errcode = '40001'/)
})

test('leer, guardar y descartar requieren admin y no exponen escritura de tablas', () => {
  for (const name of ['leer_borrador_editor', 'guardar_borrador_editor', 'descartar_borrador_editor']) {
    const start = sql.indexOf(`create or replace function public.${name}`)
    assert.notEqual(start, -1)
    assert.match(sql.slice(start, sql.indexOf('$$;', start) + 3), /es_admin_territorios\(auth\.uid\(\)\)/)
  }
  assert.match(sql, /revoke all on table public\.editor_estado_historial from public, anon, authenticated/)
})

test('cada revisión queda en historial con actor y fecha de servidor', () => {
  assert.match(sql, /create table if not exists public\.editor_estado_historial/)
  assert.match(sql, /unique \(borrador_id, revision\)/)
  assert.match(sql, /'manzanas', v_fila\.revision, 'guardar', v_fila\.estado, auth\.uid\(\), v_fila\.actualizado_at/)
  assert.match(sql, /'manzanas', v_fila\.revision, 'descartar', v_fila\.estado, auth\.uid\(\), v_fila\.actualizado_at/)
})
