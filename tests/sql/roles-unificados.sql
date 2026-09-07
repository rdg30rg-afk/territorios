\set ON_ERROR_STOP on

-- Fixture mínimo, local y descartable. La migración bajo prueba se aplica
-- mediante \ir; no se copia ni se reimplementa aquí.

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
  nombre text not null
);

create table public.profiles (
  id uuid primary key,
  full_name text not null,
  role text not null,
  access_status text not null,
  driver_id uuid
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

create table public.grupo_invitaciones (
  group_id uuid primary key references public.grupos_servicio(id) on delete cascade,
  codigo text not null unique
);

create or replace function public.generar_codigo_grupo()
returns text language sql
as $$ select upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 8)) $$;

create table public.grupo_miembros (
  id uuid primary key default gen_random_uuid(),
  group_id uuid not null references public.grupos_servicio(id) on delete cascade,
  profile_id uuid not null references public.profiles(id) on delete cascade,
  rol_en_grupo text not null default 'publicador'
    constraint grupo_miembros_rol_en_grupo_check
    check (rol_en_grupo in ('publicador', 'conductor', 'auxiliar', 'siervo', 'superintendente')),
  estado text not null default 'pendiente'
    check (estado in ('pendiente', 'confirmado', 'retirado')),
  desde date not null default current_date,
  hasta date,
  confirmado_por uuid references public.profiles(id),
  confirmado_at timestamptz,
  created_at timestamptz not null default now()
);

create unique index grupo_miembros_vigente_idx
  on public.grupo_miembros(profile_id)
  where hasta is null;

create table public.puntos_encuentro (
  id uuid primary key default gen_random_uuid(),
  nombre text not null,
  lat numeric,
  lng numeric,
  tipo text not null default 'territorial'
    check (tipo in ('territorial', 'especial', 'grupo')),
  group_id uuid references public.grupos_servicio(id) on delete set null,
  activo boolean not null default true
);

create table public.user_module_access (
  user_id uuid not null references public.profiles(id) on delete cascade,
  module_key text not null,
  primary key (user_id, module_key)
);

create table public.grupo_territorio (
  group_id uuid references public.grupos_servicio(id) on delete cascade
);

create table public.salidas (
  id uuid primary key default gen_random_uuid(),
  group_id uuid references public.grupos_servicio(id) on delete set null
);

insert into public.conductores (id, nombre) values
  ('70000000-0000-0000-0000-000000000001', 'Conductor legado');

insert into public.profiles (id, full_name, role, access_status, driver_id) values
  ('00000000-0000-0000-0000-000000000001', 'Admin único', 'admin', 'active', null),
  ('00000000-0000-0000-0000-000000000002', 'Miembro con módulos', 'viewer', 'active', null),
  ('00000000-0000-0000-0000-000000000003', 'Admin territorial objetivo', 'viewer', 'active', null),
  ('00000000-0000-0000-0000-000000000004', 'Conductor con cargo legado', 'conductor', 'active',
    '70000000-0000-0000-0000-000000000001'),
  ('00000000-0000-0000-0000-000000000005', 'Siervo Grupo A', 'siervo', 'active', null),
  ('00000000-0000-0000-0000-000000000006', 'Auxiliar Grupo A', 'viewer', 'active', null),
  ('00000000-0000-0000-0000-000000000007', 'Superintendente Grupo A', 'superintendente', 'active', null),
  ('00000000-0000-0000-0000-000000000008', 'Auxiliar Grupo B', 'viewer', 'active', null),
  ('00000000-0000-0000-0000-000000000009', 'Perfil para restricción de conductor', 'conductor', 'active', null);

insert into public.grupos_servicio (id, group_number, group_name, manager_name, manager_role) values
  ('10000000-0000-0000-0000-000000000001', 1, 'Grupo A', 'Admin único', 'superintendente'),
  ('10000000-0000-0000-0000-000000000011', 1, 'Grupo A', 'Auxiliar importado', 'auxiliar'),
  ('10000000-0000-0000-0000-000000000002', 2, 'Grupo B', 'Siervo importado', 'siervo');

insert into public.grupo_invitaciones (group_id, codigo) values
  ('10000000-0000-0000-0000-000000000001', 'GRUPOA'),
  ('10000000-0000-0000-0000-000000000011', 'AUXILIAR'),
  ('10000000-0000-0000-0000-000000000002', 'GRUPOB');

insert into public.grupo_miembros (id, group_id, profile_id, rol_en_grupo, estado) values
  ('40000000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-000000000001',
    '00000000-0000-0000-0000-000000000002', 'publicador', 'confirmado'),
  ('40000000-0000-0000-0000-000000000002', '10000000-0000-0000-0000-000000000001',
    '00000000-0000-0000-0000-000000000004', 'conductor', 'confirmado'),
  ('40000000-0000-0000-0000-000000000003', '10000000-0000-0000-0000-000000000001',
    '00000000-0000-0000-0000-000000000005', 'siervo', 'confirmado'),
  ('40000000-0000-0000-0000-000000000004', '10000000-0000-0000-0000-000000000001',
    '00000000-0000-0000-0000-000000000006', 'auxiliar', 'confirmado'),
  ('40000000-0000-0000-0000-000000000005', '10000000-0000-0000-0000-000000000001',
    '00000000-0000-0000-0000-000000000007', 'superintendente', 'confirmado'),
  ('40000000-0000-0000-0000-000000000006', '10000000-0000-0000-0000-000000000002',
    '00000000-0000-0000-0000-000000000008', 'auxiliar', 'confirmado');

