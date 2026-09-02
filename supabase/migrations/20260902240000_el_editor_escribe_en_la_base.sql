-- =====================================================================
-- Que el editor de manzanas pueda guardar, y que el sector no se pierda
--
-- 1) `cargar_manzanas_de_territorio` estaba revocada a `authenticated`.
--    El argumento era "el navegador no reemplaza el dibujo de un
--    territorio". Ya no se sostiene: el editor de manzanas ES un
--    navegador, y el que lo usa es un admin. Es el mismo nivel de
--    confianza que el botón de borrar manzana que ya tiene hoy.
--    Se abre, pero con el chequeo adentro: security definer + is_admin,
--    igual que retirar_manzana. Quien no es admin sigue sin poder.
--
-- 2) El editor maneja Sector I/II/III, sacado del PDF oficial de la
--    congregación. En la base no existe la columna. Cargar el dibujo
--    hoy pierde el sector en silencio, que es la peor forma de
--    perderlo.
-- =====================================================================

begin;

alter table territorios add column if not exists sector text;

comment on column territorios.sector is
  'Sector de la congregación (I, II, III). Sale del PDF "Mapa x Sectores"; no se deduce de la geometría.';

create index if not exists territorios_sector_idx on territorios (sector);

create or replace function public.cargar_manzanas_de_territorio(
  p_name text,
  p_manzanas jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_terr       uuid;
  v_eventos    integer;
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

  select id into v_terr from territorios where lower(name) = lower(p_name);
  if v_terr is null then
    raise exception 'No existe el territorio "%"', p_name;
  end if;

  select count(*) into v_eventos from cobertura_eventos where territory_id = v_terr;

  select coalesce(max(geometry_version), 0) + 1 into v_ver
  from territorio_manzanas where territory_id = v_terr;

  if v_eventos = 0 then
    select count(*) into v_borradas from territorio_manzanas where territory_id = v_terr;
    delete from manzana_lados where territory_id = v_terr;
    delete from territorio_manzanas where territory_id = v_terr;
  else
    select count(distinct l.id) into v_con_cob
    from manzana_lados l
    join cobertura_eventos e on e.lado_id = l.id
    where l.territory_id = v_terr and l.vigente_hasta is null;

    update manzana_lados set vigente_hasta = now()
    where territory_id = v_terr and vigente_hasta is null;

    update territorio_manzanas set vigente_hasta = now(), updated_at = now()
    where territory_id = v_terr and vigente_hasta is null;
    get diagnostics v_retiradas = row_count;
  end if;

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
       v_ver,
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
         v_ver);
      v_n_lados := v_n_lados + 1;
    end loop;
  end loop;

  update territorios set updated_at = now() where id = v_terr;

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

revoke all on function public.cargar_manzanas_de_territorio(text, jsonb) from public;
revoke all on function public.cargar_manzanas_de_territorio(text, jsonb) from anon;
grant execute on function public.cargar_manzanas_de_territorio(text, jsonb) to authenticated;

commit;
