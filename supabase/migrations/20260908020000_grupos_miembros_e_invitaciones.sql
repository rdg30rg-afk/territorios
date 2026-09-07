-- Miembros de grupo, código para entrar, punto del grupo y contexto del hermano.
-- Producción no se toca. Idempotente.

begin;

-- ---------------------------------------------------------------------
-- 1. Punto de encuentro de grupo
-- ---------------------------------------------------------------------

alter table public.puntos_encuentro
  add column if not exists group_id uuid references public.grupos_servicio (id) on delete set null;

alter table public.puntos_encuentro
  drop constraint if exists puntos_encuentro_tipo_check;
alter table public.puntos_encuentro
  add constraint puntos_encuentro_tipo_check
  check (tipo in ('territorial', 'especial', 'grupo'));

create unique index if not exists puntos_encuentro_grupo_activo_idx
  on public.puntos_encuentro (group_id)
  where tipo = 'grupo' and activo and group_id is not null;

-- ---------------------------------------------------------------------
-- 2. Quién es de qué grupo
-- ---------------------------------------------------------------------

create table if not exists public.grupo_miembros (
  id uuid primary key default gen_random_uuid(),
  group_id uuid not null references public.grupos_servicio (id) on delete cascade,
  profile_id uuid not null references public.profiles (id) on delete cascade,
  rol_en_grupo text not null default 'publicador'
    check (rol_en_grupo in ('publicador', 'conductor', 'auxiliar', 'superintendente')),
  estado text not null default 'pendiente'
    check (estado in ('pendiente', 'confirmado', 'retirado')),
  desde date not null default current_date,
  hasta date,
  confirmado_por uuid references public.profiles (id),
  confirmado_at timestamptz,
  created_at timestamptz not null default now()
);

create unique index if not exists grupo_miembros_vigente_idx
  on public.grupo_miembros (profile_id)
  where hasta is null;

create index if not exists grupo_miembros_grupo_idx
  on public.grupo_miembros (group_id)
  where hasta is null;

alter table public.grupo_miembros enable row level security;
revoke all on public.grupo_miembros from anon, public;
grant select on public.grupo_miembros to authenticated;

-- ---------------------------------------------------------------------
-- 3. Código para sumarse
-- ---------------------------------------------------------------------

create table if not exists public.grupo_invitaciones (
  group_id uuid primary key references public.grupos_servicio (id) on delete cascade,
  codigo text not null unique,
  activo boolean not null default true,
  renovado_por uuid references public.profiles (id),
  renovado_at timestamptz not null default now()
);

alter table public.grupo_invitaciones enable row level security;
revoke all on public.grupo_invitaciones from anon, public;
grant select on public.grupo_invitaciones to authenticated;

create or replace function public.generar_codigo_grupo()
returns text
language plpgsql
as $$
declare
  v_abc text := 'ABCDEFGHJKLMNPQRSTUVWXYZ';
  v_codigo text;
  v_i int;
begin
  loop
    v_codigo := '';
    for v_i in 1..6 loop
      v_codigo := v_codigo || substr(v_abc, 1 + floor(random() * length(v_abc))::int, 1);
    end loop;
    exit when not exists (select 1 from public.grupo_invitaciones where codigo = v_codigo);
  end loop;
  return v_codigo;
end;
$$;

-- ---------------------------------------------------------------------
-- 4. Helpers de permiso
-- ---------------------------------------------------------------------

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

-- ---------------------------------------------------------------------
-- 5. RLS
-- ---------------------------------------------------------------------

drop policy if exists "Leer miembros de grupo" on public.grupo_miembros;
create policy "Leer miembros de grupo" on public.grupo_miembros
  for select to authenticated
  using (
    public.es_usuario_activo()
    and (
      public.is_admin(auth.uid())
      or profile_id = auth.uid()
      or public.es_super_del_grupo(group_id)
    )
  );

drop policy if exists "Leer codigo de grupo" on public.grupo_invitaciones;
create policy "Leer codigo de grupo" on public.grupo_invitaciones
  for select to authenticated
  using (public.es_super_del_grupo(group_id));

-- ---------------------------------------------------------------------
-- 6. Sembrar encargados y códigos
-- ---------------------------------------------------------------------

insert into public.grupo_miembros (group_id, profile_id, rol_en_grupo, estado, confirmado_at)
select distinct on (p.id)
  g.id,
  p.id,
  case g.manager_role
    when 'auxiliar' then 'auxiliar'
    else 'superintendente'
  end,
  'confirmado',
  now()
from public.grupos_servicio g
join public.profiles p
  on p.driver_id = g.driver_id
 and p.role <> 'admin'
 and p.driver_id is not null
where g.driver_id is not null
  and not exists (
    select 1 from public.grupo_miembros m
    where m.profile_id = p.id and m.hasta is null
  )
order by p.id, g.group_number nulls last, g.created_at;

insert into public.grupo_invitaciones (group_id, codigo)
select g.id, public.generar_codigo_grupo()
from public.grupos_servicio g
where not exists (
  select 1 from public.grupo_invitaciones i where i.group_id = g.id
);

