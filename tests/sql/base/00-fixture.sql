\set ON_ERROR_STOP on

-- Fixture local y descartable para las migraciones de noviembre de 2026.
-- Arma el esquema mínimo que tenía la base ANTES de esas migraciones y aplica,
-- tal cual están en el repo y en el orden en que se aplicaron en producción,
-- las migraciones de las que dependen. No se copia ninguna función: lo que se
-- prueba es el SQL real.
--
-- Nunca toca Supabase ni ninguna base remota.

create extension if not exists pgcrypto;

do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'authenticated') then
    create role authenticated;
  end if;
  if not exists (select 1 from pg_roles where rolname = 'anon') then
    create role anon;
  end if;
end
$$;

create schema if not exists auth;

create or replace function auth.uid()
returns uuid
language sql
stable
as $$
  select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid
$$;

grant usage on schema auth, public to authenticated, anon;
grant execute on function auth.uid() to public;

create table public.conductores (
  id uuid primary key,
  full_name text not null,
  status text not null default 'activo'
);

create table public.profiles (
  id uuid primary key,
  full_name text not null,
  role text not null,
  access_status text not null,
  driver_id uuid references public.conductores (id) on delete set null,
  auth_email text,
  username text
);

create table public.grupos_servicio (
  id uuid primary key,
  group_number integer not null,
  group_name text not null,
  manager_name text,
  manager_role text,
  driver_id uuid,
  created_at timestamptz not null default now()
);

create table public.puntos_encuentro (
  id uuid primary key default gen_random_uuid(),
  nombre text not null,
  lat numeric,
  lng numeric,
  tipo text not null default 'territorial',
  codigo text,
  maps_url text,
  origen text,
  gps_origen text,
  activo boolean not null default true
);

create table public.user_module_access (
  user_id uuid not null references public.profiles (id) on delete cascade,
  module_key text not null,
  primary key (user_id, module_key)
);

create table public.grupo_territorio (
  group_id uuid references public.grupos_servicio (id) on delete cascade
);

create table public.territorios (
  id uuid primary key,
  name text not null,
  retired_at timestamptz
);

create table public.salidas (
  id uuid primary key default gen_random_uuid(),
  title text,
  group_id uuid references public.grupos_servicio (id) on delete set null,
  territory_id uuid references public.territorios (id) on delete set null,
  driver_id uuid references public.conductores (id) on delete set null,
  territorio_codigo text,
  tipo text,
  meeting_point_id uuid,
  meeting_point_name text,
  meeting_point_lat numeric,
  meeting_point_lng numeric,
  scheduled_for timestamptz,
  notes text,
  origen text not null default 'app',
  registro_id uuid,
  created_at timestamptz not null default now()
);

-- Resultados de salida: sólo el vínculo que impide borrar una salida con historia.
create table public.salida_resultados (
  id uuid primary key default gen_random_uuid(),
  salida_id uuid not null references public.salidas (id) on delete restrict,
  estado text not null
);

-- Reservas personales, como quedaron tras 20260902200000.
create table public.territorio_personal_reservas (
  id uuid primary key default gen_random_uuid(),
  territory_id uuid not null references public.territorios (id) on delete cascade,
  reserved_for text not null,
  status text not null default 'activa'
    check (status in ('solicitada', 'activa', 'liberada', 'rechazada')),
  reserved_at timestamptz not null default now(),
  released_at timestamptz,
  created_by uuid references public.profiles (id) on delete set null,
  requested_by uuid references public.profiles (id) on delete set null,
  requested_at timestamptz,
  decided_by uuid references public.profiles (id) on delete set null,
  decided_at timestamptz,
  nota text
);
create unique index territorio_personal_reservas_active_unique_idx
  on public.territorio_personal_reservas (territory_id) where status = 'activa';
create unique index reservas_solicitud_unica_idx
  on public.territorio_personal_reservas (territory_id, requested_by) where status = 'solicitada';

