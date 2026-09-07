-- Publicación del taller por UUID, con revisión optimista, locks estables y auditoría.
-- Aditiva: las RPC v1 siguen disponibles para el editor HTML durante la transición.

begin;

create table if not exists public.editor_publicaciones_historial (
  id uuid primary key default gen_random_uuid(),
  operation_id uuid not null unique,
  solicitud_hash text not null,
  actor_id uuid references public.profiles(id) on delete set null,
  territory_ids uuid[] not null,
  versiones_antes jsonb not null,
  resultado jsonb not null,
  creado_at timestamptz not null default clock_timestamp(),
  check (cardinality(territory_ids) between 1 and 200),
  check (jsonb_typeof(versiones_antes) = 'array'),
  check (jsonb_typeof(resultado) = 'array')
);

alter table public.editor_publicaciones_historial enable row level security;
drop policy if exists "Admins leen publicaciones del editor" on public.editor_publicaciones_historial;
create policy "Admins leen publicaciones del editor"
on public.editor_publicaciones_historial for select to authenticated
using (public.es_admin_territorios(auth.uid()));
revoke all on table public.editor_publicaciones_historial from public, anon, authenticated;
grant select on table public.editor_publicaciones_historial to authenticated;

create or replace function public.revisar_publicacion_editor_v2(p_territory_ids uuid[])
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
set row_security = off
as $$
declare
  v_resultado jsonb;
begin
  if not public.es_admin_territorios(auth.uid()) then
    raise exception 'Solo un administrador territorial activo puede revisar la publicación'
      using errcode = '42501';
  end if;
  if p_territory_ids is null
    or cardinality(p_territory_ids) < 1
    or cardinality(p_territory_ids) > 200
    or array_position(p_territory_ids, null) is not null
    or cardinality(p_territory_ids) <> (
      select count(distinct id) from unnest(p_territory_ids) as ids(id)
    )
    or cardinality(p_territory_ids) <> (
      select count(*) from public.territorios where id = any(p_territory_ids)
    ) then
    raise exception 'Lista de UUID de territorios inválida, repetida o inexistente'
      using errcode = '22023';
  end if;

  select jsonb_agg(
    jsonb_build_object(
      'territory_id', t.id,
      'nombre', t.name,
      'version', greatest(
        t.editor_revision,
        coalesce((
          select max(m.geometry_version)
          from public.territorio_manzanas m
          where m.territory_id = t.id
        ), 0)
      ),
      'manzanas_vigentes', (
        select count(*)
        from public.territorio_manzanas m
        where m.territory_id = t.id and m.vigente_hasta is null
      ),
      'lados_vigentes_con_cobertura', (
        select count(distinct l.id)
        from public.manzana_lados l
        join public.cobertura_eventos e on e.lado_id = l.id
        where l.territory_id = t.id and l.vigente_hasta is null
      ),
      'eventos_historicos', (
        select count(*) from public.cobertura_eventos e where e.territory_id = t.id
      )
    ) order by t.id
  ) into v_resultado
  from public.territorios t
  where t.id = any(p_territory_ids);

  return v_resultado;
end;
$$;