-- ---------------------------------------------------------------------
-- 7. Tipo de las salidas SG / SR / SS
-- ---------------------------------------------------------------------

update public.salidas
set tipo = 'grupos'
where tipo is null and upper(btrim(coalesce(territorio_codigo, ''))) = 'SG';

update public.salidas
set tipo = 'especial'
where tipo is null and upper(btrim(coalesce(territorio_codigo, ''))) in ('SR', 'SS', 'ZO');

update public.salidas
set tipo = 'asamblea'
where tipo is null and upper(btrim(coalesce(territorio_codigo, ''))) in ('AC', 'AR');

update public.salidas
set tipo = 'telefonica'
where tipo is null and upper(btrim(coalesce(territorio_codigo, ''))) = 'TEL';

create or replace function public.salidas_tipo_desde_codigo()
returns trigger
language plpgsql
as $$
declare
  v_codigo text;
  v_tipo text;
begin
  if new.tipo is not null then
    return new;
  end if;
  v_codigo := upper(btrim(coalesce(new.territorio_codigo, '')));
  if v_codigo = 'SG' then new.tipo := 'grupos';
  elsif v_codigo = 'TEL' then new.tipo := 'telefonica';
  elsif v_codigo in ('AC', 'AR') then new.tipo := 'asamblea';
  elsif v_codigo in ('SR', 'SS', 'ZO') then new.tipo := 'especial';
  end if;
  if new.tipo is null and new.meeting_point_id is not null then
    select
      case
        when p.tipo = 'grupo' or upper(coalesce(p.codigo, '')) = 'SG' then 'grupos'
        when upper(coalesce(p.codigo, '')) = 'TEL' then 'telefonica'
        when upper(coalesce(p.codigo, '')) in ('AC', 'AR') then 'asamblea'
        when p.tipo = 'especial' then 'especial'
        else null
      end
    into v_tipo
    from public.puntos_encuentro p
    where p.id = new.meeting_point_id;
    new.tipo := v_tipo;
  end if;
  return new;
end;
$$;

drop trigger if exists salidas_tipo_desde_codigo on public.salidas;
create trigger salidas_tipo_desde_codigo
  before insert or update of territorio_codigo, meeting_point_id, tipo
  on public.salidas
  for each row
  execute function public.salidas_tipo_desde_codigo();

-- ---------------------------------------------------------------------
-- 8. Vista mi_contexto
-- ---------------------------------------------------------------------

create or replace view public.mi_contexto
with (security_invoker = true)
as
select
  p.id as profile_id,
  p.role,
  p.access_status,
  p.driver_id,
  p.full_name,
  m.group_id,
  g.group_number,
  g.group_name,
  m.rol_en_grupo,
  m.estado as miembro_estado,
  pe.id as punto_grupo_id,
  pe.nombre as punto_grupo_nombre,
  pe.lat as punto_grupo_lat,
  pe.lng as punto_grupo_lng,
  (
    m.estado = 'confirmado'
    and m.rol_en_grupo in ('superintendente', 'auxiliar')
  ) as es_super_de_grupo
from public.profiles p
left join public.grupo_miembros m
  on m.profile_id = p.id
 and m.hasta is null
 and m.estado in ('pendiente', 'confirmado')
left join public.grupos_servicio g on g.id = m.group_id
left join public.puntos_encuentro pe
  on pe.group_id = m.group_id
 and pe.tipo = 'grupo'
 and pe.activo
where p.id = auth.uid();

grant select on public.mi_contexto to authenticated;

-- ---------------------------------------------------------------------
-- 9. RPCs
-- ---------------------------------------------------------------------

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

create or replace function public.salir_de_mi_grupo()
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is null then
    raise exception 'Tenés que entrar a tu cuenta' using errcode = '42501';
  end if;
  update public.grupo_miembros
  set hasta = current_date
  where profile_id = auth.uid() and hasta is null;
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

create or replace function public.renovar_codigo_grupo(p_group_id uuid)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_codigo text;
begin
  if not public.es_super_del_grupo(p_group_id) then
    raise exception 'No tenés permiso para cambiar el código' using errcode = '42501';
  end if;
  v_codigo := public.generar_codigo_grupo();
  insert into public.grupo_invitaciones (group_id, codigo, renovado_por, renovado_at)
  values (p_group_id, v_codigo, auth.uid(), now())
  on conflict (group_id) do update
    set codigo = excluded.codigo,
        renovado_por = excluded.renovado_por,
        renovado_at = excluded.renovado_at,
        activo = true;
  return v_codigo;
end;
$$;

-- Pedir territorio: no si el miembro está pendiente.
create or replace function public.solicitar_territorio(p_territory_id uuid)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_id uuid;
  v_nombre text;
  v_estado text;
