-- Roles del sistema separados de cargos de grupo y capacidades operativas.
-- Aditiva, idempotente y transaccional. Producción no se toca.

begin;

-- ---------------------------------------------------------------------
-- 1. Nivel del sistema
-- ---------------------------------------------------------------------

alter table public.profiles
  add column if not exists system_role text;

update public.profiles
set system_role = case
  when role = 'admin' then 'admin_territorios'
  else 'miembro'
end
where system_role is null;

-- En una instalación que ya tiene exactamente un administrador activo, ése
-- conserva el control total. Con varios admins no se adivina cuál es el
-- superadmin: la migración se detiene antes de cambiar permisos.
do $$
declare
  v_admins integer;
begin
  if not exists (select 1 from public.profiles where system_role = 'superadmin') then
    select count(*) into v_admins
    from public.profiles
    where role = 'admin' and access_status = 'active';

    if v_admins = 1 then
      update public.profiles
      set system_role = 'superadmin'
      where role = 'admin' and access_status = 'active';
    elsif v_admins > 1 then
      raise exception 'Hay % administradores activos: definí explícitamente cuál es superadmin antes de migrar', v_admins
        using errcode = '23514';
    end if;
  end if;
end;
$$;

alter table public.profiles
  alter column system_role set default 'miembro';
alter table public.profiles
  alter column system_role set not null;
alter table public.profiles
  drop constraint if exists profiles_system_role_check;
alter table public.profiles
  add constraint profiles_system_role_check
  check (system_role in ('miembro', 'admin_territorios', 'superadmin'));

create unique index if not exists profiles_driver_id_unico_idx
  on public.profiles (driver_id)
  where driver_id is not null;

-- ---------------------------------------------------------------------
-- 2. Cargos del grupo. Conductor deja de ser un cargo.
-- ---------------------------------------------------------------------

update public.grupo_miembros miembro
set rol_en_grupo = 'publicador'
where rol_en_grupo = 'conductor';

alter table public.grupo_miembros
  drop constraint if exists grupo_miembros_rol_en_grupo_check;
alter table public.grupo_miembros
  add constraint grupo_miembros_rol_en_grupo_check
  check (rol_en_grupo in ('publicador', 'auxiliar', 'siervo', 'superintendente'));

alter table public.grupo_miembros
  drop constraint if exists grupo_miembros_retiro_coherente_check;
alter table public.grupo_miembros
  add constraint grupo_miembros_retiro_coherente_check
  check (
    (estado = 'retirado' and hasta is not null)
    or (estado in ('pendiente', 'confirmado') and hasta is null)
  ) not valid;

-- Las filas históricas se normalizan antes de validar la coherencia.
update public.grupo_miembros
set hasta = coalesce(hasta, current_date)
where estado = 'retirado';
update public.grupo_miembros
set estado = 'retirado'
where hasta is not null and estado <> 'retirado';

alter table public.grupo_miembros
  validate constraint grupo_miembros_retiro_coherente_check;

-- ---------------------------------------------------------------------
-- 3. Helpers canónicos. SECURITY DEFINER evita recursión de RLS; row_security
--    queda desactivado dentro del helper propietario y nunca en la sesión.
-- ---------------------------------------------------------------------

create or replace function public.es_superadmin(p_profile_id uuid default auth.uid())
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
set row_security = off
as $$
  select exists (
    select 1 from public.profiles perfil
    where perfil.id = p_profile_id
      and perfil.access_status = 'active'
      and perfil.system_role = 'superadmin'
  );
$$;

create or replace function public.es_admin_territorios(p_profile_id uuid default auth.uid())
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
set row_security = off
as $$
  select exists (
    select 1 from public.profiles perfil
    where perfil.id = p_profile_id
      and perfil.access_status = 'active'
      and perfil.system_role in ('admin_territorios', 'superadmin')
  );
$$;

