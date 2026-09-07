-- Fixture disposable para probar la frontera RPC de salidas.
-- No conecta a Supabase ni representa cuentas/IDs remotos.

create extension if not exists pgcrypto;

create role authenticated;
create role anon;
create schema auth;

create function auth.uid()
returns uuid
language sql
stable
as $$
  select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid
$$;

grant usage on schema auth, public to authenticated, anon;

create table public.profiles (
  id uuid primary key,
  full_name text not null,
  role text not null,
  access_status text not null,
  driver_id uuid
);

create table public.conductores (
  id uuid primary key,
  full_name text not null,
  status text not null default 'activo'
);

create table public.user_module_access (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  module_key text not null,
  unique (user_id, module_key)
);

create table public.territorios (
  id uuid primary key,
  name text not null
);

create table public.grupos_servicio (
  id uuid primary key,
  group_name text not null,
  driver_id uuid references public.conductores(id) on delete set null,
  manager_role text not null
);

create table public.puntos_encuentro (
  id uuid primary key,
  nombre text not null,
  barrio text,
  territory_id uuid references public.territorios(id) on delete set null,
  lat numeric,
  lng numeric,
  activo boolean not null default true,
  codigo text,
  orden smallint,
  tipo text not null default 'territorial',
  origen text not null default 'app'
);

create table public.importacion_registros (
  id uuid primary key,
  importacion_id uuid,
  pestania text,
  fila integer
);

create table public.salidas (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  territory_id uuid references public.territorios(id) on delete set null,
  driver_id uuid references public.conductores(id) on delete set null,
  group_id uuid references public.grupos_servicio(id) on delete set null,
  meeting_point_id uuid references public.puntos_encuentro(id) on delete set null,
  meeting_point_name text,
  meeting_point_lat numeric,
  meeting_point_lng numeric,
  scheduled_for timestamptz not null,
  notes text,
  tipo text check (tipo in ('telefonica', 'grupos', 'asamblea', 'especial')),
  origen text not null default 'app' check (origen in ('app', 'excel')),
  registro_id uuid references public.importacion_registros(id) on delete set null,
  conductor_texto text,
  barrio text,
  territorio_codigo text,
  created_at timestamptz not null default now()
);

create table public.salida_resultados (
  id uuid primary key,
  salida_id uuid not null references public.salidas(id) on delete restrict,
  estado text not null default 'sin_dato',
  informado_por uuid references public.profiles(id) on delete set null
);

create table public.salida_ediciones (
  id uuid primary key default gen_random_uuid(),
  salida_id uuid not null references public.salidas(id) on delete restrict,
  registro_id uuid references public.importacion_registros(id) on delete restrict,
  edited_by uuid references public.profiles(id) on delete set null,
  edited_at timestamptz not null default now(),
  changed_fields jsonb not null,
  before_snapshot jsonb not null,
  after_snapshot jsonb not null
);

create or replace function public.es_usuario_activo()
returns boolean
language sql
security definer
stable
set search_path = public
as $$
  select exists (
    select 1
    from public.profiles
    where id = auth.uid() and access_status = 'active'
  )
$$;

create or replace function public.is_admin(user_id uuid)
returns boolean
language sql
security definer
stable
set search_path = public
as $$
  select exists (
    select 1
    from public.profiles
    where id = user_id and role = 'admin' and access_status = 'active'
  )
$$;

create or replace function public.can_access_module(module_name text)
returns boolean
language sql
security definer
stable
set search_path = public
as $$
  select public.es_usuario_activo()
    and (
      public.is_admin(auth.uid())
      or exists (
        select 1
        from public.user_module_access
        where user_id = auth.uid() and module_key = module_name
      )
    )
$$;

grant execute on function public.es_usuario_activo() to authenticated;
grant execute on function public.is_admin(uuid) to authenticated;
grant execute on function public.can_access_module(text) to authenticated;

create or replace function public.protect_imported_outing_lineage()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if (old.origen = 'excel' or old.registro_id is not null)
     and (
       new.origen is distinct from old.origen
       or new.registro_id is distinct from old.registro_id
       or new.tipo is distinct from old.tipo
       or new.scheduled_for is distinct from old.scheduled_for
       or new.created_at is distinct from old.created_at
     ) then
    raise exception 'La fecha, el tipo y la procedencia de una salida importada son inmutables'
      using errcode = '55000';
  end if;
  return new;
end;
$$;

create trigger salidas_protect_imported_lineage
before update on public.salidas
for each row execute function public.protect_imported_outing_lineage();

create or replace function public.protect_imported_outing_delete()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if old.origen = 'excel' or old.registro_id is not null then
    raise exception 'Una salida importada no se elimina; debe corregirse de forma auditable'
      using errcode = '55000';
  end if;
  return old;
