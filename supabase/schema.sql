create extension if not exists pgcrypto;

create table if not exists pending_users (
  id uuid primary key default gen_random_uuid(),
  full_name text not null,
  email text unique not null,
  username text,
  requested_at timestamptz not null default now()
);

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (id, full_name, username, auth_email, role)
  values (
    new.id,
    coalesce(new.raw_user_meta_data ->> 'full_name', split_part(new.email, '@', 1)),
    coalesce(new.raw_user_meta_data ->> 'username', split_part(new.email, '@', 1)),
    new.email,
    'viewer'
  )
  on conflict (id) do nothing;

  return new;
end;
$$;

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

create table if not exists profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  full_name text,
  username text unique,
  auth_email text unique,
  role text not null default 'viewer' check (role in ('admin', 'superintendente', 'siervo', 'conductor', 'viewer')),
  created_at timestamptz not null default now()
);

alter table profiles add column if not exists username text;
alter table profiles add column if not exists auth_email text;

create unique index if not exists profiles_username_unique_idx
  on profiles (lower(username))
  where username is not null;

create unique index if not exists profiles_auth_email_unique_idx
  on profiles (lower(auth_email))
  where auth_email is not null;

update public.profiles as p
set auth_email = u.email
from auth.users as u
where p.id = u.id
  and (p.auth_email is null or p.auth_email = '');

update public.profiles
set username = coalesce(username, split_part(auth_email, '@', 1))
where auth_email is not null
  and username is null;

create or replace function public.resolve_login_email(login_identifier text)
returns text
language sql
security definer
set search_path = public
stable
as $$
  select auth_email
  from public.profiles
  where lower(username) = lower(login_identifier)
     or lower(auth_email) = lower(login_identifier)
  limit 1;
$$;

create table if not exists user_module_access (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references profiles (id) on delete cascade,
  module_key text not null check (module_key in ('mapas', 'conductores', 'grupos', 'salidas')),
  granted_at timestamptz not null default now(),
  unique (user_id, module_key)
);

create table if not exists territorios (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  description text,
  polygon_geojson jsonb not null,
  created_by uuid references profiles (id) on delete set null,
  created_at timestamptz not null default now()
);

create table if not exists conductores (
  id uuid primary key default gen_random_uuid(),
  full_name text not null,
  phone text,
  notes text,
  availability jsonb not null default '{"days": [], "turns": []}'::jsonb,
  status text not null default 'activo' check (status in ('activo', 'pendiente', 'inactivo')),
  created_at timestamptz not null default now()
);

alter table conductores
  add column if not exists availability jsonb not null default '{"days": [], "turns": []}'::jsonb;

alter table profiles
  add column if not exists driver_id uuid references conductores (id) on delete set null;

create table if not exists grupos_servicio (
  id uuid primary key default gen_random_uuid(),
  group_name text not null,
  group_number integer,
  driver_id uuid references conductores (id) on delete set null,
  manager_name text not null,
  manager_role text not null check (manager_role in ('superintendente', 'siervo', 'auxiliar')),
  created_at timestamptz not null default now()
);

alter table grupos_servicio
  add column if not exists group_number integer;

alter table grupos_servicio
  add column if not exists driver_id uuid references conductores (id) on delete set null;

create table if not exists salidas (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  territory_id uuid references territorios (id) on delete set null,
  driver_id uuid references conductores (id) on delete set null,
  group_id uuid references grupos_servicio (id) on delete set null,
  meeting_point_name text not null,
  meeting_point_lat numeric(9, 6) not null,
  meeting_point_lng numeric(9, 6) not null,
  scheduled_for timestamptz not null,
  notes text,
  created_at timestamptz not null default now()
);

alter table salidas
  add column if not exists territory_id uuid references territorios (id) on delete set null;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute procedure public.handle_new_user();

alter table profiles enable row level security;
alter table user_module_access enable row level security;
alter table territorios enable row level security;
alter table conductores enable row level security;
alter table grupos_servicio enable row level security;
alter table salidas enable row level security;

drop policy if exists "Users can read their own profile" on profiles;
create policy "Users can read their own profile"
on profiles
for select
to authenticated
using (auth.uid() = id);

drop policy if exists "Users can update their own profile" on profiles;

drop policy if exists "Admins can manage profiles" on profiles;
create policy "Admins can manage profiles"
on profiles
for all
to authenticated
using (public.is_admin(auth.uid()))
with check (public.is_admin(auth.uid()));

drop policy if exists "Users can read their module access" on user_module_access;
create policy "Users can read their module access"
on user_module_access
for select
to authenticated
using (user_id = auth.uid());

drop policy if exists "Admins manage module access" on user_module_access;
create policy "Admins manage module access"
on user_module_access
for all
to authenticated
using (public.is_admin(auth.uid()))
with check (public.is_admin(auth.uid()));

drop policy if exists "Authenticated users can read shared data" on territorios;
create policy "Users with mapas can read territorios"
on territorios
for select
to authenticated
using (public.can_access_module('mapas'));

drop policy if exists "Authenticated users can read drivers" on conductores;
create policy "Users with conductores can read drivers"
on conductores
for select
to authenticated
using (public.can_access_module('conductores') or public.can_access_module('salidas'));

drop policy if exists "Authenticated users can read groups" on grupos_servicio;
create policy "Users with grupos can read groups"
on grupos_servicio
for select
to authenticated
using (public.can_access_module('grupos') or public.can_access_module('salidas'));

drop policy if exists "Authenticated users can read outings" on salidas;
create policy "Users with salidas can read outings"
on salidas
for select
to authenticated
using (public.can_access_module('salidas'));

drop policy if exists "Admins manage territorios" on territorios;
create policy "Admins manage territorios"
on territorios
for all
to authenticated
using (public.is_admin(auth.uid()))
with check (public.is_admin(auth.uid()));

drop policy if exists "Admins manage conductores" on conductores;
create policy "Admins manage conductores"
on conductores
for all
to authenticated
using (public.is_admin(auth.uid()))
with check (public.is_admin(auth.uid()));

drop policy if exists "Admins manage grupos" on grupos_servicio;
create policy "Admins manage grupos"
on grupos_servicio
for all
to authenticated
using (public.is_admin(auth.uid()))
with check (public.is_admin(auth.uid()));

drop policy if exists "Admins manage salidas" on salidas;
create policy "Admins manage salidas"
on salidas
for all
to authenticated
using (public.is_admin(auth.uid()))
with check (public.is_admin(auth.uid()));
