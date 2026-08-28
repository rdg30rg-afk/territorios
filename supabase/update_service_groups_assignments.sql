alter table public.grupos_servicio
  add column if not exists group_number integer;

alter table public.grupos_servicio
  add column if not exists driver_id uuid references public.conductores (id) on delete set null;
