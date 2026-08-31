create extension if not exists pgcrypto;

create table if not exists public.pending_users (
  id uuid primary key default gen_random_uuid(),
  full_name text not null,
  email text unique not null,
  username text,
  requested_at timestamptz not null default now()
);

alter table public.profiles
  add column if not exists username text;

alter table public.profiles
  add column if not exists auth_email text;

alter table public.profiles
  add column if not exists driver_id uuid references public.conductores (id) on delete set null;

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
  on conflict (id) do update
  set
    full_name = coalesce(public.profiles.full_name, excluded.full_name),
    username = coalesce(public.profiles.username, excluded.username),
    auth_email = coalesce(public.profiles.auth_email, excluded.auth_email);

  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute procedure public.handle_new_user();

insert into public.profiles (id, full_name, username, auth_email, role)
select
  users.id,
  coalesce(users.raw_user_meta_data ->> 'full_name', split_part(users.email, '@', 1)),
  coalesce(users.raw_user_meta_data ->> 'username', split_part(users.email, '@', 1)),
  users.email,
  'viewer'
from auth.users
where not exists (
  select 1
  from public.profiles
  where profiles.id = users.id
);

alter table public.pending_users enable row level security;

drop policy if exists "Anyone can request access" on public.pending_users;
create policy "Anyone can request access"
on public.pending_users
for insert
to anon, authenticated
with check (true);

drop policy if exists "Admins can manage pending users" on public.pending_users;
create policy "Admins can manage pending users"
on public.pending_users
for all
to authenticated
using (public.is_admin(auth.uid()))
with check (public.is_admin(auth.uid()));
