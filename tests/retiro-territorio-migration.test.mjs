import assert from 'node:assert/strict'
import test from 'node:test'
import { readFile } from 'node:fs/promises'

const sql = await readFile(
  new URL('../supabase/migrations/20260921010000_retiro_territorio.sql', import.meta.url),
  'utf8',
)

function cuerpo(nombre) {
  const start = sql.indexOf(`create or replace function public.${nombre}`)
  assert.notEqual(start, -1, nombre)
  return sql.slice(start, sql.indexOf('$$;', start) + 3)
}

test('el retiro agrega estado y una bitácora idempotente, sin unretire ni delete', () => {
  assert.match(sql, /add column if not exists retired_at timestamptz/)
  assert.match(sql, /retired_by uuid references public\.profiles \(id\) on delete set null/)
  assert.match(sql, /retirement_note text/)
  assert.match(sql, /create table if not exists public\.territory_retirements/)
  assert.match(sql, /operation_id uuid primary key/)
  assert.match(sql, /on public\.territory_retirements \(territory_id\)/)
  assert.match(sql, /revoke all on table public\.territory_retirements from public, anon, authenticated/)
  assert.doesNotMatch(sql, /create or replace function public\.unretire/i)
  assert.doesNotMatch(sql, /delete from public\.territorios/i)
  assert.doesNotMatch(sql, /delete from public\.territorio_manzanas/i)
  assert.doesNotMatch(sql, /delete from public\.manzana_lados/i)
})

test('preflight y confirmación exigen admin y distinguen replay de ya retirado', () => {
  for (const nombre of ['preflight_retirar_territorio', 'retirar_territorio']) {
    assert.match(cuerpo(nombre), /public\.is_admin\(auth\.uid\(\)\)|public\.is_admin\(v_actor\)/)
    assert.match(cuerpo(nombre), /using errcode = '42501'/)
  }
  const confirmar = cuerpo('retirar_territorio')
  assert.ok(confirmar.indexOf('for update') < confirmar.indexOf('retiro_territorio_bloqueos'))
  assert.match(confirmar, /'status', 'replayed'/)
  assert.match(confirmar, /'replayed', true/)
  assert.match(confirmar, /'status', 'already_retired'/)
  assert.match(confirmar, /'replayed', false/)
  assert.match(confirmar, /using errcode = '40001'/)
  assert.match(confirmar, /using errcode = '23505'/)
  assert.match(confirmar, /greatest\(v_previous, coalesce\(max\(manzana\.geometry_version\), 0\), 0\) \+ 1/)
  assert.match(confirmar, /set_config\('territorios\.retiro_en_curso', '1', true\)/)
})

test('los bloqueos son reserva activa, solicitud, salida futura sin cierre y grupo vigente', () => {
  const bloqueos = cuerpo('retiro_territorio_bloqueos')
  assert.match(bloqueos, /'reserva_activa'/)
  assert.match(bloqueos, /'reserva_solicitada'/)
  assert.match(bloqueos, /'salida_futura'/)
  assert.match(bloqueos, /actual\.estado = 'sin_dato'/)
  assert.match(bloqueos, /salida\.scheduled_for > clock_timestamp\(\)/)
  assert.match(bloqueos, /'grupo_vigente'/)
  assert.match(bloqueos, /legacy_territory_id = p_territory_id/)
})

test('el resultado nuevo toma el territorio antes que la salida', () => {
  const informar = cuerpo('informar_resultado_salida')
  const territorio = informar.indexOf('from public.territorios')
  const salida = informar.indexOf('from public.salidas\n  where id = p_salida_id\n  for share')
  assert.ok(territorio !== -1 && salida !== -1 && territorio < salida)
  assert.match(informar, /no se puede informar un resultado nuevo/)
  assert.match(informar, /p_corrige_id <> v_actual\.id/)
})

test('la actividad nueva queda cerrada y la vista publicada oculta el legado retirado', () => {
  for (const tabla of [
    'territorio_manzanas',
    'manzana_lados',
    'territorio_personal_reservas',
    'salidas',
    'cobertura_eventos',
    'salida_resultados',
    'grupo_territorio',
    'territory_unit_versions',
  ]) {
    assert.match(sql, new RegExp(`on public\\.${tabla}`))
  }
  assert.match(sql, /El retiro es irreversible/)
  assert.match(sql, /new\.origen = 'correccion' and public\.is_admin\(auth\.uid\(\)\)/)
  assert.match(sql, /legado\.retired_at is not null/)
  assert.match(sql, /grant execute on function public\.retirar_territorio\(uuid, integer, uuid, text\) to authenticated/)
  assert.match(sql, /grant execute on function public\.preflight_retirar_territorio\(uuid\) to authenticated/)
})
