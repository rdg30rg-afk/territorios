-- =====================================================================
-- Escritura de salidas por RPC
--
-- La aplicación autenticada deja de hacer INSERT/UPDATE/DELETE directo.
-- El service_role de los cargadores históricos no cambia: esta migración
-- revoca únicamente esos verbos a authenticated.
--
-- La autorización conserva la política efectiva anterior:
--   * general: administrador activo con acceso efectivo a salidas;
--   * grupo: administrador activo, o cuenta activa con salidas_grupo,
--     driver_id exacto del grupo y manager_role superintendente/auxiliar.
-- El módulo grupos sólo habilita lectura de grupos; no se transforma en
-- permiso de escritura de salidas.
-- =====================================================================

begin;

-- ---------------------------------------------------------------------
-- 1. Autorización y locks comunes
-- ---------------------------------------------------------------------

create or replace function public.salidas_rpc_autorizado(
  p_scope text,
  p_group_id uuid
)
returns boolean
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if not public.es_usuario_activo() then
    return false;
  end if;

  if p_scope = 'general' then
    -- El módulo salidas no era una autorización de DML para un no-admin:
    -- las políticas efectivas sólo le daban lectura. Se conserva esa frontera.
    return public.is_admin(auth.uid())
      and public.can_access_module('salidas');
  end if;

  if p_scope = 'grupo' then
    return public.is_admin(auth.uid())
      or (
        public.can_access_module('salidas_grupo')
        and exists (
          select 1
          from public.profiles p
          join public.grupos_servicio g on g.driver_id = p.driver_id
          where p.id = auth.uid()
            and g.id = p_group_id
            and g.manager_role in ('superintendente', 'auxiliar')
        )
      );
  end if;

  return false;
end;
$$;

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
  -- El orden es parte del contrato: nunca tomar dos territorios según el
  -- orden del formulario o del JSON recibido.
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
       or p_meeting_point_name is null or btrim(p_meeting_point_name) = ''
       or p_meeting_point_lat is null or p_meeting_point_lng is null then
      raise exception 'La salida nueva necesita territorio, conductor, dirección y GPS'
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

-- ---------------------------------------------------------------------
-- 2. Alta individual
-- ---------------------------------------------------------------------

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
begin
  if p_scope is null or p_scope not in ('general', 'grupo') then
    raise exception 'Contexto de escritura inválido' using errcode = '22023';
  end if;

  if not public.salidas_rpc_autorizado(p_scope, p_group_id) then
    raise exception 'No tenés permiso para crear esta salida' using errcode = '42501';
  end if;

  perform public.salidas_rpc_validar_payload(
    p_title, p_territory_id, p_driver_id, p_group_id, p_meeting_point_id,
    p_meeting_point_name, p_meeting_point_lat, p_meeting_point_lng,
    p_scheduled_for, p_notes, true
  );

  -- Padre primero; los locks de filas salidas vienen después.
  perform public.salidas_rpc_bloquear_territorios(array[p_territory_id]);
  perform public.salidas_rpc_bloquear_grupos(array[p_group_id]);

  -- La pertenencia puede cambiar mientras se esperaba el territorio/grupo.
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
    notes
  )
  values (
    btrim(p_title),
    p_territory_id,
    p_driver_id,
    p_group_id,
    p_meeting_point_id,
    nullif(btrim(p_meeting_point_name), ''),
    p_meeting_point_lat,
    p_meeting_point_lng,
    p_scheduled_for,
    nullif(btrim(p_notes), '')
  )
  returning * into v_result;

  return v_result;
end;
$$;

-- ---------------------------------------------------------------------
-- 3. Alta de lote atómica
-- ---------------------------------------------------------------------

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

  -- Primera pasada: validar todo y reunir padres. No se inserta nada todavía.
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

    perform public.salidas_rpc_validar_payload(
      v_title, v_territory_id, v_driver_id, v_group_id, v_meeting_point_id,
      v_meeting_point_name, v_meeting_point_lat, v_meeting_point_lng,
      v_scheduled_for, v_notes, true
    );

    if not public.salidas_rpc_autorizado(p_scope, v_group_id) then
      raise exception 'No tenés permiso para una salida del lote' using errcode = '42501';
    end if;

    if p_scope = 'grupo' and v_territory_id = any(v_territory_ids) then
      raise exception 'No repitas el mismo territorio dentro del lote'
        using errcode = '22023';
    end if;

    v_territory_ids := array_append(v_territory_ids, v_territory_id);
    v_group_ids := array_append(v_group_ids, v_group_id);
  end loop;

  -- Todos los padres se toman ordenados antes de cualquier fila salidas.
  perform public.salidas_rpc_bloquear_territorios(v_territory_ids);
  perform public.salidas_rpc_bloquear_grupos(v_group_ids);

  -- Segunda pasada: revalidar vínculo y escribir sólo después de todos los
  -- preflight/locks. Un error en cualquier fila revierte el lote completo.
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
      notes
    )
    values (
      btrim(v_title),
      v_territory_id,
      v_driver_id,
      v_group_id,
      v_meeting_point_id,
      nullif(btrim(v_meeting_point_name), ''),
      v_meeting_point_lat,
      v_meeting_point_lng,
      v_scheduled_for,
      nullif(btrim(v_notes), '')
    )
    returning * into v_result;

    return next v_result;
  end loop;

  return;