end;
$$;

create trigger salidas_protect_imported_delete
before delete on public.salidas
for each row execute function public.protect_imported_outing_delete();

create or replace function public.salida_operational_snapshot(p_salida public.salidas)
returns jsonb
language sql
stable
set search_path = public
as $$
  select jsonb_build_object(
    'title', p_salida.title,
    'territory_id', p_salida.territory_id,
    'driver_id', p_salida.driver_id,
    'group_id', p_salida.group_id,
    'meeting_point_id', p_salida.meeting_point_id,
    'meeting_point_name', p_salida.meeting_point_name,
    'meeting_point_lat', p_salida.meeting_point_lat,
    'meeting_point_lng', p_salida.meeting_point_lng,
    'scheduled_for', p_salida.scheduled_for,
    'notes', p_salida.notes
  )
$$;

create or replace function public.audit_imported_outing_update()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  before_data jsonb;
  after_data jsonb;
  changed_data jsonb;
begin
  if not (old.origen = 'excel' or old.registro_id is not null) then
    return new;
  end if;

  before_data := public.salida_operational_snapshot(old);
  after_data := public.salida_operational_snapshot(new);
  select coalesce(jsonb_agg(before_item.key order by before_item.key), '[]'::jsonb)
    into changed_data
  from jsonb_each(before_data) before_item
  join jsonb_each(after_data) after_item using (key)
  where before_item.value is distinct from after_item.value;

  if jsonb_array_length(changed_data) > 0 then
    insert into public.salida_ediciones (
      salida_id, registro_id, edited_by, changed_fields,
      before_snapshot, after_snapshot
    ) values (
      new.id, new.registro_id, auth.uid(), changed_data, before_data, after_data
    );
  end if;
  return new;
end;
$$;

create trigger salidas_audit_imported_update
after update on public.salidas
for each row execute function public.audit_imported_outing_update();

grant select, insert, update, delete on all tables in schema public to authenticated;

insert into public.profiles (id, full_name, role, access_status, driver_id) values
  ('00000000-0000-0000-0000-000000000001', 'Admin local', 'admin', 'active', null),
  ('00000000-0000-0000-0000-000000000002', 'Delegado local', 'conductor', 'active', '10000000-0000-0000-0000-000000000001'),
  ('00000000-0000-0000-0000-000000000003', 'Módulo salidas local', 'viewer', 'active', null),
  ('00000000-0000-0000-0000-000000000004', 'Conductor sin módulo', 'conductor', 'active', '10000000-0000-0000-0000-000000000002'),
  ('00000000-0000-0000-0000-000000000005', 'Admin inactivo', 'admin', 'inactive', null);

insert into public.conductores (id, full_name, status) values
  ('10000000-0000-0000-0000-000000000001', 'Conductor uno', 'activo'),
  ('10000000-0000-0000-0000-000000000002', 'Conductor dos', 'activo');

insert into public.user_module_access (user_id, module_key) values
  ('00000000-0000-0000-0000-000000000002', 'salidas_grupo'),
  ('00000000-0000-0000-0000-000000000003', 'salidas');

insert into public.territorios (id, name) values
  ('30000000-0000-0000-0000-000000000001', 'Territorio uno'),
  ('30000000-0000-0000-0000-000000000002', 'Territorio dos'),
  ('30000000-0000-0000-0000-000000000003', 'Territorio tres');

insert into public.grupos_servicio (id, group_name, driver_id, manager_role) values
  ('20000000-0000-0000-0000-000000000001', 'Grupo permitido', '10000000-0000-0000-0000-000000000001', 'superintendente'),
  ('20000000-0000-0000-0000-000000000002', 'Grupo no permitido', '10000000-0000-0000-0000-000000000002', 'siervo');

insert into public.puntos_encuentro (id, nombre, barrio, territory_id, lat, lng, codigo, orden, tipo) values
  ('40000000-0000-0000-0000-000000000001', 'Punto local', 'Bo. Prueba', '30000000-0000-0000-0000-000000000001', -31.5375, -68.5364, '61.1', 1, 'territorial');

insert into public.importacion_registros (id, importacion_id, pestania, fila) values
  ('50000000-0000-0000-0000-000000000001', '51000000-0000-0000-0000-000000000001', 'Salidas', 4);

