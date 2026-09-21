-- DEV primero. Cuenta aprobada != acceso a módulos administrativos.
-- No modifica filas históricas ni redefine migraciones anteriores.
begin;

create or replace function public.es_usuario_activo()
returns boolean language sql stable security definer set search_path = public
as $$ select exists(select 1 from public.profiles where id = auth.uid() and access_status = 'active') $$;

create or replace function public.is_admin(user_id uuid)
returns boolean language sql stable security definer set search_path = public
as $$ select exists(select 1 from public.profiles where id = user_id and role = 'admin' and access_status = 'active') $$;

create or replace function public.can_access_module(module_name text)
returns boolean language sql stable security definer set search_path = public
as $$
  select public.es_usuario_activo() and (
    public.is_admin(auth.uid()) or exists (
      select 1 from public.user_module_access where user_id = auth.uid() and module_key = module_name
    )
  )
$$;

-- Restrictiva: se combina con AND con las políticas permisivas existentes.
-- Conservar las lecturas propias de perfil/módulos permite explicar el bloqueo.
do $$ declare t record; begin
  for t in select c.relname from pg_class c join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' and c.relkind in ('r','p') and c.relrowsecurity
      and c.relname not in ('profiles','user_module_access','pending_users')
  loop
    execute format('drop policy if exists acceso_activo_obligatorio on public.%I', t.relname);
    execute format('create policy acceso_activo_obligatorio on public.%I as restrictive for all to authenticated using (public.es_usuario_activo()) with check (public.es_usuario_activo())', t.relname);
  end loop;
end $$;

create or replace function public.administrar_acceso(
  p_user_id uuid, p_role text, p_status text, p_modules text[], p_driver_id uuid default null
) returns void language plpgsql security definer set search_path = public
as $$
declare anterior public.profiles%rowtype;
begin
  -- Serializar también dos cambios de administradores simultáneos.
  perform pg_advisory_xact_lock(20260905, 100);
  if not public.is_admin(auth.uid()) then
    raise exception 'Solo un administrador activo puede administrar accesos' using errcode = '42501';
  end if;
  if p_role is null or p_role not in ('admin','superintendente','siervo','conductor','viewer')
    or p_status is null or p_status not in ('active','pending','inactive') then
    raise exception 'Rol o estado de acceso inválido' using errcode = '22023';
  end if;
  if p_modules is null or exists (
    select 1 from unnest(p_modules) m where m is null or m not in
      ('mapas','conductores','grupos','salidas','salidas_grupo','territorio_personal')
  ) then raise exception 'Módulo inválido' using errcode = '22023'; end if;

  select * into anterior from public.profiles where id = p_user_id for update;
  if not found then raise exception 'El usuario no existe' using errcode = '22023'; end if;
  if anterior.role = 'admin' and anterior.access_status = 'active'
    and (p_role <> 'admin' or p_status <> 'active')
    and not exists(select 1 from public.profiles where id <> p_user_id and role = 'admin' and access_status = 'active') then
    raise exception 'No se puede quitar el acceso al último administrador activo' using errcode = '23514';
  end if;
  if p_driver_id is not null and not exists(select 1 from public.conductores where id = p_driver_id) then
    raise exception 'El conductor vinculado no existe' using errcode = '23503';
  end if;

  update public.profiles set role = p_role, access_status = p_status, driver_id = p_driver_id where id = p_user_id;
  delete from public.user_module_access where user_id = p_user_id;
  if p_status = 'active' then
    insert into public.user_module_access(user_id, module_key)
    select p_user_id, m from (select distinct unnest(p_modules) m) modules;
  end if;
end $$;

-- Evitar que un cliente eluda la transacción y la protección del último admin.
revoke insert, update, delete on public.profiles, public.user_module_access from authenticated;
revoke all on function public.administrar_acceso(uuid,text,text,text[],uuid) from public, anon;
grant execute on function public.administrar_acceso(uuid,text,text,text[],uuid) to authenticated;

create or replace function public.actualizar_mi_nombre(p_nombre text)
returns void language plpgsql security definer set search_path = public
as $$ begin
  if not public.es_usuario_activo() then raise exception 'Acceso no autorizado' using errcode = '42501'; end if;
  if p_nombre is null or length(btrim(p_nombre)) < 2 or length(btrim(p_nombre)) > 120 then
    raise exception 'Escribí un nombre de entre 2 y 120 caracteres' using errcode = '22023';
  end if;
  update public.profiles set full_name = btrim(p_nombre) where id = auth.uid();
end $$;
-- No se habilita aún: primero sustituir la propiedad por nombre por assigned_to.
revoke all on function public.actualizar_mi_nombre(text) from public, anon, authenticated;

notify pgrst, 'reload schema';
commit;
