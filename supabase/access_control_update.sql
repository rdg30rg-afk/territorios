-- Actualizacion de acceso administrado para la PWA Territorios.
-- Ejecutar en Supabase SQL Editor sobre el proyecto conectado a la app.

create or replace function public.is_admin(user_id uuid)
returns boolean
language sql
security definer
set search_path = public
stable
as $$
  select exists (
    select 1
    from public.profiles
    where id = user_id and role = 'admin'
  );
$$;

create or replace function public.can_access_module(module_name text)
returns boolean
language sql
security definer
set search_path = public
stable
as $$
  select public.is_admin(auth.uid())
    or exists (
      select 1
      from public.user_module_access
      where user_id = auth.uid()
        and module_key = module_name
    );
$$;

-- Permitir la nueva asignacion "Auxiliar de grupo" en grupos existentes.
do $$
declare
  constraint_name text;
begin
  for constraint_name in
    select c.conname
    from pg_constraint c
    join pg_class t on t.oid = c.conrelid
    join pg_namespace n on n.oid = t.relnamespace
    where n.nspname = 'public'
      and t.relname = 'grupos_servicio'
      and c.contype = 'c'
      and pg_get_constraintdef(c.oid) ilike '%manager_role%'
  loop
    execute format('alter table public.grupos_servicio drop constraint %I', constraint_name);
  end loop;
end;
$$;

alter table public.grupos_servicio
  add constraint grupos_servicio_manager_role_check
  check (manager_role in ('superintendente', 'siervo', 'auxiliar'));

-- Evitar que un usuario se cambie su propio rol. El admin gestiona perfiles.
drop policy if exists "Users can update their own profile" on public.profiles;

drop policy if exists "Admins can manage profiles" on public.profiles;
create policy "Admins can manage profiles"
on public.profiles
for all
to authenticated
using (public.is_admin(auth.uid()))
with check (public.is_admin(auth.uid()));

-- Accesos por modulo gestionados solo por administradores.
drop policy if exists "Admins manage module access" on public.user_module_access;
create policy "Admins manage module access"
on public.user_module_access
for all
to authenticated
using (public.is_admin(auth.uid()))
with check (public.is_admin(auth.uid()));

-- Lectura de datos compartidos solo para usuarios aprobados por modulo.
drop policy if exists "Authenticated users can read shared data" on public.territorios;
create policy "Users with mapas can read territorios"
on public.territorios
for select
to authenticated
using (public.can_access_module('mapas'));

drop policy if exists "Authenticated users can read drivers" on public.conductores;
create policy "Users with conductores can read drivers"
on public.conductores
for select
to authenticated
using (public.can_access_module('conductores') or public.can_access_module('salidas'));

drop policy if exists "Authenticated users can read groups" on public.grupos_servicio;
create policy "Users with grupos can read groups"
on public.grupos_servicio
for select
to authenticated
using (public.can_access_module('grupos') or public.can_access_module('salidas'));

drop policy if exists "Authenticated users can read outings" on public.salidas;
create policy "Users with salidas can read outings"
on public.salidas
for select
to authenticated
using (public.can_access_module('salidas'));