insert into public.puntos_encuentro (id, nombre, tipo, group_id, activo, lat, lng) values
  ('50000000-0000-0000-0000-000000000001', 'Punto Grupo A', 'grupo',
    '10000000-0000-0000-0000-000000000001', true, -31.5375, -68.5364);

insert into public.user_module_access (user_id, module_key)
values ('00000000-0000-0000-0000-000000000002', 'mapas');

-- Política previa realista: la política invoca el helper histórico que la
-- migración reemplaza. El helper provisional solo permite crear la política;
-- las consultas se ejecutan después de aplicar la función real.
create or replace function public.es_super_del_grupo(p_group_id uuid)
returns boolean
language sql
stable
as $$ select false $$;

create or replace function public.es_usuario_activo()
returns boolean
language sql
stable
as $$
  select exists (
    select 1 from public.profiles
    where id = auth.uid() and access_status = 'active'
  )
$$;

create or replace function public.is_admin(user_id uuid)
returns boolean
language sql
stable
as $$
  select exists (
    select 1 from public.profiles
    where id = user_id and role = 'admin' and access_status = 'active'
  )
$$;

alter table public.profiles enable row level security;
alter table public.grupo_miembros enable row level security;
alter table public.puntos_encuentro enable row level security;

create policy "Perfil propio" on public.profiles
  for select to authenticated
  using (id = auth.uid());

create policy "Leer miembros de grupo" on public.grupo_miembros
  for select to authenticated
  using (
    profile_id = auth.uid()
    or public.es_super_del_grupo(group_id)
  );

create policy "Leer puntos visibles" on public.puntos_encuentro
  for select to authenticated
  using (true);

grant select on public.profiles, public.grupos_servicio, public.grupo_miembros,
  public.puntos_encuentro, public.user_module_access to authenticated;

create or replace function public.assert_true(p_condition boolean, p_message text)
returns void
language plpgsql
as $$
begin
  if coalesce(p_condition, false) is not true then
    raise exception '%', p_message;
  end if;
end;
$$;

-- La migración real, no una copia del fixture. La segunda ejecución comprueba
-- que sus DDL, triggers, políticas, índices y vista sean idempotentes.
\ir ../../supabase/migrations/20260908035000_normalizar_grupos_servicio.sql
\ir ../../supabase/migrations/20260908035000_normalizar_grupos_servicio.sql
\ir ../../supabase/migrations/20260908040000_roles_unificados_y_auditoria.sql
\ir ../../supabase/migrations/20260908040000_roles_unificados_y_auditoria.sql

select public.assert_true(
  (select count(*) = 2 from public.grupos_servicio)
  and (select count(*) = 2 from public.grupo_invitaciones)
  and (select count(*) = 3 from public.grupo_responsables_importados),
  'La normalización no produjo dos grupos, dos códigos y tres responsables preservados'
);

-- 1. El único admin activo legado se convierte en superadmin.
select public.assert_true(
  (select system_role = 'superadmin' from public.profiles
   where id = '00000000-0000-0000-0000-000000000001'),
  'El único administrador activo no pasó a superadmin'
);

select public.assert_true(
  exists (
    select 1 from public.grupo_miembros
    where profile_id = '00000000-0000-0000-0000-000000000001'
      and group_id = '10000000-0000-0000-0000-000000000001'
      and rol_en_grupo = 'superintendente'
      and estado = 'confirmado'
      and hasta is null
  ),
  'El responsable con coincidencia inequívoca no fue sembrado'
);

-- 2. Un miembro con ACL de módulo no puede abrir el panel administrativo.
set role authenticated;
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000002', false);
select public.assert_true(
  exists (
    select 1 from public.user_module_access
    where user_id = auth.uid() and module_key = 'mapas'
  )
  and not public.can_access_module('mapas'),
  'Un miembro con módulos todavía obtiene can_access_module'
);

-- 3. El nivel admin_territorios sí habilita módulos.
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000001', false);
select public.administrar_nivel_sistema(
  '00000000-0000-0000-0000-000000000003',
  'admin_territorios',
  'Prueba de roles unificados'
);
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000003', false);
select public.assert_true(
  (select system_role = 'admin_territorios' from public.profiles
   where id = auth.uid())
  and public.can_access_module('mapas'),
  'El admin territorial no obtiene acceso al módulo mapas'
);