begin
  if not public.es_usuario_activo() then
    raise exception 'Tu cuenta no tiene acceso activo' using errcode = '42501';
  end if;
  select estado into v_estado
  from public.grupo_miembros
  where profile_id = auth.uid() and hasta is null;
  if v_estado = 'pendiente' then
    raise exception 'Cuando te confirmen en el grupo vas a poder pedirlo' using errcode = '42501';
  end if;
  perform 1 from public.territorios where id = p_territory_id for update;
  if not found then
    raise exception 'El territorio no existe' using errcode = '22023';
  end if;
  select id into v_id
  from public.territorio_personal_reservas
  where territory_id = p_territory_id and requested_by = auth.uid() and status = 'solicitada';
  if v_id is not null then return v_id; end if;
  if public.territorio_es_mio(p_territory_id) then
    raise exception 'Ya tenés este territorio asignado' using errcode = '22023';
  end if;
  select coalesce(nullif(btrim(full_name), ''), 'Sin nombre') into v_nombre
  from public.profiles where id = auth.uid();
  insert into public.territorio_personal_reservas (
    territory_id, reserved_for, status, requested_by, requested_at, created_by
  )
  values (p_territory_id, v_nombre, 'solicitada', auth.uid(), now(), auth.uid())
  returning id into v_id;
  insert into public.reserva_movimientos (reserva_id, estado_nuevo, actor_id)
  values (v_id, 'solicitada', auth.uid());
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

create or replace function public.asignar_territorio(
  p_territory_id uuid,
  p_assigned_to uuid,
  p_nota text default null
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_id uuid;
  v_nombre text;
  v_grupo uuid;
begin
  v_grupo := public.grupo_vigente_de(p_assigned_to);
  if not public.is_admin(auth.uid()) and not (
    v_grupo is not null and public.es_super_del_grupo(v_grupo)
  ) then
    raise exception 'Solo un admin o el superintendente de su grupo puede asignar' using errcode = '42501';
  end if;
  if not public.is_admin(auth.uid()) then
    if exists (
      select 1 from public.grupo_miembros
      where profile_id = p_assigned_to and group_id = v_grupo and hasta is null and estado = 'pendiente'
    ) then
      raise exception 'Primero confirmalo en el grupo' using errcode = '42501';
    end if;
  end if;
  if length(coalesce(p_nota, '')) > 2000 then
    raise exception 'La nota es demasiado larga' using errcode = '22023';
  end if;
  perform 1 from public.territorios where id = p_territory_id for update;
  if not found then
    raise exception 'El territorio no existe' using errcode = '22023';
  end if;
  select full_name into v_nombre from public.profiles where id = p_assigned_to and access_status = 'active';
  if not found then
    raise exception 'Elegí una persona con cuenta activa' using errcode = '22023';
  end if;
  select id into v_id
  from public.territorio_personal_reservas
  where territory_id = p_territory_id and status = 'activa' and assigned_to = p_assigned_to;
  if v_id is not null then return v_id; end if;
  if exists (
    select 1 from public.territorio_personal_reservas
    where territory_id = p_territory_id and status = 'activa'
  ) then
    raise exception 'El territorio ya está asignado' using errcode = '23505';
  end if;
  select id into v_id
  from public.territorio_personal_reservas
  where territory_id = p_territory_id and status = 'solicitada' and requested_by = p_assigned_to;
  if v_id is not null then
    return public.gestionar_reserva(v_id, 'aprobar', p_assigned_to, p_nota);
  end if;
  insert into public.territorio_personal_reservas (
    territory_id, reserved_for, status, assigned_to, reserved_at, decided_by, decided_at, created_by, nota
  )
  values (
    p_territory_id, coalesce(v_nombre, 'Sin nombre'), 'activa', p_assigned_to,
    now(), auth.uid(), now(), auth.uid(), nullif(btrim(p_nota), '')
  )
  returning id into v_id;
  insert into public.reserva_movimientos (reserva_id, estado_nuevo, actor_id, assigned_to, nota)
  values (v_id, 'activa', auth.uid(), p_assigned_to, nullif(btrim(p_nota), ''));
  return v_id;
end;
$$;

revoke all on function public.unirme_a_grupo(text) from public, anon;
revoke all on function public.salir_de_mi_grupo() from public, anon;
revoke all on function public.confirmar_miembro(uuid, text, text) from public, anon;
revoke all on function public.definir_punto_de_grupo(uuid, text, numeric, numeric, text) from public, anon;
revoke all on function public.renovar_codigo_grupo(uuid) from public, anon;
grant execute on function public.unirme_a_grupo(text) to authenticated;
grant execute on function public.salir_de_mi_grupo() to authenticated;
grant execute on function public.confirmar_miembro(uuid, text, text) to authenticated;
grant execute on function public.definir_punto_de_grupo(uuid, text, numeric, numeric, text) to authenticated;
grant execute on function public.renovar_codigo_grupo(uuid) to authenticated;
grant execute on function public.solicitar_territorio(uuid) to authenticated;
grant execute on function public.gestionar_reserva(uuid, text, uuid, text) to authenticated;
grant execute on function public.asignar_territorio(uuid, uuid, text) to authenticated;

notify pgrst, 'reload schema';
commit;
