-- =====================================================================
-- Aplicación auditable del histórico ya revisado en staging
--
-- Aditiva y preparada primero para DEV. No materializa datos por sí sola:
-- agrega procedencia y una bitácora para que el aplicador pueda reanudarse
-- sin duplicar ni borrar historia.
-- =====================================================================

begin;

alter table conductor_alias
  add column if not exists source_record_id uuid
    references importacion_registros (id) on delete restrict;

create unique index if not exists conductor_alias_source_record_unique_idx
  on conductor_alias (source_record_id)
  where source_record_id is not null;

create table if not exists importacion_aplicaciones (
  id uuid primary key default gen_random_uuid(),
  importacion_id uuid not null references importaciones (id) on delete restrict,
  source_sha256 text not null check (source_sha256 ~ '^[0-9a-f]{64}$'),
  parser_version text not null,
  applicator_version text not null,
  status text not null default 'running'
    check (status in ('running', 'completed', 'failed')),
  counts jsonb not null default '{}'::jsonb,
  error_message text,
  started_at timestamptz not null default now(),
  finished_at timestamptz,
  created_by uuid references profiles (id) on delete set null,
  constraint importacion_aplicaciones_finish_honest check (
    (status = 'running' and finished_at is null)
    or (status in ('completed', 'failed') and finished_at is not null)
  )
);

create unique index if not exists importacion_aplicaciones_completed_unique_idx
  on importacion_aplicaciones (importacion_id, applicator_version)
  where status = 'completed';

alter table importacion_aplicaciones enable row level security;

create policy "Admins leen aplicaciones historicas" on importacion_aplicaciones
for select to authenticated using (public.is_admin(auth.uid()));

revoke insert, update, delete on public.importacion_aplicaciones from authenticated;
grant select on public.importacion_aplicaciones to authenticated;

-- Marca como aplicadas sólo las filas para las que ya existe un destino con
-- la misma procedencia. La unión se resuelve dentro de PostgreSQL para que
-- `estado` y `destino_id` no puedan divergir por una caída entre requests.
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
    select source_record_id as registro_id, id as destino_id
    from conductor_alias where source_record_id is not null
    union all
    select registro_id, id from territorio_historial where registro_id is not null
    union all
    select registro_id, id from salidas where registro_id is not null
  )
  update importacion_registros record
  set
    destino_id = destination.destino_id,
    estado = 'aplicado',
    resolution_status = 'waived',
    quality_status = 'warning',
    revisado_at = now()
  from destinations destination
  where record.id = destination.registro_id
    and record.importacion_id = p_importation_id;

  get diagnostics affected = row_count;
  return affected;
end;
$$;

revoke all on function public.finalize_historical_application(uuid)
  from public, anon, authenticated;
grant execute on function public.finalize_historical_application(uuid)
  to service_role;

-- Una salida importada ya forma parte del histórico. Si fue mal aplicada se
-- corrige por procedencia; no se borra silenciosamente desde la aplicación.
create or replace function public.protect_imported_outing_delete()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if old.origen = 'excel' or old.registro_id is not null then
    raise exception 'Una salida importada no se elimina; debe corregirse de forma auditable';
  end if;
  return old;
end;
$$;

drop trigger if exists salidas_protect_imported_delete on salidas;
create trigger salidas_protect_imported_delete
  before delete on salidas
  for each row execute function public.protect_imported_outing_delete();

commit;