-- 4. Los tres cargos son responsables de su propio grupo y no del ajeno.
select public.assert_true(
  public.es_responsable_de_grupo(
    '10000000-0000-0000-0000-000000000001',
    '00000000-0000-0000-0000-000000000005'
  )
  and public.es_responsable_de_grupo(
    '10000000-0000-0000-0000-000000000001',
    '00000000-0000-0000-0000-000000000006'
  )
  and public.es_responsable_de_grupo(
    '10000000-0000-0000-0000-000000000001',
    '00000000-0000-0000-0000-000000000007'
  )
  and not public.es_responsable_de_grupo(
    '10000000-0000-0000-0000-000000000002',
    '00000000-0000-0000-0000-000000000005'
  )
  and not public.es_responsable_de_grupo(
    '10000000-0000-0000-0000-000000000002',
    '00000000-0000-0000-0000-000000000006'
  )
  and not public.es_responsable_de_grupo(
    '10000000-0000-0000-0000-000000000002',
    '00000000-0000-0000-0000-000000000007'
  ),
  'Los cargos responsables cruzan el límite de grupo'
);

-- 5-6. Conductor deja de ser cargo; siervo queda preservado y permitido.
select public.assert_true(
  (select rol_en_grupo = 'publicador' from public.grupo_miembros
   where profile_id = '00000000-0000-0000-0000-000000000004')
  and (select rol_en_grupo = 'siervo' from public.grupo_miembros
   where profile_id = '00000000-0000-0000-0000-000000000005')
  and not exists (select 1 from public.grupo_miembros where rol_en_grupo = 'conductor'),
  'La migración no separó conductor del cargo grupal o perdió siervo'
);

set role postgres;
do $$
begin
  begin
    insert into public.grupo_miembros (id, group_id, profile_id, rol_en_grupo, estado)
    values (
      '40000000-0000-0000-0000-000000000009',
      '10000000-0000-0000-0000-000000000001',
      '00000000-0000-0000-0000-000000000009',
      'conductor',
      'confirmado'
    );
    raise exception 'El constraint todavía acepta conductor como rol grupal';
  exception
    when check_violation then null;
  end;
end
$$;
set role authenticated;

-- 7. El contexto del hermano devuelve exactamente una fila.
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000005', false);
do $$
declare
  v_count integer;
  v_group uuid;
  v_role text;
begin
  select count(*) into v_count from public.mi_contexto;
  select group_id, rol_en_grupo into v_group, v_role from public.mi_contexto;
  if v_count <> 1 then
    raise exception 'mi_contexto devolvió % filas; se esperaba exactamente una', v_count;
  end if;
  if v_group <> '10000000-0000-0000-0000-000000000001' or v_role <> 'siervo' then
    raise exception 'mi_contexto no refleja el grupo/cargo esperado: % / %', v_group, v_role;
  end if;
end
$$;

-- 8. La política RLS usa la función SECURITY DEFINER sin recursión y limita
-- al responsable al grupo correcto. Si recursa, psql conserva el error exacto.
do $$
declare
  v_propio integer;
  v_ajeno integer;
begin
  select count(*) into v_propio
  from public.grupo_miembros
  where group_id = '10000000-0000-0000-0000-000000000001';
  select count(*) into v_ajeno
  from public.grupo_miembros
  where group_id = '10000000-0000-0000-0000-000000000002';
  if v_propio <> 6 or v_ajeno <> 0 then
    raise exception 'RLS de grupo devolvió propio=% ajeno=%; se esperaba propio=6 ajeno=0',
      v_propio, v_ajeno;
  end if;
end
$$;

-- 9. Auditoría de acceso: la RPC conserva actor, antes/después y motivo.
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000001', false);
select public.assert_true(
  (select count(*) = 1 from public.acceso_movimientos
   where profile_id = '00000000-0000-0000-0000-000000000003'
     and actor_id = '00000000-0000-0000-0000-000000000001'
     and system_role_anterior = 'miembro'
     and system_role_nuevo = 'admin_territorios'
     and motivo = 'Prueba de roles unificados'),
  'La auditoría de cambio de nivel no registró actor, antes/después y motivo'
);

-- También se verifica el trigger de auditoría de membresía en una operación
-- hecha como owner del cluster local, con auth.uid() fijado al superadmin.
set role postgres;
update public.grupo_miembros
set rol_en_grupo = 'siervo'
where profile_id = '00000000-0000-0000-0000-000000000002';
set role authenticated;
select public.assert_true(
  (select count(*) = 1 from public.grupo_miembro_movimientos
   where profile_id = '00000000-0000-0000-0000-000000000002'
     and actor_id = '00000000-0000-0000-0000-000000000001'
     and accion = 'cambio_cargo'
     and rol_anterior = 'publicador'
     and rol_nuevo = 'siervo'),
  'La auditoría de membresía no registró el cambio de cargo'
);

-- 10. Un único superadmin activo no puede degradarse.
do $$
begin
  begin
    perform public.administrar_nivel_sistema(
      '00000000-0000-0000-0000-000000000001',
      'miembro',
      'Prueba de protección del último superadmin'
    );
    raise exception 'administrar_nivel_sistema permitió quitar el último superadmin';
  exception
    when sqlstate '23514' then
      if sqlerrm <> 'No se puede quitar el último superadmin activo' then
        raise exception 'Error de protección inesperado: %', sqlerrm;
      end if;
  end;
end
$$;

\echo PASS: roles unificados, RLS y auditoría
