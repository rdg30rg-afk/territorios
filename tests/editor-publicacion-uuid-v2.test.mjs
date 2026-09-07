import assert from 'node:assert/strict'
import test from 'node:test'
import { readFile } from 'node:fs/promises'

const sql = await readFile(new URL(
  '../supabase/migrations/20260908060000_publicacion_editor_uuid_v2.sql',
  import.meta.url,
), 'utf8')

test('las RPC v2 identifican territorios exclusivamente por UUID', () => {
  assert.match(sql, /revisar_publicacion_editor_v2\(p_territory_ids uuid\[\]\)/)
  assert.match(sql, /publicar_territorios_atomico_v2\([\s\S]*?p_operation_id uuid,[\s\S]*?p_cambios jsonb/)
  assert.match(sql, /item ->> 'territory_id'/)
  assert.doesNotMatch(sql, /lower\(name\)\s*=\s*lower/)
})

test('valida el lote completo y bloquea en orden antes de retirar geometrías', () => {
  const validation = sql.indexOf('Validación estructural completa')
  const locks = sql.indexOf('Un orden global evita deadlocks')
  const revisions = sql.indexOf('Ninguna geometría cambia')
  const retirement = sql.indexOf('update public.manzana_lados', revisions)
  assert.ok(validation > 0 && validation < locks)
  assert.ok(locks < revisions && revisions < retirement)
  assert.match(sql, /where id = v_bloqueado\.id for update/)
  assert.match(sql, /using errcode = '40001'/)
})

test('conserva historia de geometrías y cobertura al reemplazar', () => {
  assert.match(sql, /set vigente_hasta = v_instante[\s\S]*?where territory_id = v_territory_id/)
  assert.match(sql, /lados_con_cobertura_retirados/)
  assert.doesNotMatch(sql, /delete from public\.(territorio_manzanas|manzana_lados)/)
})

test('audita actor, lote, versiones anteriores y resultado confirmado', () => {
  assert.match(sql, /create table if not exists public\.editor_publicaciones_historial/)
  assert.match(sql, /actor_id uuid references public\.profiles/)
  assert.match(sql, /insert into public\.editor_publicaciones_historial/)
  assert.match(sql, /p_operation_id, v_solicitud_hash, auth\.uid\(\), v_ids/)
})

test('un reintento con el mismo operation_id devuelve el resultado confirmado', () => {
  assert.match(sql, /operation_id uuid not null unique/)
  assert.match(sql, /pg_advisory_xact_lock\(hashtextextended\(p_operation_id::text, 0\)\)/)
  assert.match(sql, /where operation_id = p_operation_id and solicitud_hash = v_solicitud_hash/)
  assert.match(sql, /if found then return v_resultado_previo/)
})

test('sólo un admin territorial activo puede revisar o publicar', () => {
  assert.equal((sql.match(/public\.es_admin_territorios\(auth\.uid\(\)\)/g) ?? []).length >= 3, true)
  assert.match(sql, /revoke all on table public\.editor_publicaciones_historial from public, anon, authenticated/)
  assert.match(sql, /grant execute on function public\.publicar_territorios_atomico_v2\(uuid, jsonb\) to authenticated/)
})
