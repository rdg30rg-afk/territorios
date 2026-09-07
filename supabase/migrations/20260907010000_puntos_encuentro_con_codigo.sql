-- Puntos de encuentro con código de programa (61.1).
-- El decimal no es otro territorio: es desde dónde se sale.
-- Se puebla desde el staging del Excel; si no hay staging, solo deja el esquema.

begin;

create or replace function public.normalizar_codigo_punto(p_bruto text)
returns text
language sql
immutable
as $$
  select nullif(
    regexp_replace(replace(btrim(coalesce(p_bruto, '')), ',', '.'), '\s+', '', 'g'),
    ''
  );
$$;

comment on function public.normalizar_codigo_punto(text) is
  'Pasa 61,1 / 61 1 / 61.1 al código léxico 61.1. No interpreta el valor como número.';

alter table public.puntos_encuentro
  add column if not exists codigo text,
  add column if not exists orden smallint,
  add column if not exists tipo text not null default 'territorial',
  add column if not exists origen text not null default 'app',
  add column if not exists gps_origen text;

alter table public.puntos_encuentro
  drop constraint if exists puntos_encuentro_tipo_check;
alter table public.puntos_encuentro
  add constraint puntos_encuentro_tipo_check
  check (tipo in ('territorial', 'especial'));

alter table public.puntos_encuentro
  drop constraint if exists puntos_encuentro_origen_check;
alter table public.puntos_encuentro
  add constraint puntos_encuentro_origen_check
  check (origen in ('app', 'excel'));

alter table public.puntos_encuentro
  drop constraint if exists puntos_encuentro_gps_origen_check;
alter table public.puntos_encuentro
  add constraint puntos_encuentro_gps_origen_check
  check (gps_origen in ('maps_url', 'manual'));

drop index if exists public.puntos_encuentro_nombre_unique_idx;

create unique index if not exists puntos_encuentro_codigo_unique_idx
  on public.puntos_encuentro (codigo)
  where codigo is not null;

create unique index if not exists puntos_encuentro_territorio_orden_idx
  on public.puntos_encuentro (territory_id, orden)
  where territory_id is not null and orden is not null;

create index if not exists puntos_encuentro_territorio_idx
  on public.puntos_encuentro (territory_id);

comment on column public.puntos_encuentro.codigo is
  'Código del programa, tal como se escribe: 61.1, AC, TEL. No es territory_id.';
comment on column public.puntos_encuentro.orden is
  'El decimal del código (1 en 61.1). Distingue puntos del mismo territorio.';

do $$
declare
  v_staging int;
  v_insertados int;
  v_sin_territorio text[];
begin
  select count(*)
    into v_staging
  from public.importacion_registros
  where tipo = 'territorio'
    and estado = 'aplicado'
    and normalizado is not null;

  if v_staging = 0 then
    return;
  end if;

  with territorios_fuente as (
    select distinct on (public.normalizar_codigo_punto(r.normalizado->>'codigo_bruto'))
      public.normalizar_codigo_punto(r.normalizado->>'codigo_bruto') as codigo,
      nullif(btrim(r.normalizado->>'punto_encuentro_bruto'), '') as nombre,
      nullif(btrim(r.normalizado->>'barrio_bruto'), '') as barrio
    from public.importacion_registros r
    where r.tipo = 'territorio'
      and r.estado = 'aplicado'
      and r.normalizado is not null
      and public.normalizar_codigo_punto(r.normalizado->>'codigo_bruto') is not null
    order by public.normalizar_codigo_punto(r.normalizado->>'codigo_bruto'), r.created_at
  ),
  urls as (
    select distinct on (public.normalizar_codigo_punto(r.normalizado->>'territorio_bruto'))
      public.normalizar_codigo_punto(r.normalizado->>'territorio_bruto') as codigo,
      nullif(btrim(r.normalizado->>'url'), '') as url
    from public.importacion_registros r
    where r.tipo = 'punto_encuentro'
      and r.normalizado is not null
      and public.normalizar_codigo_punto(r.normalizado->>'territorio_bruto') is not null
    order by
      public.normalizar_codigo_punto(r.normalizado->>'territorio_bruto'),
      case when r.estado = 'aplicado' then 0 else 1 end,
      r.created_at
  ),
  armados as (
    select
      f.codigo,
      coalesce(f.nombre, f.codigo) as nombre,
      f.barrio,
      u.url as maps_url,
      case
        when f.codigo ~ '^\d+(\.\d+)?$' then 'territorial'
        else 'especial'
      end as tipo,
      case
        when f.codigo ~ '^\d+\.\d+$' then split_part(f.codigo, '.', 2)::smallint
        when f.codigo ~ '^\d+$' then 1::smallint
        else null
      end as orden,
      case
        when f.codigo ~ '^\d+' then split_part(f.codigo, '.', 1)
        else null
      end as territorio_nombre
    from territorios_fuente f
    left join urls u on u.codigo = f.codigo
  )
  insert into public.puntos_encuentro (
    nombre, barrio, maps_url, territory_id, codigo, orden, tipo, origen, activo
  )
  select
    a.nombre,
    a.barrio,
    a.maps_url,
    t.id,
    a.codigo,
    a.orden,
    a.tipo,
    'excel',
    true
  from armados a
  left join public.territorios t
    on a.tipo = 'territorial'
   and t.name = a.territorio_nombre
  on conflict (codigo) where codigo is not null do update
    set nombre = case
          when btrim(coalesce(public.puntos_encuentro.nombre, '')) = ''
          then excluded.nombre
          else public.puntos_encuentro.nombre
        end,
        barrio = coalesce(public.puntos_encuentro.barrio, excluded.barrio),
        maps_url = coalesce(public.puntos_encuentro.maps_url, excluded.maps_url),
        territory_id = coalesce(public.puntos_encuentro.territory_id, excluded.territory_id),
        orden = coalesce(public.puntos_encuentro.orden, excluded.orden),
        tipo = public.puntos_encuentro.tipo,
        origen = public.puntos_encuentro.origen;

  select count(*) into v_insertados from public.puntos_encuentro where origen = 'excel';

  if v_insertados < 190 then
    raise exception
      'Quedaron % puntos importados; se esperaban al menos 190. No se aplica a medias.',
      v_insertados;
  end if;

  select coalesce(array_agg(distinct a.territorio_nombre order by a.territorio_nombre), '{}')
    into v_sin_territorio
  from (
    select split_part(p.codigo, '.', 1) as territorio_nombre
    from public.puntos_encuentro p
    where p.tipo = 'territorial'
      and p.territory_id is null
      and p.codigo ~ '^\d+'
  ) a;

  if coalesce(array_length(v_sin_territorio, 1), 0) > 0 then
    raise exception
      'Hay puntos territoriales sin territorio en el mapa: %',
      array_to_string(v_sin_territorio, ', ');
  end if;
end;
$$;

update public.salidas s
set meeting_point_id = p.id
from public.puntos_encuentro p
where s.meeting_point_id is null
  and s.territorio_codigo is not null
  and public.normalizar_codigo_punto(s.territorio_codigo) = p.codigo;

update public.salidas s
set territory_id = p.territory_id
from public.puntos_encuentro p
where s.meeting_point_id = p.id
  and s.territory_id is null
  and p.territory_id is not null;

notify pgrst, 'reload schema';
commit;
