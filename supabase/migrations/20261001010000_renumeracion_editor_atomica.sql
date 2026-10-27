begin;

-- Renumerar conserva UUID y relaciones. La publicación y los nombres se
-- confirman juntos; cualquier conflicto revierte también la renumeración.
create or replace function public.publicar_editor_con_renumeracion(
  p_territorios jsonb, p_renumeraciones jsonb
) returns jsonb
language plpgsql security definer set search_path = public
as $$
declare
  cambio jsonb;
  bloqueado record;
  anterior text;
  item jsonb;
  territorio uuid;
  version_actual integer;
  dibujo_actual jsonb;
  dibujo_enviado jsonb;
  resultado jsonb := '[]';
  respuesta jsonb;
begin
  if not public.is_admin(auth.uid()) then
    raise exception 'Solo un administrador activo puede renumerar' using errcode='42501';
  end if;
  if jsonb_typeof(p_renumeraciones) is distinct from 'array'
     or jsonb_array_length(p_renumeraciones) not between 0 and 200
     or jsonb_typeof(p_territorios) is distinct from 'array'
     or jsonb_array_length(p_territorios) not between 1 and 200 then
    raise exception 'Renumeración inválida' using errcode='22023';
  end if;
  if exists(select 1 from jsonb_array_elements(p_territorios) x
    where jsonb_typeof(x->'manzanas') is distinct from 'array'
      or x->>'nombre' is null or x->>'version_esperada' is null
      or (x ? 'color' and (x->>'color' is null or x->>'color' !~ '^#[0-9a-fA-F]{6}$')))
    or jsonb_array_length(p_territorios) <>
       (select count(distinct lower(x->>'nombre')) from jsonb_array_elements(p_territorios) x) then
    raise exception 'Publicación incompleta o repetida' using errcode='22023';
  end if;
  if exists(select 1 from jsonb_array_elements(p_renumeraciones) x
    where x->>'id' is null or nullif(btrim(x->>'nombre_anterior'),'') is null
      or nullif(btrim(x->>'nombre_nuevo'),'') is null
      or length(x->>'nombre_nuevo') > 40
      or x->>'nombre_nuevo' <> btrim(x->>'nombre_nuevo')
      or (select count(*) from jsonb_array_elements(p_territorios) t
          where lower(t->>'nombre')=lower(x->>'nombre_nuevo')) <> 1)
    or (select count(*) from jsonb_array_elements(p_renumeraciones)) <>
       (select count(distinct x->>'id') from jsonb_array_elements(p_renumeraciones) x)
    or (select count(*) from jsonb_array_elements(p_renumeraciones)) <>
       (select count(distinct lower(x->>'nombre_nuevo')) from jsonb_array_elements(p_renumeraciones) x) then
    raise exception 'Cambios de número incompletos o repetidos' using errcode='22023';
  end if;

  -- Mismo orden global de locks que la publicación existente, incluidos
  -- los dueños actuales de los números de destino.
  for bloqueado in select t.id from public.territorios t
    where t.id in (select (x->>'id')::uuid from jsonb_array_elements(p_renumeraciones) x)
      or lower(t.name) in (select lower(x->>'nombre') from jsonb_array_elements(p_territorios) x)
    order by t.id
  loop
    perform 1 from public.territorios where id=bloqueado.id for update;
  end loop;
  for cambio in select value from jsonb_array_elements(p_renumeraciones) loop
    select name into anterior from public.territorios where id=(cambio->>'id')::uuid;
    if anterior is null or anterior <> cambio->>'nombre_anterior' then
      raise exception 'El territorio % cambió de número. No se guardó ningún cambio.', cambio->>'nombre_anterior'
        using errcode='40001';
    end if;
    if exists(select 1 from public.territorios t
      where lower(t.name)=lower(cambio->>'nombre_nuevo')
        and t.id not in (select (x->>'id')::uuid from jsonb_array_elements(p_renumeraciones) x)) then
      raise exception 'El número % está ocupado por otro territorio', cambio->>'nombre_nuevo'
        using errcode='23505';
    end if;
  end loop;

  -- Nombres transitorios dentro de la transacción para satisfacer el índice
  -- único aun al intercambiar números. Nunca son visibles fuera de ella.
  for cambio in select value from jsonb_array_elements(p_renumeraciones) loop
    update public.territorios set name='__renumerar_' || id::text
      where id=(cambio->>'id')::uuid;
  end loop;
  for cambio in select value from jsonb_array_elements(p_renumeraciones) loop
    update public.territorios
      set name=cambio->>'nombre_nuevo',
          code_text=case when code_text=cambio->>'nombre_anterior'
                         then cambio->>'nombre_nuevo' else code_text end,
          updated_at=clock_timestamp()
      where id=(cambio->>'id')::uuid;
  end loop;
  -- Verificar el lote entero antes de tocar un dibujo.
  for item in select value from jsonb_array_elements(p_territorios) loop
    select t.id, greatest(t.editor_revision,
      coalesce((select max(m.geometry_version) from public.territorio_manzanas m where m.territory_id=t.id),0))
      into territorio, version_actual from public.territorios t where lower(t.name)=lower(item->>'nombre');
    if territorio is null then
      raise exception 'Territorio inexistente: %', item->>'nombre' using errcode='22023';
    end if;
    if version_actual <> (item->>'version_esperada')::integer then
      raise exception 'El territorio % cambió desde la revisión. No se guardó ningún cambio.', item->>'nombre'
        using errcode='40001';
    end if;
  end loop;
  for item in select value from jsonb_array_elements(p_territorios) loop
    select id into territorio from public.territorios where lower(name)=lower(item->>'nombre');
    if item ? 'color' then
      update public.territorios set polygon_geojson=jsonb_set(polygon_geojson,'{color}',item->'color',true)
        where id=territorio;
    end if;
    -- Si solo cambia el número, conservar también los IDs de manzanas y
    -- lados vigentes: la cobertura sigue ligada al mismo dibujo.
    select coalesce(jsonb_agg(jsonb_build_object(
      'label',m.label,'orden',m.orden,'geom',m.geometry_geojson,
      'lados',coalesce((select jsonb_agg(jsonb_build_object('orden',l.orden,'geom',l.geometry_geojson) order by l.orden,l.id)
        from public.manzana_lados l where l.manzana_id=m.id and l.vigente_hasta is null),'[]'::jsonb))
      order by m.orden,m.id),'[]'::jsonb)
      into dibujo_actual from public.territorio_manzanas m
      where m.territory_id=territorio and m.vigente_hasta is null;
    select coalesce(jsonb_agg(jsonb_build_object(
      'label',m->'label','orden',m->'orden','geom',m->'geom',
      'lados',coalesce((select jsonb_agg(jsonb_build_object('orden',l->'orden','geom',l->'geom') order by posicion)
        from jsonb_array_elements(m->'lados') with ordinality as lados(l,posicion)),'[]'::jsonb))
      order by posicion),'[]'::jsonb)
      into dibujo_enviado from jsonb_array_elements(item->'manzanas') with ordinality as manzanas(m,posicion);
    if dibujo_actual = dibujo_enviado then
      update public.territorios set editor_revision=(item->>'version_esperada')::integer+1,
        updated_at=clock_timestamp() where id=territorio;
      respuesta:=jsonb_build_object('territorio',item->>'nombre',
        'version',(item->>'version_esperada')::integer+1,
        'manzanas',jsonb_array_length(item->'manzanas'),
        'lados',(select count(*) from public.manzana_lados where territory_id=territorio and vigente_hasta is null));
    else
      respuesta:=public.publicar_territorios_atomico(jsonb_build_array(item))->0;
    end if;
    resultado:=resultado||jsonb_build_array(respuesta);
  end loop;
  return resultado;
end;
$$;
revoke all on function public.publicar_editor_con_renumeracion(jsonb,jsonb) from public,anon;
grant execute on function public.publicar_editor_con_renumeracion(jsonb,jsonb) to authenticated;
notify pgrst,'reload schema';
commit;
