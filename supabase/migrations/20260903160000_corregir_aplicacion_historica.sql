-- Correcciones detectadas en la auditoría previa a materializar el histórico.
begin;

alter table territorio_historial
  add column if not exists source_detail jsonb not null default '{}'::jsonb;

-- La misma fila puede volver a procesarse con otro parser dentro de otra
-- corrida; sólo debe ser única dentro de su importación.
drop index if exists importacion_registros_source_key_unique_idx;
create unique index if not exists importacion_registros_source_key_per_run_idx
  on importacion_registros (importacion_id, source_key)
  where source_key is not null;

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
