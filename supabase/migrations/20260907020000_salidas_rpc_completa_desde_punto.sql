-- Cuando la salida trae meeting_point_id, el servidor completa código,
-- barrio, territorio y GPS. El panel no manda campos nuevos.

begin;

create or replace function public.salidas_rpc_completar_desde_punto(
  p_meeting_point_id uuid,
  p_territory_id uuid,
  p_meeting_point_name text,
  p_meeting_point_lat numeric,
  p_meeting_point_lng numeric
)
returns table (
  territory_id uuid,
  meeting_point_name text,
  meeting_point_lat numeric,
  meeting_point_lng numeric,
  territorio_codigo text,
  barrio text
)
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_punto public.puntos_encuentro;
begin
  if p_meeting_point_id is null then
    territory_id := p_territory_id;
    meeting_point_name := nullif(btrim(coalesce(p_meeting_point_name, '')), '');
    meeting_point_lat := p_meeting_point_lat;
    meeting_point_lng := p_meeting_point_lng;
    territorio_codigo := null;
    barrio := null;
    return next;
    return;
  end if;

  select * into v_punto
  from public.puntos_encuentro
  where id = p_meeting_point_id;

  if not found then
    raise exception 'El punto de encuentro no existe' using errcode = '23503';
  end if;

  territory_id := coalesce(p_territory_id, v_punto.territory_id);
  meeting_point_name := coalesce(
    nullif(btrim(coalesce(p_meeting_point_name, '')), ''),
    v_punto.nombre
  );
  meeting_point_lat := coalesce(p_meeting_point_lat, v_punto.lat);
  meeting_point_lng := coalesce(p_meeting_point_lng, v_punto.lng);
  territorio_codigo := v_punto.codigo;
  barrio := v_punto.barrio;
  return next;
end;
$$;

create or replace function public.crear_salida(
  p_scope text,
  p_title text,
  p_territory_id uuid,
  p_driver_id uuid,
  p_group_id uuid,
  p_meeting_point_id uuid,
  p_meeting_point_name text,
  p_meeting_point_lat numeric,
  p_meeting_point_lng numeric,
  p_scheduled_for timestamptz,
  p_notes text default null
)
returns public.salidas
language plpgsql
security definer
set search_path = public
as $$
declare
  v_result public.salidas;
  v_comp record;
begin
  if p_scope is null or p_scope not in ('general', 'grupo') then
    raise exception 'Contexto de escritura inválido' using errcode = '22023';
  end if;

  if not public.salidas_rpc_autorizado(p_scope, p_group_id) then
    raise exception 'No tenés permiso para crear esta salida' using errcode = '42501';
  end if;

  select * into v_comp
  from public.salidas_rpc_completar_desde_punto(
    p_meeting_point_id, p_territory_id, p_meeting_point_name,
    p_meeting_point_lat, p_meeting_point_lng
  );

  perform public.salidas_rpc_validar_payload(
    p_title, v_comp.territory_id, p_driver_id, p_group_id, p_meeting_point_id,
    v_comp.meeting_point_name, v_comp.meeting_point_lat, v_comp.meeting_point_lng,
    p_scheduled_for, p_notes, true
  );

  perform public.salidas_rpc_bloquear_territorios(array[v_comp.territory_id]);
  perform public.salidas_rpc_bloquear_grupos(array[p_group_id]);

  if not public.salidas_rpc_autorizado(p_scope, p_group_id) then
    raise exception 'El permiso del grupo cambió antes de guardar' using errcode = '40001';
  end if;

  insert into public.salidas (
    title,
    territory_id,
    driver_id,
    group_id,
    meeting_point_id,
    meeting_point_name,
    meeting_point_lat,
    meeting_point_lng,
    scheduled_for,
    notes,
    territorio_codigo,
    barrio
  )
  values (
    btrim(p_title),
    v_comp.territory_id,
    p_driver_id,
    p_group_id,
    p_meeting_point_id,
    v_comp.meeting_point_name,
    v_comp.meeting_point_lat,
    v_comp.meeting_point_lng,
    p_scheduled_for,
    nullif(btrim(p_notes), ''),
    v_comp.territorio_codigo,
    v_comp.barrio
  )
  returning * into v_result;

  return v_result;
end;
$$;

create or replace function public.crear_salidas_lote(
  p_scope text,
  p_salidas jsonb
)
returns setof public.salidas
language plpgsql
security definer
set search_path = public
as $$
declare
  v_item jsonb;
  v_result public.salidas;
  v_title text;
  v_territory_id uuid;
  v_driver_id uuid;
  v_group_id uuid;
  v_meeting_point_id uuid;
  v_meeting_point_name text;
  v_meeting_point_lat numeric;
  v_meeting_point_lng numeric;
  v_scheduled_for timestamptz;
  v_notes text;
  v_comp record;
  v_territory_ids uuid[] := '{}'::uuid[];
  v_group_ids uuid[] := '{}'::uuid[];