-- Cobertura: sólo las columnas que usa informar_cobertura.
create table public.territorio_manzanas (
  id uuid primary key,
  territory_id uuid not null references public.territorios (id),
  geometry_version integer not null default 1,
  vigente_hasta timestamptz
);
create table public.manzana_lados (
  id uuid primary key,
  manzana_id uuid not null references public.territorio_manzanas (id),
  territory_id uuid not null references public.territorios (id),
  geometry_version integer not null default 1,
  vigente_hasta timestamptz
);
create table public.cobertura_eventos (
  id uuid primary key default gen_random_uuid(),
  lado_id uuid not null references public.manzana_lados (id) on delete restrict,
  manzana_id uuid not null references public.territorio_manzanas (id) on delete restrict,
  territory_id uuid not null references public.territorios (id) on delete restrict,
  estado text not null check (estado in ('recorrido', 'no_accesible', 'revisitar', 'sin_dato')),
  origen text not null check (origen in ('app_hermano', 'cierre_salida', 'importacion', 'correccion')),
  informado_por uuid references public.profiles (id) on delete set null,
  informado_at timestamptz not null default now(),
  salida_id uuid references public.salidas (id) on delete set null,
  nota text,
  corrige_evento_id uuid references public.cobertura_eventos (id) on delete restrict,
  origen_detalle jsonb,
  created_at timestamptz not null default now()
);

-- Helpers históricos de acceso (los reemplazan las migraciones de roles).
create or replace function public.es_usuario_activo()
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.profiles where id = auth.uid() and access_status = 'active')
$$;
create or replace function public.is_admin(user_id uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.profiles where id = user_id and role = 'admin' and access_status = 'active')
$$;
create or replace function public.can_access_module(module_name text)
returns boolean language sql stable security definer set search_path = public as $$
  select public.is_admin(auth.uid())
$$;
create or replace function public.actualizar_mi_nombre(p_nombre text)
returns void language sql as $$ select 1 $$;

create or replace function public.assert_true(p_condition boolean, p_message text)
returns void language plpgsql as $$
begin
  if coalesce(p_condition, false) is not true then
    raise exception '%', p_message;
  end if;
end;
$$;

-- Comprueba que una sentencia falla con ese SQLSTATE (y, si se pide, con un
-- mensaje que cumpla el LIKE). Corre con el rol de quien la llama.
create or replace function public.assert_raises(p_sql text, p_state text, p_like text default null)
returns void language plpgsql as $$
declare
  v_fallo boolean := false;
  v_state text;
  v_msg text;
begin
  begin
    execute p_sql;
  exception when others then
    v_fallo := true;
    v_state := sqlstate;
    v_msg := sqlerrm;
  end;
  if not v_fallo then
    raise exception 'Debía fallar y no falló: %', p_sql;
  end if;
  if v_state <> p_state then
    raise exception 'Falló con % (%), esperaba %: %', v_state, v_msg, p_state, p_sql;
  end if;
  if p_like is not null and v_msg not like p_like then
    raise exception 'Mensaje inesperado «%» (esperaba «%»): %', v_msg, p_like, p_sql;
  end if;
end;
$$;

-- Actúa como esa cuenta (rol authenticated + sub del JWT).
create or replace function public.actuar_como(p_uuid text)
returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claim.sub', p_uuid, false);
end;
$$;

-- Datos.
insert into public.conductores (id, full_name) values
  ('70000000-0000-0000-0000-000000000001', 'Conductor Uno'),
  ('70000000-0000-0000-0000-000000000002', 'Conductor Dos');

insert into public.profiles (id, full_name, role, access_status, driver_id) values
  ('00000000-0000-0000-0000-000000000001', 'Admin único', 'admin', 'active', null),
  ('00000000-0000-0000-0000-000000000002', 'Publicador A confirmado', 'viewer', 'active', null),
  ('00000000-0000-0000-0000-000000000003', 'Publicador A pendiente', 'viewer', 'active', null),
  ('00000000-0000-0000-0000-000000000004', 'Superintendente A', 'viewer', 'active', null),
  ('00000000-0000-0000-0000-000000000005', 'Publicador B confirmado', 'viewer', 'active', null),
  ('00000000-0000-0000-0000-000000000006', 'Admin territorios', 'viewer', 'active', null),
  ('00000000-0000-0000-0000-000000000007', 'Hermano sin grupo', 'viewer', 'active', null),
  ('00000000-0000-0000-0000-000000000008', 'Cuenta nueva pendiente', 'viewer', 'pending', null),
  ('00000000-0000-0000-0000-000000000009', 'Publicador A segundo', 'viewer', 'active', null),
  ('00000000-0000-0000-0000-00000000000a', 'Conductor con cuenta', 'viewer', 'active',
    '70000000-0000-0000-0000-000000000001');

