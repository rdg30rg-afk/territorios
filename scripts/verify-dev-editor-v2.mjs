import { readFile } from 'node:fs/promises'
import { spawnSync } from 'node:child_process'

const DEV_REF = 'rkmioktcsgqqjshrlkmy'
const PASSWORD_FILE = '/tmp/territorios-dev-db-password'
if (process.env.SUPABASE_PROJECT_REF !== DEV_REF) throw new Error('Verificación permitida sólo en DEV.')
if (process.env.SUPABASE_DB_PASSWORD_FILE !== PASSWORD_FILE) {
  throw new Error(`La contraseña DEV debe venir de ${PASSWORD_FILE}.`)
}
const password = (await readFile(PASSWORD_FILE, 'utf8')).trim()
if (!password) throw new Error('El archivo de contraseña está vacío.')

const sql = String.raw`
select json_build_object(
  'candidatas_activas', count(*) filter (where activa),
  'versiones_activas', count(distinct dataset_version) filter (where activa),
  'source_keys_repetidas', count(*) - count(distinct (dataset_version, source_key))
) from public.manzana_candidatas;
select json_build_object(
  'borrador_filas', count(*),
  'revision_minima', coalesce(min(revision), 0),
  'estado_preservado', bool_and(estado is not null)
) from public.editor_estado where id = 'manzanas';
select json_build_object(
  'rpc_leer', to_regprocedure('public.leer_borrador_editor()') is not null,
  'rpc_guardar', to_regprocedure('public.guardar_borrador_editor(bigint,jsonb)') is not null,
  'rpc_descartar', to_regprocedure('public.descartar_borrador_editor(bigint)') is not null,
  'historial', to_regclass('public.editor_estado_historial') is not null
);
select json_build_object(
  'rpc_revisar_uuid', to_regprocedure('public.revisar_publicacion_editor_v2(uuid[])') is not null,
  'rpc_publicar_uuid', to_regprocedure('public.publicar_territorios_atomico_v2(uuid,jsonb)') is not null,
  'historial_publicaciones', to_regclass('public.editor_publicaciones_historial') is not null,
  'territorios_70_a_72', count(*) filter (where name in ('70', '71', '72')),
  'territorios_totales', count(*)
) from public.territorios;
do $$
declare v_admin uuid;
begin
  select id into v_admin
  from public.profiles
  where access_status = 'active' and system_role in ('admin_territorios', 'superadmin')
  order by id limit 1;
  if v_admin is null then raise exception 'DEV no tiene un admin territorial activo para probar la RPC'; end if;
  perform set_config('request.jwt.claim.sub', v_admin::text, false);
end;
$$;
select json_build_object(
  'revision_uuid_filas', jsonb_array_length(revision),
  'revision_uuid_coincide', revision -> 0 ->> 'territory_id' = territory_id::text,
  'incluye_alerta_cobertura', revision -> 0 ? 'lados_vigentes_con_cobertura'
)
from (
  select t.id as territory_id,
    public.revisar_publicacion_editor_v2(array[t.id]) as revision
  from public.territorios t where t.name = '70'
) prueba;
`

const result = spawnSync('/opt/homebrew/opt/libpq/bin/psql', [
  '-X',
  '-A',
  '-t',
  '--dbname', `postgresql://postgres@db.${DEV_REF}.supabase.co:5432/postgres?sslmode=require`,
  '--no-password',
  '--set', 'ON_ERROR_STOP=1',
  '--command', sql,
], {
  encoding: 'utf8',
  env: {
    ...process.env,
    PGPASSWORD: password,
    PGCONNECT_TIMEOUT: '15',
    PGOPTIONS: '-c statement_timeout=30000',
  },
})

if (result.status !== 0) {
  throw new Error((result.stderr || result.stdout).replaceAll(password, '[redacted]'))
}
console.log(result.stdout.trim())
