-- Completa el tipo de destino de la primera etapa.
-- Es metadata de trazabilidad: no crea, borra ni re-asocia destinos.
-- El alcance queda fijado a la corrida auditada del histórico.

begin;

update public.importacion_registros r
set destino_tipo = case r.destino_tabla
  when 'salidas' then 'salida'
  when 'territorio_historial' then 'territorio_historial'
  when 'conductores' then 'conductor_alias'
  else r.destino_tipo
end
where r.importacion_id = (
    select i.id
    from public.importaciones i
    where i.source_sha256 = '1559266196bcba5360ddbc71d3e33bc22e61c11f12d90daa809952a170e132e2'
      and i.parser_version = '2.0.0-temporal'
      and i.estado <> 'revertida'
  )
  and r.destino_id is not null
  and r.destino_tipo is null
  and r.destino_tabla in ('salidas', 'territorio_historial', 'conductores');

do $$
declare
  remaining integer;
begin
  select count(*)
    into remaining
  from public.importacion_registros r
  where r.importacion_id = (
      select i.id
      from public.importaciones i
      where i.source_sha256 = '1559266196bcba5360ddbc71d3e33bc22e61c11f12d90daa809952a170e132e2'
        and i.parser_version = '2.0.0-temporal'
        and i.estado <> 'revertida'
    )
    and r.destino_id is not null
    and r.destino_tipo is null;

  if remaining <> 0 then
    raise exception 'Quedaron % destinos historicos sin destino_tipo', remaining;
  end if;
end;
$$;

commit;
