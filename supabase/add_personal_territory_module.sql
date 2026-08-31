alter table public.user_module_access
  drop constraint if exists user_module_access_module_key_check;

alter table public.user_module_access
  add constraint user_module_access_module_key_check
  check (
    module_key in (
      'mapas',
      'conductores',
      'grupos',
      'salidas',
      'salidas_grupo',
      'territorio_personal'
    )
  );

create table if not exists public.territorio_personal_reservas (
  id uuid primary key default gen_random_uuid(),
  territory_id uuid not null references public.territorios (id) on delete cascade,
  reserved_for text not null,
  status text not null default 'activa' check (status in ('activa', 'liberada')),
  reserved_at timestamptz not null default now(),
  released_at timestamptz,
  created_by uuid references public.profiles (id) on delete set null
);

create unique index if not exists territorio_personal_reservas_active_unique_idx
  on public.territorio_personal_reservas (territory_id)
  where status = 'activa';

alter table public.territorio_personal_reservas enable row level security;

drop policy if exists "Users with personal territories can read territorios" on public.territorios;
create policy "Users with personal territories can read territorios"
on public.territorios
for select
to authenticated
using (public.can_access_module('territorio_personal'));

drop policy if exists "Users can read personal territory reservations" on public.territorio_personal_reservas;
create policy "Users can read personal territory reservations"
on public.territorio_personal_reservas
for select
to authenticated
using (
  public.is_admin(auth.uid()) or
  public.can_access_module('territorio_personal') or
  public.can_access_module('salidas') or
  public.can_access_module('salidas_grupo')
);

drop policy if exists "Admins manage personal territory reservations" on public.territorio_personal_reservas;
create policy "Admins manage personal territory reservations"
on public.territorio_personal_reservas
for all
to authenticated
using (public.is_admin(auth.uid()))
with check (public.is_admin(auth.uid()));
