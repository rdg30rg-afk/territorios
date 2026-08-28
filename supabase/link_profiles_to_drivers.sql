alter table public.profiles
  add column if not exists driver_id uuid references public.conductores (id) on delete set null;
