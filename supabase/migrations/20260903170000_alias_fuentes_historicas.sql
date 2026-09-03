-- Conserva todas las filas fuente aunque varias compartan el mismo alias.
begin;

create table if not exists public.conductor_alias_sources (
  id uuid primary key default gen_random_uuid(),
  alias_id uuid not null references public.conductor_alias (id) on delete restrict,
  source_record_id uuid not null references public.importacion_registros (id) on delete restrict,
  created_at timestamptz not null default now(),
  constraint conductor_alias_sources_source_unique unique (source_record_id),
  constraint conductor_alias_sources_pair_unique unique (alias_id, source_record_id)
);

create index if not exists conductor_alias_sources_alias_idx
  on public.conductor_alias_sources (alias_id);

alter table public.conductor_alias_sources enable row level security;

create policy "Admins leen fuentes de alias" on public.conductor_alias_sources
for select to authenticated using (public.is_admin(auth.uid()));

revoke insert, update, delete on public.conductor_alias_sources from authenticated;
grant select on public.conductor_alias_sources to authenticated;

create or replace function public.finalize_historical_application(
  p_importation_id uuid
)
returns integer
language plpgsql
security invoker
set search_path = public
as $$
declare
  affected integer;
begin
  with destinations as (
    select source.source_record_id as registro_id, source.alias_id as destino_id
    from conductor_alias_sources source
    union all
    select registro_id, id from territorio_historial where registro_id is not null
    union all
    select registro_id, id from salidas where registro_id is not null
  )
  update importacion_registros record
  set
    destino_id = destination.destino_id,
    estado = 'aplicado',
    resolution_status = 'resolved',
    quality_status = 'warning',
    revisado_at = now()
  from destinations destination
  where record.id = destination.registro_id
    and record.importacion_id = p_importation_id
    and record.estado = 'pendiente';

  get diagnostics affected = row_count;
  return affected;
end;
$$;

revoke all on function public.finalize_historical_application(uuid)
  from public, anon, authenticated;
grant execute on function public.finalize_historical_application(uuid)
  to service_role;

commit;