insert into public.salidas (
  id, title, territory_id, driver_id, group_id, meeting_point_name,
  meeting_point_lat, meeting_point_lng, scheduled_for, notes, tipo,
  origen, registro_id
) values (
  '60000000-0000-0000-0000-000000000001', 'Histórica local',
  '30000000-0000-0000-0000-000000000001',
  '10000000-0000-0000-0000-000000000001',
  '20000000-0000-0000-0000-000000000001', 'Dirección histórica',
  null, null, '2026-01-10 12:00:00+00', 'Fuente intacta', 'especial',
  'excel', '50000000-0000-0000-0000-000000000001'
), (
  '60000000-0000-0000-0000-000000000002', 'Salida con resultado',
  '30000000-0000-0000-0000-000000000002',
  '10000000-0000-0000-0000-000000000001', null, 'Dirección resultado',
  -31.5375, -68.5364, '2026-01-11 12:00:00+00', null, null,
  'app', null
);

insert into public.salida_resultados (id, salida_id, estado, informado_por) values
  ('70000000-0000-0000-0000-000000000001', '60000000-0000-0000-0000-000000000002', 'realizada', '00000000-0000-0000-0000-000000000001');

\ir ../../supabase/migrations/20260906020000_salidas_por_rpc.sql
\ir ../../supabase/migrations/20260907020000_salidas_rpc_completa_desde_punto.sql

set role authenticated;

do $$
declare
  v_id uuid;
  v_count bigint;
  v_created_at timestamptz;
  v_scheduled_for timestamptz;
  v_registro_id uuid;
  v_tipo text;
  v_audit_count bigint;