create or replace function public.publicar_territorios_atomico_v2(
  p_operation_id uuid,
  p_cambios jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
set row_security = off
as $$
declare
  v_item jsonb;
  v_manzana jsonb;
  v_lado jsonb;
  v_bloqueado record;
  v_territory_id uuid;
  v_manzana_id uuid;
  v_instante timestamptz := clock_timestamp();
  v_version_actual integer;
  v_version_nueva integer;
  v_retiradas integer;
  v_lados_retirados integer;
  v_lados_con_cobertura integer;
  v_manzanas_nuevas integer;
  v_lados_nuevos integer;
  v_resultado jsonb := '[]'::jsonb;
  v_resultado_previo jsonb;
  v_versiones_antes jsonb := '[]'::jsonb;
  v_ids uuid[];
  v_solicitud_hash text;
begin
  if not public.es_admin_territorios(auth.uid()) then
    raise exception 'Solo un administrador territorial activo puede publicar'
      using errcode = '42501';
  end if;
  if p_operation_id is null
    or jsonb_typeof(p_cambios) is distinct from 'array'
    or jsonb_array_length(p_cambios) < 1
    or jsonb_array_length(p_cambios) > 200
    or pg_column_size(p_cambios) > 20971520 then
    raise exception 'Publicación inválida' using errcode = '22023';
  end if;

  v_solicitud_hash := md5(p_cambios::text);
  -- Dos reintentos de la misma operación se serializan antes de tocar territorios.
  perform pg_advisory_xact_lock(hashtextextended(p_operation_id::text, 0));
  select resultado into v_resultado_previo
  from public.editor_publicaciones_historial
  where operation_id = p_operation_id and solicitud_hash = v_solicitud_hash;
  if found then return v_resultado_previo; end if;
  if exists (
    select 1 from public.editor_publicaciones_historial where operation_id = p_operation_id
  ) then
    raise exception 'El identificador de operación ya se usó con otro lote'
      using errcode = '22023';
  end if;

  begin
    select array_agg((item ->> 'territory_id')::uuid order by (item ->> 'territory_id')::uuid)
    into v_ids
    from jsonb_array_elements(p_cambios) as cambios(item);
  exception when invalid_text_representation then
    raise exception 'La publicación contiene un UUID territorial inválido' using errcode = '22023';
  end;

  if cardinality(v_ids) <> (select count(distinct id) from unnest(v_ids) as ids(id))
    or cardinality(v_ids) <> (select count(*) from public.territorios where id = any(v_ids))
    or exists (
      select 1
      from jsonb_array_elements(p_cambios) as cambios(item)
      where jsonb_typeof(item) is distinct from 'object'
        or item ->> 'territory_id' is null
        or item ->> 'version_esperada' is null
        or (item ->> 'version_esperada') !~ '^[0-9]+$'
        or length(item ->> 'version_esperada') > 10
        or jsonb_typeof(item -> 'manzanas') is distinct from 'array'
        or jsonb_array_length(item -> 'manzanas') > 1000
    ) then
    raise exception 'Territorio inexistente, repetido o lote incompleto'
      using errcode = '22023';
  end if;

  -- Validación estructural completa antes de tomar locks o retirar geometrías.
  for v_item in select value from jsonb_array_elements(p_cambios) loop
    if exists (
      select 1
      from jsonb_array_elements(v_item -> 'manzanas') as manzanas(manzana)
      where jsonb_typeof(manzana) is distinct from 'object'
        or nullif(btrim(manzana ->> 'label'), '') is null
        or length(btrim(manzana ->> 'label')) > 30
        or jsonb_typeof(manzana -> 'orden') is distinct from 'number'
        or (manzana ->> 'orden') !~ '^[0-9]+$'
        or jsonb_typeof(manzana -> 'lat') is distinct from 'number'
        or jsonb_typeof(manzana -> 'lng') is distinct from 'number'
        or jsonb_typeof(manzana -> 'area_m2') is distinct from 'number'
        or jsonb_typeof(manzana -> 'geom') is distinct from 'object'
        or manzana -> 'geom' ->> 'type' is distinct from 'Polygon'
        or jsonb_typeof(manzana -> 'geom' -> 'coordinates') is distinct from 'array'
        or jsonb_array_length(manzana -> 'geom' -> 'coordinates') <> 1
        or jsonb_typeof(manzana -> 'geom' -> 'coordinates' -> 0) is distinct from 'array'
        or jsonb_array_length(manzana -> 'geom' -> 'coordinates' -> 0) < 4
        or manzana -> 'geom' -> 'coordinates' -> 0 -> 0
          is distinct from manzana -> 'geom' -> 'coordinates' -> 0 -> -1
        or jsonb_typeof(manzana -> 'lados') is distinct from 'array'
        or jsonb_array_length(manzana -> 'lados') > 100
    ) then
      raise exception 'La publicación contiene una manzana incompleta o inválida'
        using errcode = '22023';
    end if;

    begin
      if exists (
        select 1
        from jsonb_array_elements(v_item -> 'manzanas') as manzanas(manzana)
        where (manzana ->> 'orden')::numeric > 2147483647
          or (manzana ->> 'lat')::numeric not between -90 and 90
          or (manzana ->> 'lng')::numeric not between -180 and 180
          or (manzana ->> 'area_m2')::numeric < 0
      ) then
        raise exception 'La publicación contiene coordenadas o áreas fuera de rango'
          using errcode = '22023';
      end if;
    exception when invalid_text_representation or numeric_value_out_of_range then
      raise exception 'La publicación contiene números inválidos' using errcode = '22023';
    end;

    if exists (
      select 1
      from jsonb_array_elements(v_item -> 'manzanas') as manzanas(manzana),
           jsonb_array_elements(manzana -> 'geom' -> 'coordinates' -> 0) as puntos(punto)
      where jsonb_typeof(punto) is distinct from 'array'
        or jsonb_array_length(punto) < 2
        or jsonb_typeof(punto -> 0) is distinct from 'number'
        or jsonb_typeof(punto -> 1) is distinct from 'number'
    ) then
      raise exception 'La publicación contiene coordenadas de polígono inválidas'
        using errcode = '22023';
    end if;

    begin
      if exists (
        select 1
        from jsonb_array_elements(v_item -> 'manzanas') as manzanas(manzana),
             jsonb_array_elements(manzana -> 'geom' -> 'coordinates' -> 0) as puntos(punto)
        where (punto ->> 0)::numeric not between -180 and 180
          or (punto ->> 1)::numeric not between -90 and 90
      ) then
        raise exception 'La publicación contiene vértices fuera del rango geográfico'
          using errcode = '22023';
      end if;
    exception when invalid_text_representation or numeric_value_out_of_range then
      raise exception 'La publicación contiene vértices no numéricos' using errcode = '22023';
    end;

    if exists (
      select 1
      from jsonb_array_elements(v_item -> 'manzanas') as manzanas(manzana)
      group by lower(btrim(manzana ->> 'label'))
      having count(*) > 1
    ) then
      raise exception 'La publicación repite etiquetas dentro de un territorio'
        using errcode = '22023';
    end if;

    if exists (
      select 1
      from jsonb_array_elements(v_item -> 'manzanas') as manzanas(manzana),
           jsonb_array_elements(manzana -> 'lados') as lados(lado)
      where jsonb_typeof(lado) is distinct from 'object'
        or jsonb_typeof(lado -> 'orden') is distinct from 'number'
        or (lado ->> 'orden') !~ '^[0-9]+$'
        or jsonb_typeof(lado -> 'geom') is distinct from 'object'
        or lado -> 'geom' ->> 'type' is distinct from 'LineString'
        or jsonb_typeof(lado -> 'geom' -> 'coordinates') is distinct from 'array'
        or jsonb_array_length(lado -> 'geom' -> 'coordinates') < 2
        or jsonb_typeof(lado -> 'largo_m') is distinct from 'number'
        or jsonb_typeof(lado -> 'rumbo_grados') is distinct from 'number'
        or jsonb_typeof(lado -> 'medio_lat') is distinct from 'number'
        or jsonb_typeof(lado -> 'medio_lng') is distinct from 'number'
    ) then
      raise exception 'La publicación contiene un lado incompleto o inválido'
        using errcode = '22023';
    end if;

    if exists (
      select 1
      from jsonb_array_elements(v_item -> 'manzanas') as manzanas(manzana),
           jsonb_array_elements(manzana -> 'lados') as lados(lado),
           jsonb_array_elements(lado -> 'geom' -> 'coordinates') as puntos(punto)
      where jsonb_typeof(punto) is distinct from 'array'
        or jsonb_array_length(punto) < 2
        or jsonb_typeof(punto -> 0) is distinct from 'number'
        or jsonb_typeof(punto -> 1) is distinct from 'number'
    ) then
      raise exception 'La publicación contiene coordenadas de lado inválidas'
        using errcode = '22023';
    end if;

    if exists (
      select 1
      from jsonb_array_elements(v_item -> 'manzanas') as manzanas(manzana),
           jsonb_array_elements(manzana -> 'lados') as lados(lado)
      group by manzana, lado ->> 'orden'
      having count(*) > 1
    ) then
      raise exception 'La publicación repite el orden de un lado'
        using errcode = '22023';
    end if;

    begin
      if exists (
        select 1
        from jsonb_array_elements(v_item -> 'manzanas') as manzanas(manzana),
             jsonb_array_elements(manzana -> 'lados') as lados(lado)
        where (lado ->> 'orden')::numeric > 2147483647
          or (lado ->> 'largo_m')::numeric < 0
          or (lado ->> 'rumbo_grados')::numeric not between -360 and 360
          or (lado ->> 'medio_lat')::numeric not between -90 and 90
          or (lado ->> 'medio_lng')::numeric not between -180 and 180
      ) then
        raise exception 'La publicación contiene datos de lado fuera de rango'
          using errcode = '22023';
      end if;
    exception when invalid_text_representation or numeric_value_out_of_range then
      raise exception 'La publicación contiene números de lado inválidos' using errcode = '22023';
    end;
  end loop;

  begin
    if exists (
      select 1 from jsonb_array_elements(p_cambios) as cambios(item)
      where (item ->> 'version_esperada')::numeric > 2147483647
    ) then
      raise exception 'La publicación contiene una versión fuera de rango'
        using errcode = '22023';
    end if;
  exception when invalid_text_representation or numeric_value_out_of_range then
    raise exception 'La publicación contiene una versión inválida' using errcode = '22023';
  end;

  -- Un orden global evita deadlocks entre dos lotes que comparten territorios.
  for v_bloqueado in
    select id from public.territorios where id = any(v_ids) order by id
  loop
    perform 1 from public.territorios where id = v_bloqueado.id for update;
  end loop;
  if cardinality(v_ids) <> (
    select count(*) from public.territorios where id = any(v_ids)
  ) then
    raise exception 'Un territorio fue retirado antes de obtener el lock. No se publicó nada.'
      using errcode = '40001';
  end if;

  -- Ninguna geometría cambia hasta comprobar todas las revisiones.
  for v_item in select value from jsonb_array_elements(p_cambios) loop
    v_territory_id := (v_item ->> 'territory_id')::uuid;
    select greatest(
      t.editor_revision,
      coalesce((
        select max(m.geometry_version)
        from public.territorio_manzanas m
        where m.territory_id = t.id
      ), 0)
    ) into v_version_actual
    from public.territorios t
    where t.id = v_territory_id;

    if v_version_actual <> (v_item ->> 'version_esperada')::integer then
      raise exception 'El territorio UUID % cambió desde la revisión. No se publicó ningún territorio.',
        v_territory_id using errcode = '40001';
    end if;
    v_versiones_antes := v_versiones_antes || jsonb_build_array(jsonb_build_object(
      'territory_id', v_territory_id,
      'version', v_version_actual
    ));
  end loop;

  for v_item in select value from jsonb_array_elements(p_cambios) loop
    v_territory_id := (v_item ->> 'territory_id')::uuid;
    select greatest(
      t.editor_revision,
      coalesce((
        select max(m.geometry_version)
        from public.territorio_manzanas m
        where m.territory_id = t.id
      ), 0)
    ) + 1 into v_version_nueva
    from public.territorios t
    where t.id = v_territory_id;

    select count(distinct l.id) into v_lados_con_cobertura
    from public.manzana_lados l
    join public.cobertura_eventos e on e.lado_id = l.id
    where l.territory_id = v_territory_id and l.vigente_hasta is null;

    update public.manzana_lados
    set vigente_hasta = v_instante
    where territory_id = v_territory_id and vigente_hasta is null;
    get diagnostics v_lados_retirados = row_count;

    update public.territorio_manzanas
    set vigente_hasta = v_instante, updated_at = v_instante
    where territory_id = v_territory_id and vigente_hasta is null;
    get diagnostics v_retiradas = row_count;

    v_manzanas_nuevas := 0;
    v_lados_nuevos := 0;
    for v_manzana in select value from jsonb_array_elements(v_item -> 'manzanas') loop
      insert into public.territorio_manzanas (
        territory_id, label, lat, lng, geometry_geojson, area_m2, orden,
        geometry_version, updated_at, vigente_desde
      ) values (
        v_territory_id,
        btrim(v_manzana ->> 'label'),
        (v_manzana ->> 'lat')::numeric,
        (v_manzana ->> 'lng')::numeric,
        v_manzana -> 'geom',
        (v_manzana ->> 'area_m2')::numeric,
        (v_manzana ->> 'orden')::integer,
        v_version_nueva,
        v_instante,
        v_instante
      ) returning id into v_manzana_id;
      v_manzanas_nuevas := v_manzanas_nuevas + 1;

      for v_lado in select value from jsonb_array_elements(v_manzana -> 'lados') loop
        insert into public.manzana_lados (
          manzana_id, territory_id, orden, geometry_geojson, largo_m, rumbo_grados,
          medio_lat, medio_lng, geometry_version, vigente_desde
        ) values (
          v_manzana_id,
          v_territory_id,
          (v_lado ->> 'orden')::integer,
          v_lado -> 'geom',
          (v_lado ->> 'largo_m')::numeric,
          (v_lado ->> 'rumbo_grados')::numeric,
          (v_lado ->> 'medio_lat')::numeric,
          (v_lado ->> 'medio_lng')::numeric,
          v_version_nueva,
          v_instante
        );
        v_lados_nuevos := v_lados_nuevos + 1;
      end loop;
    end loop;

    update public.territorios
    set editor_revision = v_version_nueva, updated_at = v_instante
    where id = v_territory_id;

    v_resultado := v_resultado || jsonb_build_array(jsonb_build_object(
      'territory_id', v_territory_id,
      'version', v_version_nueva,
      'manzanas_retiradas', v_retiradas,
      'lados_retirados', v_lados_retirados,
      'lados_con_cobertura_retirados', v_lados_con_cobertura,
      'manzanas', v_manzanas_nuevas,
      'lados', v_lados_nuevos
    ));
  end loop;

  insert into public.editor_publicaciones_historial (
    operation_id, solicitud_hash, actor_id, territory_ids,
    versiones_antes, resultado, creado_at
  ) values (
    p_operation_id, v_solicitud_hash, auth.uid(), v_ids,
    v_versiones_antes, v_resultado, v_instante
  );

  return v_resultado;
end;
$$;

revoke all on function public.revisar_publicacion_editor_v2(uuid[]) from public, anon;
revoke all on function public.publicar_territorios_atomico_v2(uuid, jsonb) from public, anon;
grant execute on function public.revisar_publicacion_editor_v2(uuid[]) to authenticated;
grant execute on function public.publicar_territorios_atomico_v2(uuid, jsonb) to authenticated;

notify pgrst, 'reload schema';
commit;