begin
  if p_scope is null or p_scope not in ('general', 'grupo') then
    raise exception 'Contexto de escritura inválido' using errcode = '22023';
  end if;

  if not public.es_usuario_activo() then
    raise exception 'Tu cuenta no tiene acceso activo' using errcode = '42501';
  end if;

  if p_salidas is null or jsonb_typeof(p_salidas) <> 'array'
     or jsonb_array_length(p_salidas) = 0
     or jsonb_array_length(p_salidas) > 500 then
    raise exception 'El lote debe tener entre 1 y 500 salidas' using errcode = '22023';
  end if;

  for v_item in select value from jsonb_array_elements(p_salidas) as items(value) loop
    if jsonb_typeof(v_item) <> 'object' then
      raise exception 'Cada salida del lote debe ser un objeto' using errcode = '22023';
    end if;

    if exists (
      select 1
      from jsonb_object_keys(v_item) as fields(field_name)
      where field_name not in (
        'title', 'territory_id', 'driver_id', 'group_id',
        'meeting_point_id', 'meeting_point_name', 'meeting_point_lat',
        'meeting_point_lng', 'scheduled_for', 'notes'
      )
    ) then
      raise exception 'El lote contiene un campo no permitido' using errcode = '22023';
    end if;

    if (v_item ? 'title') and jsonb_typeof(v_item->'title') <> 'string' then
      raise exception 'El título del lote debe ser texto' using errcode = '22023';
    end if;
    if (v_item ? 'scheduled_for') and jsonb_typeof(v_item->'scheduled_for') <> 'string' then
      raise exception 'La fecha del lote debe ser texto ISO' using errcode = '22023';
    end if;
    if (v_item ? 'meeting_point_name') and jsonb_typeof(v_item->'meeting_point_name') not in ('string', 'null') then
      raise exception 'La dirección del lote debe ser texto' using errcode = '22023';
    end if;
    if (v_item ? 'notes') and jsonb_typeof(v_item->'notes') not in ('string', 'null') then
      raise exception 'Las observaciones del lote deben ser texto' using errcode = '22023';
    end if;
    if (v_item ? 'meeting_point_lat') and jsonb_typeof(v_item->'meeting_point_lat') not in ('number', 'null') then
      raise exception 'La latitud del lote debe ser numérica' using errcode = '22023';
    end if;
    if (v_item ? 'meeting_point_lng') and jsonb_typeof(v_item->'meeting_point_lng') not in ('number', 'null') then
      raise exception 'La longitud del lote debe ser numérica' using errcode = '22023';
    end if;

    v_title := v_item->>'title';
    v_territory_id := nullif(v_item->>'territory_id', '')::uuid;
    v_driver_id := nullif(v_item->>'driver_id', '')::uuid;
    v_group_id := nullif(v_item->>'group_id', '')::uuid;
    v_meeting_point_id := nullif(v_item->>'meeting_point_id', '')::uuid;
    v_meeting_point_name := v_item->>'meeting_point_name';
    v_meeting_point_lat := (v_item->>'meeting_point_lat')::numeric;
    v_meeting_point_lng := (v_item->>'meeting_point_lng')::numeric;
    v_scheduled_for := (v_item->>'scheduled_for')::timestamptz;
    v_notes := v_item->>'notes';

    select * into v_comp
    from public.salidas_rpc_completar_desde_punto(
      v_meeting_point_id, v_territory_id, v_meeting_point_name,
      v_meeting_point_lat, v_meeting_point_lng
    );

    perform public.salidas_rpc_validar_payload(
      v_title, v_comp.territory_id, v_driver_id, v_group_id, v_meeting_point_id,
      v_comp.meeting_point_name, v_comp.meeting_point_lat, v_comp.meeting_point_lng,
      v_scheduled_for, v_notes, true
    );

    if not public.salidas_rpc_autorizado(p_scope, v_group_id) then
      raise exception 'No tenés permiso para una salida del lote' using errcode = '42501';
    end if;

    if p_scope = 'grupo' and v_comp.territory_id is not null
       and v_comp.territory_id = any(v_territory_ids) then
      raise exception 'No repitas el mismo territorio dentro del lote'
        using errcode = '22023';
    end if;

    v_territory_ids := array_append(v_territory_ids, v_comp.territory_id);
    v_group_ids := array_append(v_group_ids, v_group_id);
  end loop;

  perform public.salidas_rpc_bloquear_territorios(v_territory_ids);
  perform public.salidas_rpc_bloquear_grupos(v_group_ids);

  for v_item in select value from jsonb_array_elements(p_salidas) as items(value) loop
    v_title := v_item->>'title';
    v_territory_id := nullif(v_item->>'territory_id', '')::uuid;
    v_driver_id := nullif(v_item->>'driver_id', '')::uuid;
    v_group_id := nullif(v_item->>'group_id', '')::uuid;
    v_meeting_point_id := nullif(v_item->>'meeting_point_id', '')::uuid;
    v_meeting_point_name := v_item->>'meeting_point_name';
    v_meeting_point_lat := (v_item->>'meeting_point_lat')::numeric;
    v_meeting_point_lng := (v_item->>'meeting_point_lng')::numeric;
    v_scheduled_for := (v_item->>'scheduled_for')::timestamptz;
    v_notes := v_item->>'notes';

    select * into v_comp
    from public.salidas_rpc_completar_desde_punto(
      v_meeting_point_id, v_territory_id, v_meeting_point_name,
      v_meeting_point_lat, v_meeting_point_lng
    );

    if not public.salidas_rpc_autorizado(p_scope, v_group_id) then
      raise exception 'El permiso del grupo cambió antes de guardar el lote'
        using errcode = '40001';
    end if;

    insert into public.salidas (
      title,
      territory_id,
      driver_id,
      group_id,
      meeting_point_id,
      meeting_point_name,
      meeting_point_lat,
      meeting_point_lng,
      scheduled_for,
      notes,
      territorio_codigo,
      barrio
    )
    values (
      btrim(v_title),
      v_comp.territory_id,
      v_driver_id,
      v_group_id,
      v_meeting_point_id,
      v_comp.meeting_point_name,
      v_comp.meeting_point_lat,
      v_comp.meeting_point_lng,
      v_scheduled_for,
      nullif(btrim(v_notes), ''),
      v_comp.territorio_codigo,
      v_comp.barrio
    )
    returning * into v_result;

    return next v_result;
  end loop;

  return;