-- Nombre histórico conservado para que todas las RPC/RLS existentes adopten
-- el nuevo nivel sin una ventana de permisos inconsistentes.
create or replace function public.is_admin(user_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
set row_security = off
as $$ select public.es_admin_territorios(user_id) $$;

create or replace function public.es_responsable_de_grupo(
  p_group_id uuid,
  p_profile_id uuid default auth.uid()
)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
set row_security = off
as $$
  select public.es_admin_territorios(p_profile_id) or exists (
    select 1
    from public.profiles perfil
    join public.grupo_miembros miembro on miembro.profile_id = perfil.id
    where perfil.id = p_profile_id
      and perfil.access_status = 'active'
      and miembro.group_id = p_group_id
      and miembro.estado = 'confirmado'
      and miembro.hasta is null
      and miembro.rol_en_grupo in ('auxiliar', 'siervo', 'superintendente')
  );
$$;

create or replace function public.es_super_del_grupo(p_group_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
set row_security = off
as $$ select public.es_responsable_de_grupo(p_group_id, auth.uid()) $$;

create or replace function public.puede_informar_salidas(p_profile_id uuid default auth.uid())
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
set row_security = off
as $$
  select exists (
    select 1
    from public.profiles perfil
    where perfil.id = p_profile_id
      and perfil.access_status = 'active'
      and (
        perfil.system_role in ('admin_territorios', 'superadmin')
        or perfil.driver_id is not null
        or exists (
          select 1 from public.grupo_miembros miembro
          where miembro.profile_id = perfil.id
            and miembro.estado = 'confirmado'
            and miembro.hasta is null
            and miembro.rol_en_grupo in ('auxiliar', 'siervo', 'superintendente')
        )
      )
  );
$$;

create or replace function public.can_access_module(module_name text)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
set row_security = off
as $$
  select module_name in (
    'mapas', 'conductores', 'grupos', 'salidas',
    'salidas_grupo', 'territorio_personal'
  ) and public.es_admin_territorios(auth.uid());
$$;

revoke all on function public.es_superadmin(uuid) from public, anon;
revoke all on function public.es_admin_territorios(uuid) from public, anon;
revoke all on function public.es_responsable_de_grupo(uuid, uuid) from public, anon;
revoke all on function public.puede_informar_salidas(uuid) from public, anon;
grant execute on function public.es_superadmin(uuid) to authenticated;
grant execute on function public.es_admin_territorios(uuid) to authenticated;
grant execute on function public.es_responsable_de_grupo(uuid, uuid) to authenticated;
grant execute on function public.puede_informar_salidas(uuid) to authenticated;

-- ---------------------------------------------------------------------
-- 4. Auditoría de acceso y membresía
-- ---------------------------------------------------------------------

create table if not exists public.acceso_movimientos (
  id bigint generated always as identity primary key,
  profile_id uuid not null references public.profiles (id) on delete restrict,
  actor_id uuid references public.profiles (id) on delete set null,
  system_role_anterior text,
  system_role_nuevo text,
  access_status_anterior text,
  access_status_nuevo text,
  driver_id_anterior uuid references public.conductores (id) on delete set null,
  driver_id_nuevo uuid references public.conductores (id) on delete set null,
  motivo text,
  creado_at timestamptz not null default clock_timestamp()
);

alter table public.acceso_movimientos enable row level security;
revoke all on public.acceso_movimientos from anon, public, authenticated;
grant select on public.acceso_movimientos to authenticated;

drop policy if exists "Admins leen movimientos de acceso" on public.acceso_movimientos;
create policy "Admins leen movimientos de acceso" on public.acceso_movimientos
  for select to authenticated
  using (public.es_admin_territorios(auth.uid()));

create or replace function public.registrar_movimiento_acceso()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
set row_security = off
as $$
begin
  if old.system_role is distinct from new.system_role
    or old.access_status is distinct from new.access_status
    or old.driver_id is distinct from new.driver_id then
    insert into public.acceso_movimientos (
      profile_id, actor_id,
      system_role_anterior, system_role_nuevo,
      access_status_anterior, access_status_nuevo,
      driver_id_anterior, driver_id_nuevo
    ) values (
      new.id, auth.uid(),
      old.system_role, new.system_role,
      old.access_status, new.access_status,
      old.driver_id, new.driver_id
    );
  end if;
  return new;
end;
$$;

drop trigger if exists auditar_cambio_acceso on public.profiles;
create trigger auditar_cambio_acceso
after update of system_role, access_status, driver_id on public.profiles
for each row execute function public.registrar_movimiento_acceso();

create table if not exists public.grupo_miembro_movimientos (
  id bigint generated always as identity primary key,
  miembro_id uuid not null references public.grupo_miembros (id) on delete restrict,
  group_id uuid not null references public.grupos_servicio (id) on delete restrict,
  profile_id uuid not null references public.profiles (id) on delete restrict,
  actor_id uuid references public.profiles (id) on delete set null,
  accion text not null check (accion in ('ingreso', 'confirmacion', 'rechazo', 'cambio_cargo', 'retiro')),
  rol_anterior text,
  rol_nuevo text,
  estado_anterior text,
  estado_nuevo text,
  creado_at timestamptz not null default clock_timestamp()
);

alter table public.grupo_miembro_movimientos enable row level security;
revoke all on public.grupo_miembro_movimientos from anon, public, authenticated;
grant select on public.grupo_miembro_movimientos to authenticated;

drop policy if exists "Responsables leen movimientos de su grupo" on public.grupo_miembro_movimientos;
create policy "Responsables leen movimientos de su grupo" on public.grupo_miembro_movimientos
  for select to authenticated
  using (public.es_responsable_de_grupo(group_id, auth.uid()));

create or replace function public.registrar_movimiento_miembro_grupo()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
set row_security = off
as $$
declare
  v_accion text;
begin
  if tg_op = 'INSERT' then
    v_accion := 'ingreso';
    insert into public.grupo_miembro_movimientos (
      miembro_id, group_id, profile_id, actor_id, accion,
      rol_nuevo, estado_nuevo
    ) values (
      new.id, new.group_id, new.profile_id, auth.uid(), v_accion,
      new.rol_en_grupo, new.estado
    );
    return new;
  end if;

  if old.rol_en_grupo is distinct from new.rol_en_grupo then
    v_accion := 'cambio_cargo';
  elsif old.estado is distinct from new.estado and new.estado = 'confirmado' then
    v_accion := 'confirmacion';
  elsif old.estado is distinct from new.estado and new.estado = 'retirado' then
    v_accion := case when old.estado = 'pendiente' then 'rechazo' else 'retiro' end;
  elsif old.hasta is distinct from new.hasta and new.hasta is not null then
    v_accion := 'retiro';
  else
    return new;
  end if;

  insert into public.grupo_miembro_movimientos (
    miembro_id, group_id, profile_id, actor_id, accion,
    rol_anterior, rol_nuevo, estado_anterior, estado_nuevo
  ) values (
    new.id, new.group_id, new.profile_id, auth.uid(), v_accion,
    old.rol_en_grupo, new.rol_en_grupo, old.estado, new.estado
  );
  return new;
end;
$$;

drop trigger if exists auditar_miembro_grupo on public.grupo_miembros;
create trigger auditar_miembro_grupo
after insert or update of rol_en_grupo, estado, hasta on public.grupo_miembros
for each row execute function public.registrar_movimiento_miembro_grupo();

-- ---------------------------------------------------------------------
-- 5. Gestión del nivel administrativo
-- ---------------------------------------------------------------------

create or replace function public.administrar_nivel_sistema(
  p_user_id uuid,
  p_system_role text,
  p_motivo text default null
)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
set row_security = off
as $$
declare
  v_anterior public.profiles%rowtype;
begin
  perform pg_advisory_xact_lock(20260908, 400);

  if not public.es_superadmin(auth.uid()) then
    raise exception 'Sólo un superadmin puede administrar niveles del sistema'
      using errcode = '42501';
  end if;
  if p_system_role not in ('miembro', 'admin_territorios', 'superadmin') then
    raise exception 'Nivel del sistema inválido' using errcode = '22023';
  end if;
  if length(coalesce(p_motivo, '')) > 500 then
    raise exception 'El motivo es demasiado largo' using errcode = '22023';
  end if;

  select * into v_anterior from public.profiles where id = p_user_id for update;
  if not found then
    raise exception 'El usuario no existe' using errcode = '22023';
  end if;

  if v_anterior.system_role = 'superadmin'
    and p_system_role <> 'superadmin'
    and v_anterior.access_status = 'active'
    and not exists (
      select 1 from public.profiles
      where id <> p_user_id
        and system_role = 'superadmin'
        and access_status = 'active'
    ) then
    raise exception 'No se puede quitar el último superadmin activo'
      using errcode = '23514';
  end if;

  if v_anterior.system_role = p_system_role then
    return;
  end if;

  update public.profiles
  set system_role = p_system_role,
      role = case when p_system_role = 'miembro' then 'viewer' else 'admin' end
  where id = p_user_id;

  if p_system_role = 'miembro' then
    delete from public.user_module_access where user_id = p_user_id;
  end if;

  update public.acceso_movimientos
  set motivo = nullif(btrim(coalesce(p_motivo, '')), '')
  where id = (
    select id from public.acceso_movimientos
    where profile_id = p_user_id and actor_id = auth.uid()
    order by id desc limit 1
  );
end;
$$;

revoke all on function public.administrar_nivel_sistema(uuid, text, text) from public, anon;
grant execute on function public.administrar_nivel_sistema(uuid, text, text) to authenticated;

-- Firma histórica que usa hoy el panel. Durante la transición sigue
-- administrando estado, vínculo de conductor y el rótulo legacy, pero nunca
-- permite que un admin territorial nombre o quite administradores.
create or replace function public.administrar_acceso(
  p_user_id uuid,
  p_role text,
  p_status text,
  p_modules text[],
  p_driver_id uuid default null
)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
set row_security = off
as $$
declare
  v_anterior public.profiles%rowtype;
  v_system_role text;
begin
  perform pg_advisory_xact_lock(20260905, 100);

  if not public.es_admin_territorios(auth.uid()) then
    raise exception 'Sólo un administrador activo puede administrar accesos'
      using errcode = '42501';
  end if;
  if p_role is null or p_role not in ('admin', 'superintendente', 'siervo', 'conductor', 'viewer')
    or p_status is null or p_status not in ('active', 'pending', 'inactive') then
    raise exception 'Rol o estado de acceso inválido' using errcode = '22023';
  end if;
  if p_modules is null or exists (
    select 1 from unnest(p_modules) modulo
    where modulo is null or modulo not in (
      'mapas', 'conductores', 'grupos', 'salidas',
      'salidas_grupo', 'territorio_personal'
    )
  ) then
    raise exception 'Módulo inválido' using errcode = '22023';
  end if;
  if p_driver_id is not null
    and not exists (select 1 from public.conductores where id = p_driver_id) then
    raise exception 'El conductor vinculado no existe' using errcode = '23503';
  end if;

  select * into v_anterior from public.profiles where id = p_user_id for update;
  if not found then
    raise exception 'El usuario no existe' using errcode = '22023';
  end if;

  if not public.es_superadmin(auth.uid()) and (
    v_anterior.system_role in ('admin_territorios', 'superadmin')
    or p_role = 'admin'
  ) then
    raise exception 'Sólo un superadmin puede administrar cuentas administrativas'
      using errcode = '42501';
  end if;

  v_system_role := case
    when p_role <> 'admin' then 'miembro'
    when v_anterior.system_role = 'superadmin' then 'superadmin'
    else 'admin_territorios'
  end;

  if v_anterior.system_role = 'superadmin'
    and v_anterior.access_status = 'active'
    and (v_system_role <> 'superadmin' or p_status <> 'active')
    and not exists (
      select 1 from public.profiles
      where id <> p_user_id
        and system_role = 'superadmin'
        and access_status = 'active'
    ) then
    raise exception 'No se puede quitar el último superadmin activo'
      using errcode = '23514';
  end if;

  update public.profiles
  set role = p_role,
      system_role = v_system_role,
      access_status = p_status,
      driver_id = p_driver_id
  where id = p_user_id;

  -- Los módulos dejan de ser una autoridad paralela. Se conservan la tabla y
  -- la firma para que clientes anteriores no fallen, pero ninguna fila concede
  -- acceso al panel.
  delete from public.user_module_access where user_id = p_user_id;
end;
$$;

revoke all on function public.administrar_acceso(uuid, text, text, text[], uuid) from public, anon;
grant execute on function public.administrar_acceso(uuid, text, text, text[], uuid) to authenticated;

-- Preserva los tres cargos importados. El sembrado anterior convertía
-- silenciosamente "siervo" en "superintendente".
create or replace function public.sembrar_encargados_de_grupo()
returns integer
language plpgsql
security definer
set search_path = public, pg_temp
set row_security = off
as $$
declare
  v_insertados integer := 0;
  v_ambiguo record;
begin
  for v_ambiguo in
    select perfil.id as profile_id, perfil.driver_id,
      string_agg(grupo.group_number::text, ', ' order by grupo.group_number) as grupos
    from public.profiles perfil
    join public.grupo_responsables_importados responsable
      on (perfil.driver_id is not null and responsable.driver_id = perfil.driver_id)
      or lower(btrim(perfil.full_name)) = lower(btrim(responsable.manager_name))
    join public.grupos_servicio grupo on grupo.id = responsable.group_id
    group by perfil.id, perfil.driver_id
    having count(distinct responsable.group_id) > 1
  loop
    raise notice 'Encargado con driver_id % figura en varios grupos (%); no se crea una membresía ambigua',
      v_ambiguo.driver_id, v_ambiguo.grupos;
  end loop;

  insert into public.grupo_miembros (
    group_id, profile_id, rol_en_grupo, estado, confirmado_at
  )
  select distinct on (perfil.id)
    responsable.group_id,
    perfil.id,
    responsable.manager_role,
    'confirmado',
    now()
  from public.profiles perfil
  join public.grupo_responsables_importados responsable
    on (perfil.driver_id is not null and responsable.driver_id = perfil.driver_id)
    or lower(btrim(perfil.full_name)) = lower(btrim(responsable.manager_name))
  where responsable.manager_role in ('superintendente', 'siervo', 'auxiliar')
    and not exists (
      select 1 from public.grupo_miembros miembro
      where miembro.profile_id = perfil.id and miembro.hasta is null
    )
    and 1 = (
      select count(distinct otra.group_id)
      from public.grupo_responsables_importados otra
      where (perfil.driver_id is not null and otra.driver_id = perfil.driver_id)
         or lower(btrim(perfil.full_name)) = lower(btrim(otra.manager_name))
    )
  order by perfil.id,
    case responsable.manager_role
      when 'superintendente' then 1
      when 'siervo' then 2
      else 3
    end,
    responsable.id;

  get diagnostics v_insertados = row_count;
  return v_insertados;
end;
$$;

select public.sembrar_encargados_de_grupo();

-- La gestión de membresía conserva la firma pública, incluye al siervo y
-- reserva los cargos responsables para administradores territoriales.
create or replace function public.confirmar_miembro(
  p_miembro_id uuid,
  p_accion text,
  p_rol text default null
)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
set row_security = off
as $$
declare
  v_fila public.grupo_miembros%rowtype;
begin
  if p_accion is null or p_accion not in ('confirmar', 'rechazar', 'cambiar_rol') then
    raise exception 'Acción inválida' using errcode = '22023';
  end if;

  select * into v_fila from public.grupo_miembros
  where id = p_miembro_id for update;
  if not found then
    raise exception 'Ese hermano no está en la lista' using errcode = '22023';
  end if;
  if not public.es_responsable_de_grupo(v_fila.group_id, auth.uid()) then
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
    set estado = 'retirado', hasta = current_date,
        confirmado_por = auth.uid(), confirmado_at = now()
    where id = v_fila.id;
  else
    if not public.es_admin_territorios(auth.uid()) then
      raise exception 'Sólo un administrador puede cambiar cargos del grupo'
        using errcode = '42501';
    end if;
    if p_rol is null or p_rol not in ('publicador', 'auxiliar', 'siervo', 'superintendente') then
      raise exception 'Cargo inválido' using errcode = '22023';
    end if;
    update public.grupo_miembros set rol_en_grupo = p_rol where id = v_fila.id;
  end if;

  return v_fila.id;
end;
$$;

create or replace function public.salidas_rpc_autorizado(
  p_scope text,
  p_group_id uuid
)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
set row_security = off
as $$
  select public.es_usuario_activo() and case
    when p_scope = 'general' then public.es_admin_territorios(auth.uid())
    when p_scope = 'grupo' then p_group_id is not null
      and public.es_responsable_de_grupo(p_group_id, auth.uid())
    else false
  end;
$$;

-- ---------------------------------------------------------------------
-- 6. Contexto único para frontend
-- ---------------------------------------------------------------------

create or replace view public.mi_contexto
with (security_invoker = true)
as
select
  perfil.id as profile_id,
  perfil.role,
  perfil.access_status,
  perfil.driver_id,
  perfil.full_name,
  miembro.group_id,
  grupo.group_number,
  grupo.group_name,
  miembro.rol_en_grupo,
  miembro.estado as miembro_estado,
  punto.id as punto_grupo_id,
  punto.nombre as punto_grupo_nombre,
  punto.lat as punto_grupo_lat,
  punto.lng as punto_grupo_lng,
  (
    miembro.estado = 'confirmado'
    and miembro.hasta is null
    and miembro.rol_en_grupo in ('auxiliar', 'siervo', 'superintendente')
  ) as es_super_de_grupo,
  perfil.system_role,
  (perfil.driver_id is not null) as es_conductor,
  coalesce(
    miembro.group_id is not null
    and public.es_responsable_de_grupo(miembro.group_id, perfil.id),
    false
  ) as puede_administrar_grupo,
  public.puede_informar_salidas(perfil.id) as puede_informar_salidas,
  public.es_admin_territorios(perfil.id) as puede_abrir_panel,
  public.es_superadmin(perfil.id) as puede_administrar_admins
from public.profiles perfil
left join public.grupo_miembros miembro
  on miembro.profile_id = perfil.id
 and miembro.hasta is null
 and miembro.estado in ('pendiente', 'confirmado')
left join public.grupos_servicio grupo on grupo.id = miembro.group_id
left join public.puntos_encuentro punto
  on punto.group_id = miembro.group_id
 and punto.tipo = 'grupo'
 and punto.activo
where perfil.id = auth.uid();

grant select on public.mi_contexto to authenticated;

notify pgrst, 'reload schema';
commit;