insert into public.grupos_servicio (id, group_number, group_name, manager_name, manager_role) values
  ('10000000-0000-0000-0000-000000000001', 1, 'Grupo A', 'Nadie importado', 'superintendente'),
  ('10000000-0000-0000-0000-000000000002', 2, 'Grupo B', 'Nadie importado', 'superintendente');

insert into public.territorios (id, name) values
  ('20000000-0000-0000-0000-000000000001', '1'),
  ('20000000-0000-0000-0000-000000000002', '2'),
  ('20000000-0000-0000-0000-000000000003', '3'),
  ('20000000-0000-0000-0000-000000000004', '4');

-- Migraciones reales, en el orden de producción.
\ir ../../../supabase/migrations/20260905020000_reservas_por_persona_y_decisiones.sql
\ir ../../../supabase/migrations/20260905030000_cobertura_por_rpc_idempotente.sql
\ir ../../../supabase/migrations/20260908020000_grupos_miembros_e_invitaciones.sql
\ir ../../../supabase/migrations/20260908030000_completar_sembrado_y_lectura_grupo.sql
\ir ../../../supabase/migrations/20260908035000_normalizar_grupos_servicio.sql
\ir ../../../supabase/migrations/20260908040000_roles_unificados_y_auditoria.sql

-- puede_informar_salida como la dejó 20260908050000 (sin traer el resto del archivo).
create or replace function public.puede_informar_salida(p_salida_id uuid, p_territory_id uuid)
returns boolean language sql stable security definer set search_path = public, pg_temp set row_security = off as $$
  select public.puede_informar_salidas(auth.uid()) and exists (
    select 1 from public.salidas salida where salida.id = p_salida_id and salida.territory_id = p_territory_id)
$$;

-- Estado de los miembros: el roles-unificados ya normalizó datos viejos.
insert into public.grupo_miembros (id, group_id, profile_id, rol_en_grupo, estado, confirmado_at) values
  ('40000000-0000-0000-0000-000000000002', '10000000-0000-0000-0000-000000000001',
    '00000000-0000-0000-0000-000000000002', 'publicador', 'confirmado', now()),
  ('40000000-0000-0000-0000-000000000003', '10000000-0000-0000-0000-000000000001',
    '00000000-0000-0000-0000-000000000003', 'publicador', 'pendiente', null),
  ('40000000-0000-0000-0000-000000000004', '10000000-0000-0000-0000-000000000001',
    '00000000-0000-0000-0000-000000000004', 'superintendente', 'confirmado', now()),
  ('40000000-0000-0000-0000-000000000005', '10000000-0000-0000-0000-000000000002',
    '00000000-0000-0000-0000-000000000005', 'publicador', 'confirmado', now()),
  ('40000000-0000-0000-0000-000000000009', '10000000-0000-0000-0000-000000000001',
    '00000000-0000-0000-0000-000000000009', 'publicador', 'confirmado', now());

insert into public.grupo_invitaciones (group_id, codigo) values
  ('10000000-0000-0000-0000-000000000001', 'AAAAAA')
on conflict (group_id) do update set codigo = excluded.codigo;
insert into public.grupo_invitaciones (group_id, codigo) values
  ('10000000-0000-0000-0000-000000000002', 'BBBBBB')
on conflict (group_id) do update set codigo = excluded.codigo;

-- Admin territorios: lo nombra el superadmin, como en la app.
set role authenticated;
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000001', false);
select public.administrar_nivel_sistema('00000000-0000-0000-0000-000000000006', 'admin_territorios', 'fixture');
reset role;

insert into public.territorio_manzanas (id, territory_id) values
  ('30000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000001'),
  ('30000000-0000-0000-0000-000000000003', '20000000-0000-0000-0000-000000000003');
insert into public.manzana_lados (id, manzana_id, territory_id) values
  ('31000000-0000-0000-0000-000000000001', '30000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000001'),
  ('31000000-0000-0000-0000-000000000003', '30000000-0000-0000-0000-000000000003', '20000000-0000-0000-0000-000000000003');

-- Las pruebas leen estas tablas como authenticated (sin RLS en el fixture).
grant select on public.territorio_personal_reservas, public.cobertura_eventos to authenticated;

select 'fixture listo' as resultado;
