-- El programa guarda salidas comunes, telefónicas y excepciones en una sola
-- transacción. Las excepciones sobreviven al navegador y son visibles para
-- todos los administradores de la congregación.
begin;

create table if not exists public.programa_dias (
  fecha date primary key,
  motivo text not null check (length(btrim(motivo)) between 1 and 160),
  updated_at timestamptz not null default now(),
  updated_by uuid references public.profiles(id) on delete set null
);

create table if not exists public.programa_filas_sin_salida (
  fecha date not null,
  turno text not null check (turno in ('manana', 'tarde', 'telefono')),
  updated_at timestamptz not null default now(),
  updated_by uuid references public.profiles(id) on delete set null,
  primary key (fecha, turno)
);

alter table public.programa_dias enable row level security;
alter table public.programa_filas_sin_salida enable row level security;

drop policy if exists "Usuarios activos leen los dias del programa" on public.programa_dias;
drop policy if exists "Usuarios activos leen las filas sin salida" on public.programa_filas_sin_salida;
create policy "Usuarios activos leen los dias del programa"
  on public.programa_dias for select to authenticated
  using (public.es_usuario_activo());
create policy "Usuarios activos leen las filas sin salida"
  on public.programa_filas_sin_salida for select to authenticated
  using (public.es_usuario_activo());

revoke insert, update, delete on public.programa_dias from public, anon, authenticated;
revoke insert, update, delete on public.programa_filas_sin_salida from public, anon, authenticated;

create or replace function public.guardar_programa_periodo(
  p_salidas jsonb,
  p_dias jsonb,
  p_filas_sin_salida jsonb
)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_item jsonb;
  v_comunes jsonb := '[]'::jsonb;
  v_fecha date;
  v_motivo text;
  v_turno text;
  v_hora timestamptz;
  v_conductor uuid;
  v_guardadas integer := 0;
