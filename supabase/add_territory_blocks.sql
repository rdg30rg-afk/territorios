create table if not exists territorio_manzanas (
  id uuid primary key default gen_random_uuid(),
  territory_id uuid not null references territorios (id) on delete cascade,
  label text not null,
  lat numeric(9, 6) not null,
  lng numeric(9, 6) not null,
  created_at timestamptz not null default now(),
  unique (territory_id, label)
);

alter table territorio_manzanas enable row level security;

drop policy if exists "Users with mapas can read territory blocks" on territorio_manzanas;
create policy "Users with mapas can read territory blocks"
on territorio_manzanas
for select
to authenticated
using (public.can_access_module('mapas'));

drop policy if exists "Admins manage territory blocks" on territorio_manzanas;
create policy "Admins manage territory blocks"
on territorio_manzanas
for all
to authenticated
using (public.is_admin(auth.uid()))
with check (public.is_admin(auth.uid()));
