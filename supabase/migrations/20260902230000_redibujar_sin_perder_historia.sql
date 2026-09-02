-- =====================================================================
-- Redibujar un territorio sin perder lo que ya se informó
--
-- `cargar_manzanas_de_territorio` se negaba a tocar un territorio que
-- tuviera cobertura. Era el freno correcto mientras no hubiera otra
-- forma de no perder nada, pero es un callejón: los territorios están a
-- medio dibujar (al 57 le faltan manzanas) y hay que poder corregirlos.
--
-- La salida ya estaba prevista en el diseño y no se usaba: los lados
-- tienen vigente_desde/vigente_hasta. Se retira lo viejo en vez de
-- borrarlo. Los eventos de cobertura siguen apuntando a los lados
-- retirados, que es donde ocurrieron, y el mapa deja de mostrarlos.
--
-- LO QUE ESTA MIGRACIÓN NO HACE, A PROPÓSITO: no arrastra la cobertura
-- vieja al dibujo nuevo. Se podría intentar por rumbo y punto medio,
-- pero ya vimos a qué se parece emparejar geometría a ojo en este
-- mismo repo: de 508 coincidencias por letra, 412 apuntaban a otra
-- manzana. La función informa cuántos lados con cobertura quedaron
-- retirados y esa decisión la toma una persona mirando el mapa.
-- =====================================================================

begin;

-- ---------------------------------------------------------------------
-- 1. La manzana también se retira, no solo el lado
-- ---------------------------------------------------------------------

alter table territorio_manzanas add column if not exists vigente_desde timestamptz not null default now();
alter table territorio_manzanas add column if not exists vigente_hasta timestamptz;

-- La unicidad de la etiqueta valía para siempre; ahora vale solo entre
-- las vigentes, si no la manzana "A" retirada impide crear la "A" nueva.
do $$
declare v_con text;
begin
  select conname into v_con
  from pg_constraint
  where conrelid = 'public.territorio_manzanas'::regclass
    and contype = 'u'
    and pg_get_constraintdef(oid) like '%territory_id%label%';
  if v_con is not null then
    execute format('alter table territorio_manzanas drop constraint %I', v_con);
  end if;
end
$$;

create unique index if not exists territorio_manzanas_vigente_unique_idx
  on territorio_manzanas (territory_id, label)
  where vigente_hasta is null;

create index if not exists territorio_manzanas_vigentes_idx
  on territorio_manzanas (territory_id) where vigente_hasta is null;

-- La vista contaba todas las manzanas. Una retirada aparecía como una
-- fila de cero lados y bajaba el porcentaje del territorio sin motivo.
create or replace view cobertura_manzana as
select
  m.id                as manzana_id,
  m.territory_id,
  m.label,
  m.area_m2,
  count(c.lado_id)                                             as lados,
  count(*) filter (where c.estado = 'recorrido')               as lados_hechos,
  count(*) filter (where c.estado = 'no_accesible')            as lados_inaccesibles,
  sum(c.largo_m)                                               as metros,
  sum(c.largo_m) filter (where c.estado = 'recorrido')         as metros_hechos,
  max(c.informado_at)                                          as ultima_marca
from territorio_manzanas m
left join cobertura_lado_actual c on c.manzana_id = m.id
where m.vigente_hasta is null
group by m.id, m.territory_id, m.label, m.area_m2;

do $$
begin
  if current_setting('server_version_num')::int >= 150000 then
    execute 'alter view cobertura_manzana set (security_invoker = on)';
  end if;
end
$$;

-- ---------------------------------------------------------------------
-- 2. Cargar ahora retira en vez de negarse
-- ---------------------------------------------------------------------

create or replace function public.cargar_manzanas_de_territorio(
  p_name text,
  p_manzanas jsonb
)
returns jsonb
language plpgsql
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
  select id into v_terr from territorios where lower(name) = lower(p_name);
  if v_terr is null then
    raise exception 'No existe el territorio "%"', p_name;
  end if;

  select count(*) into v_eventos from cobertura_eventos where territory_id = v_terr;

  -- La versión sube siempre: sirve para saber de qué dibujo salió cada
  -- lado, aunque el anterior se haya borrado.
  select coalesce(max(geometry_version), 0) + 1 into v_ver
  from territorio_manzanas where territory_id = v_terr;

  if v_eventos = 0 then
    -- Nada que preservar: se borra y queda limpio.
    select count(*) into v_borradas from territorio_manzanas where territory_id = v_terr;
    delete from manzana_lados where territory_id = v_terr;
    delete from territorio_manzanas where territory_id = v_terr;
  else
    -- Hay historia. Se retira; los eventos siguen apuntando a su lado.
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

comment on function public.cargar_manzanas_de_territorio(text, jsonb) is
  'Reemplaza el dibujo de un territorio. Si ya hay cobertura informada, retira el dibujo viejo en vez de borrarlo y avisa cuántos lados con cobertura quedaron atrás.';

revoke all on function public.cargar_manzanas_de_territorio(text, jsonb) from public;
revoke all on function public.cargar_manzanas_de_territorio(text, jsonb) from anon;
revoke all on function public.cargar_manzanas_de_territorio(text, jsonb) from authenticated;

-- ---------------------------------------------------------------------
-- 3. Retirar una manzana suelta desde la app
-- ---------------------------------------------------------------------
-- El botón de borrar del editor hace un DELETE. Con cobertura informada
-- eso choca contra la clave foránea y le tira al admin un error de
-- Postgres en la cara. Esto le da una salida honesta: la manzana deja
-- de estar vigente y lo que se informó sobre ella sigue existiendo.

create or replace function public.retirar_manzana(p_manzana_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_terr uuid;
  v_lados integer;
begin
  if not public.is_admin(auth.uid()) then
    raise exception 'Solo un administrador puede retirar una manzana.';
  end if;

  select territory_id into v_terr from territorio_manzanas
  where id = p_manzana_id and vigente_hasta is null;
  if v_terr is null then
    raise exception 'Esa manzana no existe o ya estaba retirada.';
  end if;

  update manzana_lados set vigente_hasta = now()
  where manzana_id = p_manzana_id and vigente_hasta is null;
  get diagnostics v_lados = row_count;

  update territorio_manzanas set vigente_hasta = now(), updated_at = now()
  where id = p_manzana_id;

  return jsonb_build_object('manzana_id', p_manzana_id, 'lados_retirados', v_lados);
end;
$$;

grant execute on function public.retirar_manzana(uuid) to authenticated;

commit;