begin
  if not public.salidas_rpc_autorizado('general', null) then
    raise exception 'No tenés permiso para guardar el programa' using errcode = '42501';
  end if;
  if p_salidas is null or jsonb_typeof(p_salidas) <> 'array'
    or jsonb_array_length(p_salidas) > 500
    or p_dias is null or jsonb_typeof(p_dias) <> 'array'
    or jsonb_array_length(p_dias) > 31
    or p_filas_sin_salida is null or jsonb_typeof(p_filas_sin_salida) <> 'array'
    or jsonb_array_length(p_filas_sin_salida) > 93 then
    raise exception 'El programa tiene un formato o tamaño inválido' using errcode = '22023';
  end if;

  -- Validar primero las excepciones. Una banda "Sin salida" nunca puede
  -- ocultar salidas que ya figuran en la agenda.
  for v_item in select value from jsonb_array_elements(p_dias) loop
    if jsonb_typeof(v_item) is distinct from 'object'
      or jsonb_typeof(v_item->'fecha') is distinct from 'string'
      or (v_item ? 'motivo' and jsonb_typeof(v_item->'motivo') not in ('string', 'null')) then
      raise exception 'Día del programa inválido' using errcode = '22023';
    end if;
    v_fecha := (v_item->>'fecha')::date;
    v_motivo := nullif(btrim(v_item->>'motivo'), '');
    if v_motivo is not null and length(v_motivo) > 160 then
      raise exception 'El motivo del día es demasiado largo' using errcode = '22023';
    end if;
    if v_motivo is not null and exists (
      select 1 from public.salidas s
      where (s.scheduled_for at time zone 'America/Argentina/San_Juan')::date = v_fecha
        and s.group_id is null
    ) then
      raise exception 'Ese día ya tiene salidas en la agenda. Quitalas de la agenda antes de marcarlo sin salida'
        using errcode = '22023';
    end if;
    if v_motivo is not null and exists (
      select 1 from jsonb_array_elements(p_salidas) as items(value)
      where (value->>'scheduled_for')::timestamptz at time zone 'America/Argentina/San_Juan' >= v_fecha
        and (value->>'scheduled_for')::timestamptz at time zone 'America/Argentina/San_Juan' < v_fecha + 1
    ) then
      raise exception 'Un día sin salida no puede incluir salidas nuevas' using errcode = '22023';
    end if;
  end loop;

  for v_item in select value from jsonb_array_elements(p_filas_sin_salida) loop
    if jsonb_typeof(v_item) is distinct from 'object'
      or jsonb_typeof(v_item->'fecha') is distinct from 'string'
      or jsonb_typeof(v_item->'turno') is distinct from 'string'
      or jsonb_typeof(v_item->'sin_salida') is distinct from 'boolean' then
      raise exception 'Fila sin salida inválida' using errcode = '22023';
    end if;
    v_fecha := (v_item->>'fecha')::date;
    v_turno := v_item->>'turno';
    if v_turno not in ('manana', 'tarde', 'telefono') then
      raise exception 'Turno inválido en la excepción' using errcode = '22023';
    end if;
  end loop;

  for v_item in select value from jsonb_array_elements(p_salidas) loop
    if jsonb_typeof(v_item) is distinct from 'object' then
      raise exception 'Salida inválida' using errcode = '22023';
    end if;
    if v_item->>'tipo' = 'telefonica' then
      if jsonb_typeof(v_item->'scheduled_for') is distinct from 'string'
        or jsonb_typeof(v_item->'driver_id') is distinct from 'string'
        or v_item->>'title' <> 'PREDICACION TELEFONICA'
        or v_item->>'territory_id' is not null
        or v_item->>'meeting_point_id' is not null then
        raise exception 'La salida telefónica necesita fecha y conductor, sin territorio ni punto'
          using errcode = '22023';
      end if;
      v_hora := (v_item->>'scheduled_for')::timestamptz;
      v_conductor := (v_item->>'driver_id')::uuid;
      if not exists (select 1 from public.conductores where id = v_conductor) then
        raise exception 'El conductor telefónico no existe' using errcode = '23503';
      end if;
      if exists (
        select 1 from public.salidas
        where tipo = 'telefonica' and scheduled_for = v_hora and group_id is null
      ) then
        raise exception 'La salida telefónica ya está en la agenda' using errcode = '22023';
      end if;
      insert into public.salidas (
        title, territory_id, driver_id, group_id, meeting_point_name,
        scheduled_for, tipo, territorio_codigo
      ) values (
        'PREDICACION TELEFONICA', null, v_conductor, null,
        'Cada uno desde su casa', v_hora, 'telefonica', 'TEL'
      );
      v_guardadas := v_guardadas + 1;
    elsif v_item->>'tipo' = 'territorial' then
      v_comunes := v_comunes || (v_item - 'tipo');
    else
      raise exception 'Tipo de salida del programa inválido' using errcode = '22023';
    end if;
  end loop;

  if jsonb_array_length(v_comunes) > 0 then
    select count(*) into v_guardadas
    from public.crear_salidas_lote('general', v_comunes);
    v_guardadas := v_guardadas + (
      select count(*) from jsonb_array_elements(p_salidas) as items(value)
      where value->>'tipo' = 'telefonica'
    );
  end if;

  for v_item in select value from jsonb_array_elements(p_dias) loop
    v_fecha := (v_item->>'fecha')::date;
    v_motivo := nullif(btrim(v_item->>'motivo'), '');
    if v_motivo is null then
      delete from public.programa_dias where fecha = v_fecha;
    else
      insert into public.programa_dias (fecha, motivo, updated_by)
      values (v_fecha, v_motivo, auth.uid())
      on conflict (fecha) do update set motivo = excluded.motivo,
        updated_at = now(), updated_by = excluded.updated_by;
    end if;
  end loop;

  for v_item in select value from jsonb_array_elements(p_filas_sin_salida) loop
    v_fecha := (v_item->>'fecha')::date;
    v_turno := v_item->>'turno';
    if (v_item->>'sin_salida')::boolean then
      insert into public.programa_filas_sin_salida (fecha, turno, updated_by)
      values (v_fecha, v_turno, auth.uid())
      on conflict (fecha, turno) do update set updated_at = now(), updated_by = excluded.updated_by;
    else
      delete from public.programa_filas_sin_salida
      where fecha = v_fecha and turno = v_turno;
    end if;
  end loop;

  return v_guardadas;
end;
$$;

revoke all on function public.guardar_programa_periodo(jsonb, jsonb, jsonb) from public, anon;
grant execute on function public.guardar_programa_periodo(jsonb, jsonb, jsonb) to authenticated;

notify pgrst, 'reload schema';
commit;