end;
$$;

-- ---------------------------------------------------------------------
-- 4. Edición con territorio viejo+nuevo y revalidación
-- ---------------------------------------------------------------------

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
begin
  if p_scope is null or p_scope not in ('general', 'grupo') then
    raise exception 'Contexto de escritura inválido' using errcode = '22023';
  end if;
  if p_salida_id is null then
    raise exception 'Falta identificar la salida' using errcode = '22023';
  end if;

  -- Lectura inicial sin lock: sólo descubre ambos padres. La relación se
  -- vuelve a comprobar después de tomar los locks ordenados.
  select territory_id, group_id
    into v_old_territory_id, v_old_group_id
  from public.salidas
  where id = p_salida_id;
  if not found then
    raise exception 'La salida no existe' using errcode = '22023';
  end if;

  perform public.salidas_rpc_bloquear_territorios(
    array[v_old_territory_id, p_territory_id]
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
    p_title, p_territory_id, p_driver_id, p_group_id, p_meeting_point_id,
    p_meeting_point_name, p_meeting_point_lat, p_meeting_point_lng,
    p_scheduled_for, p_notes, not v_historical
  );

  if v_historical and p_scheduled_for is distinct from v_current.scheduled_for then
    raise exception 'La fecha y hora de una salida importada son inmutables'
      using errcode = '55000';
  end if;

  update public.salidas
  set title = btrim(p_title),
      territory_id = p_territory_id,
      driver_id = p_driver_id,
      group_id = p_group_id,
      meeting_point_id = p_meeting_point_id,
      meeting_point_name = nullif(btrim(p_meeting_point_name), ''),
      meeting_point_lat = p_meeting_point_lat,
      meeting_point_lng = p_meeting_point_lng,
      scheduled_for = p_scheduled_for,
      notes = nullif(btrim(p_notes), '')
  where id = p_salida_id
  returning * into v_result;

  return v_result;
end;
$$;

-- ---------------------------------------------------------------------
-- 5. Borrado sólo de salidas no históricas
-- ---------------------------------------------------------------------

create or replace function public.borrar_salida(
  p_scope text,
  p_salida_id uuid
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_old_territory_id uuid;
  v_old_group_id uuid;
  v_current public.salidas;
  v_deleted_id uuid;
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

  perform public.salidas_rpc_bloquear_territorios(array[v_old_territory_id]);
  perform public.salidas_rpc_bloquear_grupos(array[v_old_group_id]);

  select * into v_current
  from public.salidas
  where id = p_salida_id
  for update;
  if not found then
    raise exception 'La salida dejó de existir' using errcode = '40001';
  end if;
  if v_current.territory_id is distinct from v_old_territory_id
     or v_current.group_id is distinct from v_old_group_id then
    raise exception 'La salida cambió mientras la eliminabas. Actualizá antes de guardar'
      using errcode = '40001';
  end if;

  if not public.salidas_rpc_autorizado(p_scope, v_current.group_id) then
    raise exception 'El permiso de la salida cambió antes de eliminarla' using errcode = '40001';
  end if;

  if v_current.origen = 'excel' or v_current.registro_id is not null then
    raise exception 'Una salida importada no se elimina; debe corregirse de forma auditable'
      using errcode = '55000';
  end if;

  delete from public.salidas
  where id = p_salida_id
  returning id into v_deleted_id;

  return v_deleted_id;
end;
$$;

-- ---------------------------------------------------------------------
-- 6. Frontera de privilegios
-- ---------------------------------------------------------------------

revoke all on function public.salidas_rpc_autorizado(text, uuid) from public, anon, authenticated;
revoke all on function public.salidas_rpc_bloquear_territorios(uuid[]) from public, anon, authenticated;
revoke all on function public.salidas_rpc_bloquear_grupos(uuid[]) from public, anon, authenticated;
revoke all on function public.salidas_rpc_validar_payload(text, uuid, uuid, uuid, uuid, text, numeric, numeric, timestamptz, text, boolean)
  from public, anon, authenticated;

revoke all on function public.crear_salida(text, text, uuid, uuid, uuid, uuid, text, numeric, numeric, timestamptz, text)
  from public, anon;
revoke all on function public.crear_salidas_lote(text, jsonb) from public, anon;
revoke all on function public.editar_salida(text, uuid, text, uuid, uuid, uuid, uuid, text, numeric, numeric, timestamptz, text)
  from public, anon;
revoke all on function public.borrar_salida(text, uuid) from public, anon;

grant execute on function public.crear_salida(text, text, uuid, uuid, uuid, uuid, text, numeric, numeric, timestamptz, text)
  to authenticated;
grant execute on function public.crear_salidas_lote(text, jsonb) to authenticated;
grant execute on function public.editar_salida(text, uuid, text, uuid, uuid, uuid, uuid, text, numeric, numeric, timestamptz, text)
  to authenticated;
grant execute on function public.borrar_salida(text, uuid) to authenticated;

-- RLS/policies de lectura y de defensa permanecen; authenticated ya no puede
-- saltarse estas validaciones con DML directo. service_role no se revoca.
revoke insert, update, delete on public.salidas from authenticated;

notify pgrst, 'reload schema';
commit;
