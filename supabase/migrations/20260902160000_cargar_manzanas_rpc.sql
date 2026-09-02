-- =====================================================================
-- Carga atómica de las manzanas de un territorio, con sus lados
--
-- Por qué una función y no llamadas sueltas desde el script:
--
-- PostgREST no tiene transacciones entre pedidos. La primera versión del
-- cargador cerraba los lados vigentes en un pedido y creaba los nuevos en
-- otro; cuando el segundo falló, quedaron 508 manzanas con los lados
-- cerrados y ninguno nuevo. Una función corre entera en una transacción:
-- o queda todo el territorio o no queda nada.
--
-- Idempotente: volver a llamarla reemplaza lo que haya.
--
-- Y tiene un freno: si alguna manzana del territorio ya tiene cobertura
-- informada, se niega. El trabajo de alguien que caminó la calle vale
-- más que una recarga cómoda.
-- =====================================================================

begin;

create or replace function public.cargar_manzanas_de_territorio(
  p_name text,
  p_manzanas jsonb
)
returns jsonb
language plpgsql
as $$
declare
  v_terr      uuid;
  v_eventos   integer;
  v_mz        jsonb;
  v_lado      jsonb;
  v_id        uuid;
  v_n_mz      integer := 0;
  v_n_lados   integer := 0;
  v_borradas  integer := 0;
begin
  select id into v_terr from territorios where lower(name) = lower(p_name);
  if v_terr is null then
    raise exception 'No existe el territorio "%"', p_name;
  end if;

  select count(*) into v_eventos from cobertura_eventos where territory_id = v_terr;
  if v_eventos > 0 then
    raise exception 'El territorio "%" ya tiene % eventos de cobertura informados; no se reemplaza.',
      p_name, v_eventos;
  end if;

  select count(*) into v_borradas from territorio_manzanas where territory_id = v_terr;

  delete from manzana_lados where territory_id = v_terr;
  delete from territorio_manzanas where territory_id = v_terr;

  for v_mz in select value from jsonb_array_elements(p_manzanas) loop
    insert into territorio_manzanas
      (territory_id, label, lat, lng, geometry_geojson, area_m2, orden, geometry_version, updated_at)
    values
      (v_terr,
       v_mz ->> 'label',
       (v_mz ->> 'lat')::numeric,
       (v_mz ->> 'lng')::numeric,
       v_mz -> 'geom',
       (v_mz ->> 'area_m2')::numeric,
       (v_mz ->> 'orden')::integer,
       1,
       now())
    returning id into v_id;
    v_n_mz := v_n_mz + 1;

    for v_lado in select value from jsonb_array_elements(v_mz -> 'lados') loop
      insert into manzana_lados
        (manzana_id, territory_id, orden, geometry_geojson, largo_m, rumbo_grados,
         medio_lat, medio_lng, geometry_version)
      values
        (v_id, v_terr,
         (v_lado ->> 'orden')::integer,
         v_lado -> 'geom',
         (v_lado ->> 'largo_m')::numeric,
         (v_lado ->> 'rumbo_grados')::numeric,
         (v_lado ->> 'medio_lat')::numeric,
         (v_lado ->> 'medio_lng')::numeric,
         1);
      v_n_lados := v_n_lados + 1;
    end loop;
  end loop;

  update territorios set updated_at = now() where id = v_terr;

  return jsonb_build_object(
    'territorio', p_name,
    'manzanas_borradas', v_borradas,
    'manzanas', v_n_mz,
    'lados', v_n_lados
  );
end;
$$;

-- Solo la clave de servicio. Ningún usuario de la app puede reemplazar
-- las manzanas de un territorio desde el navegador.
revoke all on function public.cargar_manzanas_de_territorio(text, jsonb) from public;
revoke all on function public.cargar_manzanas_de_territorio(text, jsonb) from anon;
revoke all on function public.cargar_manzanas_de_territorio(text, jsonb) from authenticated;

commit;