end;
$$;

create or replace function public.editar_salida(
  p_scope text,
  p_salida_id uuid,
  p_title text,
  p_territory_id uuid,
  p_driver_id uuid,
  p_group_id uuid,
  p_meeting_point_id uuid,
  p_meeting_point_name text,
  p_meeting_point_lat numeric,
  p_meeting_point_lng numeric,
  p_scheduled_for timestamptz,
  p_notes text default null
)
returns public.salidas
language plpgsql
security definer
set search_path = public
as $$
declare
  v_old_territory_id uuid;
  v_old_group_id uuid;
  v_current public.salidas;
  v_result public.salidas;
  v_historical boolean;
  v_comp record;
begin
  if p_scope is null or p_scope not in ('general', 'grupo') then
    raise exception 'Contexto de escritura inválido' using errcode = '22023';
  end if;
  if p_salida_id is null then
    raise exception 'Falta identificar la salida' using errcode = '22023';
  end if;

  select territory_id, group_id
    into v_old_territory_id, v_old_group_id
  from public.salidas
  where id = p_salida_id;
  if not found then
    raise exception 'La salida no existe' using errcode = '22023';
  end if;

  select * into v_comp
  from public.salidas_rpc_completar_desde_punto(
    p_meeting_point_id, p_territory_id, p_meeting_point_name,
    p_meeting_point_lat, p_meeting_point_lng
  );

  perform public.salidas_rpc_bloquear_territorios(
    array[v_old_territory_id, v_comp.territory_id]
  );
  perform public.salidas_rpc_bloquear_grupos(
    array[v_old_group_id, p_group_id]
  );

  select * into v_current
  from public.salidas
  where id = p_salida_id
  for update;

  if not found then
    raise exception 'La salida dejó de existir' using errcode = '40001';
  end if;
  if v_current.territory_id is distinct from v_old_territory_id
     or v_current.group_id is distinct from v_old_group_id then
    raise exception 'La salida cambió mientras la editabas. Actualizá antes de guardar'
      using errcode = '40001';
  end if;

  if not public.salidas_rpc_autorizado(p_scope, v_current.group_id)
     or (p_scope = 'grupo' and not public.salidas_rpc_autorizado(p_scope, p_group_id)) then
    raise exception 'El permiso de la salida cambió antes de guardar' using errcode = '40001';
  end if;

  v_historical := v_current.origen = 'excel' or v_current.registro_id is not null;

  perform public.salidas_rpc_validar_payload(
    p_title, v_comp.territory_id, p_driver_id, p_group_id, p_meeting_point_id,
    v_comp.meeting_point_name, v_comp.meeting_point_lat, v_comp.meeting_point_lng,
    p_scheduled_for, p_notes, not v_historical
  );

  if v_historical and p_scheduled_for is distinct from v_current.scheduled_for then
    raise exception 'La fecha y hora de una salida importada son inmutables'
      using errcode = '55000';
  end if;

  update public.salidas
  set title = btrim(p_title),
      territory_id = v_comp.territory_id,
      driver_id = p_driver_id,
      group_id = p_group_id,
      meeting_point_id = p_meeting_point_id,
      meeting_point_name = v_comp.meeting_point_name,
      meeting_point_lat = v_comp.meeting_point_lat,
      meeting_point_lng = v_comp.meeting_point_lng,
      scheduled_for = p_scheduled_for,
      notes = nullif(btrim(p_notes), ''),
      territorio_codigo = coalesce(v_comp.territorio_codigo, territorio_codigo),
      barrio = coalesce(v_comp.barrio, barrio)
  where id = p_salida_id
  returning * into v_result;

  return v_result;
end;
$$;

revoke all on function public.salidas_rpc_completar_desde_punto(uuid, uuid, text, numeric, numeric)
  from public, anon, authenticated;

notify pgrst, 'reload schema';
commit;