begin
  if has_table_privilege('authenticated', 'public.salidas', 'INSERT')
     or has_table_privilege('authenticated', 'public.salidas', 'UPDATE')
     or has_table_privilege('authenticated', 'public.salidas', 'DELETE') then
    raise exception 'DML directo residual en authenticated';
  end if;

  perform set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000001', false);
  select id into v_id
  from public.crear_salida(
    'general', 'Alta RPC', '30000000-0000-0000-0000-000000000002',
    '10000000-0000-0000-0000-000000000001', null,
    '40000000-0000-0000-0000-000000000001', 'Punto alta',
    -31.5375, -68.5364, '2026-09-10 12:00:00+00', 'nota alta'
  );
  if not exists (
    select 1 from public.salidas
    where id = v_id and origen = 'app' and registro_id is null
      and territorio_codigo = '61.1' and barrio = 'Bo. Prueba'
  ) then
    raise exception 'Alta no copió código y barrio desde el punto';
  end if;

  perform set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000002', false);
  select id into v_id
  from public.crear_salida(
    'grupo', 'Alta grupo RPC', '30000000-0000-0000-0000-000000000003',
    '10000000-0000-0000-0000-000000000001',
    '20000000-0000-0000-0000-000000000001', null, 'Punto grupo',
    -31.5375, -68.5364, '2026-09-11 12:00:00+00', null
  );

  perform set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000003', false);
  begin
    perform public.crear_salida(
      'general', 'No autorizado por módulo', '30000000-0000-0000-0000-000000000002',
      '10000000-0000-0000-0000-000000000001', null, null, 'Punto',
      -31.5375, -68.5364, '2026-09-12 12:00:00+00', null
    );
    raise exception 'El módulo salidas habilitó DML no-admin';
  exception when others then
    if sqlstate <> '42501' then raise; end if;
  end;

  perform set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000004', false);
  begin
    perform public.crear_salida(
      'grupo', 'Sin módulo', '30000000-0000-0000-0000-000000000002',
      '10000000-0000-0000-0000-000000000002',
      '20000000-0000-0000-0000-000000000002', null, 'Punto',
      -31.5375, -68.5364, '2026-09-13 12:00:00+00', null
    );
    raise exception 'El conductor sin módulo escribió';
  exception when others then
    if sqlstate <> '42501' then raise; end if;
  end;

  perform set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000005', false);
  begin
    perform public.crear_salida(
      'general', 'Admin inactivo', '30000000-0000-0000-0000-000000000002',
      '10000000-0000-0000-0000-000000000001', null, null, 'Punto',
      -31.5375, -68.5364, '2026-09-14 12:00:00+00', null
    );
    raise exception 'El admin inactivo escribió';
  exception when others then
    if sqlstate <> '42501' then raise; end if;
  end;

  perform set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000002', false);
  begin
    perform public.crear_salida(
      'grupo', 'Grupo ajeno', '30000000-0000-0000-0000-000000000002',
      '10000000-0000-0000-0000-000000000002',
      '20000000-0000-0000-0000-000000000002', null, 'Punto',
      -31.5375, -68.5364, '2026-09-15 12:00:00+00', null
    );
    raise exception 'El delegado escribió grupo ajeno';
  exception when others then
    if sqlstate <> '42501' then raise; end if;
  end;

  perform set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000001', false);
  select count(*) into v_count from public.salidas;
  begin
    perform public.crear_salidas_lote(
      'general', jsonb_build_array(
        jsonb_build_object(
          'title', 'Campo forjado',
          'territory_id', '30000000-0000-0000-0000-000000000002',
          'driver_id', '10000000-0000-0000-0000-000000000001',
          'meeting_point_name', 'Punto',
          'meeting_point_lat', -31.5375,
          'meeting_point_lng', -68.5364,
          'scheduled_for', '2026-09-16T12:00:00Z',
          'origen', 'excel'
        )
      )
    );
    raise exception 'El lote aceptó origen/registro_id fuera de whitelist';
  exception when others then
    if sqlstate <> '22023' then raise; end if;
  end;
  if (select count(*) from public.salidas) <> v_count then
    raise exception 'El lote inválido cambió datos';
  end if;

  select count(*) into v_count from public.salidas;
  begin
    perform public.crear_salidas_lote(
      'general', jsonb_build_array(
        jsonb_build_object(
          'title', 'Lote uno',
          'territory_id', '30000000-0000-0000-0000-000000000001',
          'driver_id', '10000000-0000-0000-0000-000000000001',
          'meeting_point_name', 'Punto',
          'meeting_point_lat', -31.5375,
          'meeting_point_lng', -68.5364,
          'scheduled_for', '2026-09-17T12:00:00Z'
        ),
        jsonb_build_object(
          'title', 'Lote inválido',
          'territory_id', '30000000-0000-0000-0000-000000000002',
          'driver_id', '10000000-0000-0000-0000-000000000001',
          'meeting_point_name', 'Punto',
          'meeting_point_lat', 99,
          'meeting_point_lng', -68.5364,
          'scheduled_for', '2026-09-18T12:00:00Z'
        )
      )
    );
    raise exception 'El lote inválido se confirmó';
  exception when others then
    if sqlstate <> '22023' then raise; end if;
  end;
  if (select count(*) from public.salidas) <> v_count then
    raise exception 'El lote con una fila inválida no fue atómico';
  end if;

  select created_at, scheduled_for, registro_id, tipo
    into v_created_at, v_scheduled_for, v_registro_id, v_tipo
  from public.salidas
  where id = '60000000-0000-0000-0000-000000000001';
  select count(*) into v_audit_count from public.salida_ediciones;
  select id into v_id
  from public.editar_salida(
    'general', '60000000-0000-0000-0000-000000000001',
    'Histórica corregida', '30000000-0000-0000-0000-000000000001',
    '10000000-0000-0000-0000-000000000001',
    '20000000-0000-0000-0000-000000000001', null,
    'Nueva dirección histórica', -31.5376, -68.5365,
    '2026-01-10 12:00:00+00', 'Corrección humana'
  );
  if v_id <> '60000000-0000-0000-0000-000000000001'
     or (select title from public.salidas where id = v_id) <> 'Histórica corregida'
     or (select created_at from public.salidas where id = v_id) <> v_created_at
     or (select scheduled_for from public.salidas where id = v_id) <> v_scheduled_for
     or (select registro_id from public.salidas where id = v_id) <> v_registro_id
     or (select tipo from public.salidas where id = v_id) <> v_tipo
     or (select count(*) from public.salida_ediciones) <= v_audit_count then
    raise exception 'Edición histórica no conservó linaje/auditoría';
  end if;

  begin
    perform public.borrar_salida('general', '60000000-0000-0000-0000-000000000001');
    raise exception 'Se borró salida histórica';
  exception when others then
    if sqlstate <> '55000' then raise; end if;
  end;

  begin
    perform public.borrar_salida('general', '60000000-0000-0000-0000-000000000002');
    raise exception 'Se borró salida con resultado';
  exception when others then
    if sqlstate <> '23503' then raise; end if;
  end;
  if not exists (select 1 from public.salidas where id = '60000000-0000-0000-0000-000000000002') then
    raise exception 'La salida con resultado desapareció';
  end if;

  select id into v_id
  from public.crear_salida(
    'general', 'Borrado permitido', '30000000-0000-0000-0000-000000000003',
    '10000000-0000-0000-0000-000000000001', null, null, 'Punto',
    -31.5375, -68.5364, '2026-09-19 12:00:00+00', null
  );
  perform public.borrar_salida('general', v_id);
  if exists (select 1 from public.salidas where id = v_id) then
    raise exception 'No se borró una salida app sin historia';
  end if;
end;
$$;

reset role;
select 'PASS: RPC salidas, autorización efectiva, whitelist, lote atómico, linaje histórico, FK de resultados y borrado permitido' as resultado;
