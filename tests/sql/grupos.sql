-- Fixture disposable: pertenencia a grupo, código, punto y reservas.
-- No conecta a Supabase ni representa cuentas remotas.

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
  group_number integer,
  driver_id uuid,
  manager_role text not null default 'siervo'
);

create table public.puntos_encuentro (
  id uuid primary key default gen_random_uuid(),
  nombre text not null,
  barrio text,
  lat numeric,
  lng numeric,
  maps_url text,
  territory_id uuid references public.territorios(id) on delete set null,
  activo boolean not null default true,
  codigo text,
  tipo text not null default 'territorial',
  origen text not null default 'app',
  group_id uuid references public.grupos_servicio(id) on delete set null,
  gps_origen text
);

create table public.grupo_miembros (
  id uuid primary key default gen_random_uuid(),
  group_id uuid not null references public.grupos_servicio(id) on delete cascade,
  profile_id uuid not null references public.profiles(id) on delete cascade,
  rol_en_grupo text not null default 'publicador'
    check (rol_en_grupo in ('publicador', 'conductor', 'auxiliar', 'superintendente')),
  estado text not null default 'pendiente'
    check (estado in ('pendiente', 'confirmado', 'retirado')),
  desde date not null default current_date,
  hasta date,
  confirmado_por uuid references public.profiles(id),
  confirmado_at timestamptz,
  created_at timestamptz not null default now()
);

create unique index grupo_miembros_vigente_idx
  on public.grupo_miembros (profile_id)
  where hasta is null;

create table public.grupo_invitaciones (
  group_id uuid primary key references public.grupos_servicio(id) on delete cascade,
  codigo text not null unique,
  activo boolean not null default true,
  renovado_por uuid references public.profiles(id),
  renovado_at timestamptz not null default now()
);

create table public.territorio_personal_reservas (
  id uuid primary key default gen_random_uuid(),
  territory_id uuid not null references public.territorios(id) on delete cascade,
  reserved_for text not null,
  status text not null default 'solicitada'
    check (status in ('solicitada', 'activa', 'rechazada', 'liberada')),
  reserved_at timestamptz,
  released_at timestamptz,
  requested_by uuid references public.profiles(id),
  requested_at timestamptz,
  assigned_to uuid references public.profiles(id),
  decided_by uuid references public.profiles(id),
  decided_at timestamptz,
  created_by uuid references public.profiles(id),
  nota text
);

