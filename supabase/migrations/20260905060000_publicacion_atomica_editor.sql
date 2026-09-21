begin;
alter table public.territorios add column if not exists editor_revision integer not null default 0;
create or replace function public.cargar_manzanas_de_territorio(p_name text,p_manzanas jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_terr       uuid;
  v_instante timestamptz;
  v_con_cob    integer := 0;
  v_mz         jsonb;
  v_lado       jsonb;
  v_id         uuid;
  v_ver        integer;
  v_n_mz       integer := 0;
  v_n_lados    integer := 0;
  v_retiradas  integer := 0;
  v_borradas   integer := 0;
begin
  -- auth.uid() es null cuando llama la clave de servicio (el script de
  -- carga). Un admin desde el navegador pasa por is_admin. Cualquier
  -- otro, no.
  if auth.uid() is not null and not public.is_admin(auth.uid()) then
    raise exception 'Solo un administrador puede cargar el dibujo de un territorio.';
  end if;

  select id into v_terr from territorios where lower(name) = lower(p_name) for update;
  if v_terr is null then
    raise exception 'No existe el territorio "%"', p_name;
  end if;

  v_instante := clock_timestamp();
  if jsonb_typeof(p_manzanas) is distinct from 'array' then raise exception 'Manzanas inválidas' using errcode='22023';end if;

  select greatest(coalesce(max(geometry_version), 0), (select editor_revision from territorios where id=v_terr)) + 1 into v_ver
  from territorio_manzanas where territory_id = v_terr;

  select count(distinct l.id) into v_con_cob
  from manzana_lados l join cobertura_eventos e on e.lado_id=l.id
  where l.territory_id=v_terr and l.vigente_hasta is null;
  update manzana_lados set vigente_hasta=v_instante
  where territory_id=v_terr and vigente_hasta is null;
  update territorio_manzanas set vigente_hasta=v_instante,updated_at=v_instante
  where territory_id=v_terr and vigente_hasta is null;
  get diagnostics v_retiradas=row_count;

  for v_mz in select value from jsonb_array_elements(p_manzanas) loop
    insert into territorio_manzanas
      (territory_id, label, lat, lng, geometry_geojson, area_m2, orden, geometry_version, updated_at, vigente_desde)
    values
      (v_terr,
       v_mz ->> 'label',
       (v_mz ->> 'lat')::numeric,
       (v_mz ->> 'lng')::numeric,
       v_mz -> 'geom',
       (v_mz ->> 'area_m2')::numeric,
       (v_mz ->> 'orden')::integer,
       v_ver,
       v_instante, v_instante)
    returning id into v_id;
    v_n_mz := v_n_mz + 1;

    for v_lado in select value from jsonb_array_elements(v_mz -> 'lados') loop
      insert into manzana_lados
        (manzana_id, territory_id, orden, geometry_geojson, largo_m, rumbo_grados,
         medio_lat, medio_lng, geometry_version, vigente_desde)
      values
        (v_id, v_terr,
         (v_lado ->> 'orden')::integer,
         v_lado -> 'geom',
         (v_lado ->> 'largo_m')::numeric,
         (v_lado ->> 'rumbo_grados')::numeric,
         (v_lado ->> 'medio_lat')::numeric,
         (v_lado ->> 'medio_lng')::numeric,
         v_ver, v_instante);
      v_n_lados := v_n_lados + 1;
    end loop;
  end loop;

  update territorios set updated_at = v_instante, editor_revision=v_ver where id = v_terr;

  return jsonb_build_object(
    'territorio', p_name,
    'version', v_ver,
    'manzanas_borradas', v_borradas,
    'manzanas_retiradas', v_retiradas,
    'lados_con_cobertura_retirados', v_con_cob,
    'manzanas', v_n_mz,
    'lados', v_n_lados
  );
end;
$$;

create or replace function public.revisar_publicacion_editor(p_nombres text[])
returns jsonb language plpgsql security definer set search_path=public as $$
declare result jsonb;
begin
 if not public.is_admin(auth.uid()) then raise exception 'Solo un administrador activo puede revisar la publicación' using errcode='42501';end if;
 if p_nombres is null or cardinality(p_nombres)=0 or cardinality(p_nombres)>200 then raise exception 'Lista de territorios inválida' using errcode='22023';end if;
 if exists(select 1 from unnest(p_nombres) n where n is null or (select count(*) from territorios t where lower(t.name)=lower(n))<>1) then
  raise exception 'Territorio inexistente o ambiguo' using errcode='22023';end if;
 select jsonb_agg(jsonb_build_object('nombre',t.name,'id',t.id,
   'version',greatest(t.editor_revision,coalesce((select max(m.geometry_version) from territorio_manzanas m where m.territory_id=t.id),0)),
   'manzanas_vigentes',(select count(*) from territorio_manzanas m where m.territory_id=t.id and m.vigente_hasta is null),
   'eventos',(select count(*) from cobertura_eventos e where e.territory_id=t.id)) order by t.id)
 into result from territorios t where lower(t.name) in(select lower(n) from unnest(p_nombres) n);
 return result;
end $$;

create or replace function public.publicar_territorios_atomico(p_territorios jsonb)
returns jsonb language plpgsql security definer set search_path=public as $$
declare item jsonb; bloqueado record; version_actual integer; result jsonb:='[]'; respuesta jsonb;
begin
 if not public.is_admin(auth.uid()) then raise exception 'Solo un administrador activo puede publicar' using errcode='42501';end if;
 if jsonb_typeof(p_territorios) is distinct from 'array' or jsonb_array_length(p_territorios)=0 or jsonb_array_length(p_territorios)>200 then
  raise exception 'Publicación inválida' using errcode='22023';end if;
 if exists(select 1 from jsonb_array_elements(p_territorios) x where jsonb_typeof(x->'manzanas') is distinct from 'array'
   or x->>'nombre' is null or x->>'version_esperada' is null
   or (select count(*) from territorios where lower(name)=lower(x->>'nombre'))<>1)
 or (select count(*) from jsonb_array_elements(p_territorios))<>(select count(distinct lower(x->>'nombre')) from jsonb_array_elements(p_territorios) x) then
  raise exception 'Territorio inexistente, repetido o incompleto' using errcode='22023';end if;
 -- Orden global de bloqueo: evita medias mudanzas y deadlocks entre lotes.
 for bloqueado in select id from territorios where lower(name) in(select lower(x->>'nombre') from jsonb_array_elements(p_territorios) x) order by id loop
  perform 1 from territorios where id=bloqueado.id for update;
 end loop;
 -- Validar todas las versiones antes de reemplazar la primera geometría.
 for item in select value from jsonb_array_elements(p_territorios) loop
  select greatest(t.editor_revision,coalesce((select max(m.geometry_version) from territorio_manzanas m where m.territory_id=t.id),0))
   into version_actual from territorios t where lower(t.name)=lower(item->>'nombre');
  if version_actual<>(item->>'version_esperada')::integer then
   raise exception 'El territorio % cambió desde la revisión. No se publicó ningún territorio.',item->>'nombre' using errcode='40001';
  end if;
 end loop;
 for item in select value from jsonb_array_elements(p_territorios) loop
  respuesta:=public.cargar_manzanas_de_territorio(item->>'nombre',item->'manzanas');
  result:=result||jsonb_build_array(respuesta);
 end loop;
 return result;
end $$;
revoke all on function public.revisar_publicacion_editor(text[]), public.publicar_territorios_atomico(jsonb) from public,anon;
grant execute on function public.revisar_publicacion_editor(text[]), public.publicar_territorios_atomico(jsonb) to authenticated;
-- El navegador debe pasar por el lote y sus locks. La función interna sigue
-- disponible para su propietario y el script de carga con service role.
revoke execute on function public.cargar_manzanas_de_territorio(text,jsonb) from public,anon,authenticated;
notify pgrst,'reload schema';
commit;
