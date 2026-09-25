-- Una salida puede juntarse en una casa, por Zoom o en otro lugar sin mapa.
-- Las coordenadas siguen siendo opcionales y, si vienen, tienen que venir juntas.
--
-- 20260906020000 nunca se aplicó en DEV. crear_salida, que sí está, llama a
-- salidas_rpc_validar_payload y a los bloqueos de territorio y grupo.
-- Este archivo crea esas tres funciones internas. No reescribe crear_salida:
-- volver a correr 20260906020000 ahora pisaría el alta que completa el punto.
-- Escrita el 21 de septiembre de 2026.

begin;

create or replace function public.salidas_rpc_bloquear_territorios(
  p_territory_ids uuid[]
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_territory_id uuid;
begin
  for v_territory_id in
    select distinct territory_id
    from unnest(coalesce(p_territory_ids, '{}'::uuid[])) as ids(territory_id)
    where territory_id is not null
    order by territory_id
  loop
    perform 1
    from public.territorios
    where id = v_territory_id
    for update;

    if not found then
      raise exception 'El territorio no existe' using errcode = '22023';
    end if;
  end loop;
end;
$$;

create or replace function public.salidas_rpc_bloquear_grupos(
  p_group_ids uuid[]
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_group_id uuid;
begin
  for v_group_id in
    select distinct group_id
    from unnest(coalesce(p_group_ids, '{}'::uuid[])) as ids(group_id)
    where group_id is not null
    order by group_id
  loop
    perform 1
    from public.grupos_servicio
    where id = v_group_id
    for share;

    if not found then
      raise exception 'El grupo no existe' using errcode = '22023';
    end if;
  end loop;
end;
$$;

create or replace function public.salidas_rpc_validar_payload(
  p_title text,
  p_territory_id uuid,
  p_driver_id uuid,
  p_group_id uuid,
  p_meeting_point_id uuid,
  p_meeting_point_name text,
  p_meeting_point_lat numeric,
  p_meeting_point_lng numeric,
  p_scheduled_for timestamptz,
  p_notes text,
  p_complete boolean
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if p_title is null or btrim(p_title) = '' or length(btrim(p_title)) > 500 then
    raise exception 'El título de la salida es obligatorio y no puede superar 500 caracteres'
      using errcode = '22023';
  end if;

  if p_scheduled_for is null then
    raise exception 'La salida necesita fecha y hora' using errcode = '22023';
  end if;

  if length(coalesce(p_notes, '')) > 2000 then
    raise exception 'Las observaciones son demasiado largas' using errcode = '22023';
  end if;

  if (p_meeting_point_lat is null) <> (p_meeting_point_lng is null) then
    raise exception 'Las coordenadas del punto de encuentro deben venir juntas'
      using errcode = '22023';
  end if;

  if p_meeting_point_lat = 'NaN'::numeric
     or p_meeting_point_lng = 'NaN'::numeric
     or p_meeting_point_lat not between -90 and 90
     or p_meeting_point_lng not between -180 and 180 then
    raise exception 'Las coordenadas del punto de encuentro no son válidas'
      using errcode = '22023';
  end if;

  if p_meeting_point_name is not null
     and (btrim(p_meeting_point_name) = '' or length(btrim(p_meeting_point_name)) > 500) then
    raise exception 'La dirección del punto de encuentro no es válida'
      using errcode = '22023';
  end if;

  if p_complete then
    if p_territory_id is null or p_driver_id is null
       or p_meeting_point_name is null or btrim(p_meeting_point_name) = '' then
      raise exception 'La salida nueva necesita territorio, conductor y dónde se juntan'
        using errcode = '22023';
    end if;
  end if;

  if p_territory_id is not null
     and not exists (select 1 from public.territorios where id = p_territory_id) then
    raise exception 'El territorio no existe' using errcode = '22023';
  end if;

  if p_driver_id is not null
     and not exists (select 1 from public.conductores where id = p_driver_id) then
    raise exception 'El conductor no existe' using errcode = '23503';
  end if;

  if p_group_id is not null
     and not exists (select 1 from public.grupos_servicio where id = p_group_id) then
    raise exception 'El grupo no existe' using errcode = '23503';
  end if;

  if p_meeting_point_id is not null
     and not exists (select 1 from public.puntos_encuentro where id = p_meeting_point_id) then
    raise exception 'El punto de encuentro no existe' using errcode = '23503';
  end if;
end;
$$;

revoke all on function public.salidas_rpc_bloquear_territorios(uuid[]) from public, anon, authenticated;
revoke all on function public.salidas_rpc_bloquear_grupos(uuid[]) from public, anon, authenticated;
revoke all on function public.salidas_rpc_validar_payload(text, uuid, uuid, uuid, uuid, text, numeric, numeric, timestamptz, text, boolean)
  from public, anon, authenticated;

notify pgrst, 'reload schema';
commit;