create table public.reserva_movimientos (
  id uuid primary key default gen_random_uuid(),
  reserva_id uuid not null references public.territorio_personal_reservas(id) on delete restrict,
  estado_anterior text,
  estado_nuevo text not null,
  actor_id uuid not null references public.profiles(id),
  assigned_to uuid references public.profiles(id),
  nota text,
  created_at timestamptz not null default now()
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

create or replace function public.territorio_es_mio(p_territory_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select public.es_usuario_activo() and exists (
    select 1 from public.territorio_personal_reservas
    where territory_id = p_territory_id and status = 'activa' and assigned_to = auth.uid()
  )
$$;

create or replace function public.es_super_del_grupo(p_group_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select public.es_usuario_activo() and (
    public.is_admin(auth.uid())
    or exists (
      select 1
      from public.grupo_miembros m
      where m.group_id = p_group_id
        and m.profile_id = auth.uid()
        and m.hasta is null
        and m.estado = 'confirmado'
        and m.rol_en_grupo in ('superintendente', 'auxiliar')
    )
  );
$$;

create or replace function public.grupo_vigente_de(p_profile_id uuid)
returns uuid
language sql
stable
security definer
set search_path = public
as $$
  select m.group_id
  from public.grupo_miembros m
  where m.profile_id = p_profile_id
    and m.hasta is null
    and m.estado in ('pendiente', 'confirmado')
  limit 1;
$$;

create or replace function public.unirme_a_grupo(p_codigo text)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_group uuid;
  v_id uuid;
  v_status text;
begin
  if auth.uid() is null then
    raise exception 'Tenés que entrar a tu cuenta' using errcode = '42501';
  end if;

  select access_status into v_status from public.profiles where id = auth.uid();
  if not found then
    raise exception 'Tu perfil todavía no está listo' using errcode = '42501';
  end if;
  if v_status = 'inactive' then
    raise exception 'Tu cuenta está inactiva' using errcode = '42501';
  end if;

  select i.group_id into v_group
  from public.grupo_invitaciones i
  where i.activo and i.codigo = upper(btrim(coalesce(p_codigo, '')));
  if v_group is null then
    raise exception 'Ese código no es de ningún grupo. Fijate si lo copiaste bien.' using errcode = '22023';
  end if;

  update public.grupo_miembros
  set hasta = current_date
  where profile_id = auth.uid() and hasta is null;

  insert into public.grupo_miembros (group_id, profile_id, rol_en_grupo, estado)
  values (v_group, auth.uid(), 'publicador', 'pendiente')
  returning id into v_id;

  if v_status = 'pending' then
    update public.profiles
    set access_status = 'active', role = 'viewer'
    where id = auth.uid();
    delete from public.user_module_access where user_id = auth.uid();
  end if;

  return v_group;
end;
$$;

create or replace function public.confirmar_miembro(p_miembro_id uuid, p_accion text, p_rol text default null)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_fila public.grupo_miembros%rowtype;
begin
  if p_accion is null or p_accion not in ('confirmar', 'rechazar', 'cambiar_rol') then
    raise exception 'Acción inválida' using errcode = '22023';
  end if;
  select * into v_fila from public.grupo_miembros where id = p_miembro_id for update;
  if not found then
    raise exception 'Ese hermano no está en la lista' using errcode = '22023';
  end if;
  if not public.es_super_del_grupo(v_fila.group_id) then
    raise exception 'No tenés permiso para decidir este grupo' using errcode = '42501';
  end if;

  if p_accion = 'confirmar' then
    if v_fila.hasta is not null then
      raise exception 'Esa persona ya no está en el grupo' using errcode = '40001';
    end if;
    update public.grupo_miembros
    set estado = 'confirmado', confirmado_por = auth.uid(), confirmado_at = now()
    where id = v_fila.id;
  elsif p_accion = 'rechazar' then
    update public.grupo_miembros
    set estado = 'retirado', hasta = current_date, confirmado_por = auth.uid(), confirmado_at = now()
    where id = v_fila.id;
  else
    if not public.is_admin(auth.uid()) and coalesce(p_rol, '') not in ('publicador', 'conductor') then
      raise exception 'Solo un administrador puede dar ese rol' using errcode = '42501';
    end if;
    if p_rol is null or p_rol not in ('publicador', 'conductor', 'auxiliar', 'superintendente') then
      raise exception 'Rol inválido' using errcode = '22023';
    end if;
    update public.grupo_miembros
    set rol_en_grupo = p_rol
    where id = v_fila.id;
  end if;
  return v_fila.id;
end;
$$;

create or replace function public.definir_punto_de_grupo(
  p_group_id uuid,
  p_nombre text,
  p_lat numeric default null,
  p_lng numeric default null,
  p_maps_url text default null
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_id uuid;
begin
  if not public.es_super_del_grupo(p_group_id) then
    raise exception 'No tenés permiso para marcar el punto de este grupo' using errcode = '42501';
  end if;
  if length(btrim(coalesce(p_nombre, ''))) < 2 then
    raise exception 'Escribí dónde se junta el grupo' using errcode = '22023';
  end if;

  update public.puntos_encuentro
  set activo = false
  where group_id = p_group_id and tipo = 'grupo' and activo;

  insert into public.puntos_encuentro (
    nombre, lat, lng, maps_url, tipo, group_id, origen, activo, gps_origen
  )
  values (
    btrim(p_nombre),
    p_lat,
    p_lng,
    nullif(btrim(coalesce(p_maps_url, '')), ''),
    'grupo',
    p_group_id,
    'app',
    true,
    case when p_lat is not null and p_lng is not null then 'manual' else null end
  )
  returning id into v_id;
  return v_id;
end;
$$;

create or replace function public.gestionar_reserva(
  p_reserva_id uuid,
  p_accion text,
  p_assigned_to uuid default null,
  p_nota text default null
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  r public.territorio_personal_reservas%rowtype;
  v_territory uuid;
  v_assigned uuid;
  v_nombre text;
  v_estado text;
  v_grupo uuid;
  v_puede boolean;
begin
  if not public.es_usuario_activo() then
    raise exception 'Tu cuenta no tiene acceso activo' using errcode = '42501';
  end if;
  select territory_id into v_territory from public.territorio_personal_reservas where id = p_reserva_id;
  if not found then
    raise exception 'La reserva no existe' using errcode = '22023';
  end if;
  perform 1 from public.territorios where id = v_territory for update;
  select * into r from public.territorio_personal_reservas where id = p_reserva_id for update;
  if p_accion is null or p_accion not in ('aprobar', 'rechazar', 'devolver', 'vincular') then
    raise exception 'Acción inválida' using errcode = '22023';
  end if;

  v_grupo := public.grupo_vigente_de(coalesce(r.requested_by, r.assigned_to));
  v_puede := public.is_admin(auth.uid())
    or (p_accion = 'devolver' and coalesce(r.assigned_to = auth.uid(), false))
    or (
      p_accion in ('aprobar', 'rechazar', 'vincular')
      and v_grupo is not null
      and public.es_super_del_grupo(v_grupo)
    );
  if not v_puede then
    raise exception 'No tenés permiso para decidir esta reserva' using errcode = '42501';
  end if;

  if p_accion in ('aprobar', 'vincular') and not public.is_admin(auth.uid()) then
    if exists (
      select 1 from public.grupo_miembros m
      where m.profile_id = coalesce(p_assigned_to, r.requested_by)
        and m.group_id = v_grupo
        and m.hasta is null
        and m.estado = 'pendiente'
    ) then
      raise exception 'Primero confirmalo en el grupo' using errcode = '42501';
    end if;
  end if;

  if length(coalesce(p_nota, '')) > 2000 then
    raise exception 'La nota es demasiado larga' using errcode = '22023';
  end if;
  v_assigned := r.assigned_to;
  if p_accion in ('aprobar', 'vincular') then
    v_assigned := coalesce(p_assigned_to, r.requested_by);
    select full_name into v_nombre from public.profiles where id = v_assigned and access_status = 'active';
    if not found then
      raise exception 'Elegí una persona con cuenta activa' using errcode = '22023';
    end if;
    if r.status = 'activa' and r.assigned_to = v_assigned then return r.id; end if;
    if not (
      (p_accion = 'aprobar' and r.status = 'solicitada')
      or (p_accion = 'vincular' and r.status = 'activa' and r.assigned_to is null)
    ) then
      raise exception 'La reserva cambió. Actualizá antes de decidir' using errcode = '40001';
    end if;
    if exists (
      select 1 from public.territorio_personal_reservas
      where territory_id = r.territory_id and status = 'activa' and id <> r.id
    ) then
      raise exception 'El territorio ya tiene una reserva activa' using errcode = '23505';
    end if;
    v_estado := 'activa';
  elsif p_accion = 'rechazar' then
    if r.status = 'rechazada' then return r.id; end if;
    if r.status <> 'solicitada' then
      raise exception 'Solo se puede rechazar un pedido pendiente' using errcode = '40001';
    end if;
    if length(btrim(coalesce(p_nota, ''))) < 2 then
      raise exception 'Escribí el motivo del rechazo' using errcode = '22023';
    end if;
    v_estado := 'rechazada';
  else
    if r.status = 'liberada' then return r.id; end if;
    if r.status <> 'activa' then
      raise exception 'Solo se puede devolver un territorio asignado' using errcode = '40001';
    end if;
    v_estado := 'liberada';
  end if;

  update public.territorio_personal_reservas
  set status = v_estado,
      assigned_to = v_assigned,
      reserved_at = case when p_accion = 'aprobar' then now() else reserved_at end,
      released_at = case when v_estado = 'liberada' then now() else released_at end,
      decided_by = case when p_accion in ('aprobar', 'rechazar', 'vincular') then auth.uid() else decided_by end,
      decided_at = case when p_accion in ('aprobar', 'rechazar', 'vincular') then now() else decided_at end,
      nota = coalesce(nullif(btrim(p_nota), ''), nota)
  where id = r.id;
  insert into public.reserva_movimientos (reserva_id, estado_anterior, estado_nuevo, actor_id, assigned_to, nota)
  values (r.id, r.status, v_estado, auth.uid(), v_assigned, nullif(btrim(p_nota), ''));
  return r.id;
end;
$$;

grant select on public.profiles, public.grupo_miembros, public.grupo_invitaciones,
  public.territorio_personal_reservas, public.puntos_encuentro to authenticated;

grant execute on function public.unirme_a_grupo(text) to authenticated;
grant execute on function public.confirmar_miembro(uuid, text, text) to authenticated;
grant execute on function public.definir_punto_de_grupo(uuid, text, numeric, numeric, text) to authenticated;
grant execute on function public.gestionar_reserva(uuid, text, uuid, text) to authenticated;

insert into public.profiles (id, full_name, role, access_status) values
  ('00000000-0000-0000-0000-00000000000a', 'Super A', 'superintendente', 'active'),
  ('00000000-0000-0000-0000-00000000000b', 'Super B', 'superintendente', 'active'),
  ('00000000-0000-0000-0000-00000000000c', 'Publicador C', 'viewer', 'active'),
  ('00000000-0000-0000-0000-00000000000d', 'Inactivo D', 'viewer', 'inactive'),
  ('00000000-0000-0000-0000-00000000000e', 'Pendiente E', 'viewer', 'pending'),
  ('00000000-0000-0000-0000-00000000000f', 'Confirmado F', 'viewer', 'active');

insert into public.grupos_servicio (id, group_name, group_number, manager_role) values
  ('10000000-0000-0000-0000-00000000000a', 'Grupo A', 1, 'siervo'),
  ('10000000-0000-0000-0000-00000000000b', 'Grupo B', 2, 'siervo');

insert into public.grupo_miembros (id, group_id, profile_id, rol_en_grupo, estado) values
  ('40000000-0000-0000-0000-00000000000a', '10000000-0000-0000-0000-00000000000a', '00000000-0000-0000-0000-00000000000a', 'superintendente', 'confirmado'),
  ('40000000-0000-0000-0000-00000000000b', '10000000-0000-0000-0000-00000000000b', '00000000-0000-0000-0000-00000000000b', 'superintendente', 'confirmado'),
  ('40000000-0000-0000-0000-00000000000c', '10000000-0000-0000-0000-00000000000a', '00000000-0000-0000-0000-00000000000c', 'publicador', 'pendiente'),
  ('40000000-0000-0000-0000-00000000000f', '10000000-0000-0000-0000-00000000000a', '00000000-0000-0000-0000-00000000000f', 'publicador', 'confirmado');

insert into public.grupo_invitaciones (group_id, codigo, activo) values
  ('10000000-0000-0000-0000-00000000000a', 'ABCDEF', true),
  ('10000000-0000-0000-0000-00000000000b', 'XXXXXX', false);

insert into public.territorios (id, name) values
  ('20000000-0000-0000-0000-000000000001', '61');

insert into public.territorio_personal_reservas (
  id, territory_id, reserved_for, status, requested_by, requested_at, created_by
) values (
  '30000000-0000-0000-0000-000000000001',
  '20000000-0000-0000-0000-000000000001',
  'Confirmado F',
  'solicitada',
  '00000000-0000-0000-0000-00000000000f',
  now(),
  '00000000-0000-0000-0000-00000000000f'
);

insert into public.puntos_encuentro (nombre, tipo, group_id, activo)
values ('Esquina vieja A', 'grupo', '10000000-0000-0000-0000-00000000000a', true);

set role authenticated;

-- Código inválido / inactivo
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-00000000000e', false);
do $$
begin
  begin
    perform public.unirme_a_grupo('ZZZZZZ');
    raise exception 'código inválido no falló';
  exception
    when sqlstate '22023' then null;
  end;
  begin
    perform public.unirme_a_grupo('XXXXXX');
    raise exception 'código inactivo no falló';
  exception
    when sqlstate '22023' then null;
  end;
end $$;

-- Código válido activa al pendiente y lo deja esperando confirmación
select public.unirme_a_grupo('ABCDEF');
do $$
declare
  v_estado text;
  v_status text;
begin
  select estado into v_estado
  from public.grupo_miembros
  where profile_id = '00000000-0000-0000-0000-00000000000e' and hasta is null;
  select access_status into v_status
  from public.profiles
  where id = '00000000-0000-0000-0000-00000000000e';
  if v_estado <> 'pendiente' then raise exception 'el invitado no quedó pendiente'; end if;
  if v_status <> 'active' then raise exception 'el código no activó la cuenta'; end if;
end $$;

-- Super de otro grupo no confirma
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-00000000000b', false);
do $$
begin
  begin
    perform public.confirmar_miembro('40000000-0000-0000-0000-00000000000c', 'confirmar');
    raise exception 'super ajeno confirmó';
  exception
    when insufficient_privilege then null;
  end;
end $$;

-- Super del mismo grupo sí
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-00000000000a', false);
select public.confirmar_miembro('40000000-0000-0000-0000-00000000000c', 'confirmar');
do $$
begin
  if (select estado from public.grupo_miembros where id = '40000000-0000-0000-0000-00000000000c') <> 'confirmado' then
    raise exception 'el super del grupo no confirmó';
  end if;
end $$;

-- Super ajeno no aprueba la reserva
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-00000000000b', false);
do $$
begin
  begin
    perform public.gestionar_reserva('30000000-0000-0000-0000-000000000001', 'aprobar');
    raise exception 'super ajeno aprobó reserva';
  exception
    when insufficient_privilege then null;
  end;
end $$;

-- Super del grupo del solicitante sí
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-00000000000a', false);
select public.gestionar_reserva('30000000-0000-0000-0000-000000000001', 'aprobar');
do $$
begin
  if (select status from public.territorio_personal_reservas where id = '30000000-0000-0000-0000-000000000001') <> 'activa' then
    raise exception 'el super del grupo no aprobó la reserva';
  end if;
end $$;

-- Definir punto desactiva el anterior
select public.definir_punto_de_grupo(
  '10000000-0000-0000-0000-00000000000a',
  'Plaza nueva A',
  -31.5375,
  -68.5364
);
do $$
begin
  if (select count(*) from public.puntos_encuentro
      where group_id = '10000000-0000-0000-0000-00000000000a' and tipo = 'grupo' and activo) <> 1 then
    raise exception 'quedó más de un punto activo';
  end if;
  if (select activo from public.puntos_encuentro where nombre = 'Esquina vieja A') then
    raise exception 'el punto anterior sigue activo';
  end if;
  if (select nombre from public.puntos_encuentro
      where group_id = '10000000-0000-0000-0000-00000000000a' and tipo = 'grupo' and activo) <> 'Plaza nueva A' then
    raise exception 'no quedó el punto nuevo';
  end if;
end $$;

reset role;
select 'PASS: unirme, confirmar, reserva del grupo y punto reemplazan el anterior' as resultado;
