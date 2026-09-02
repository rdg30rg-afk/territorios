-- =====================================================================
-- Las vistas de cobertura tienen que respetar el RLS de QUIEN consulta
--
-- Una vista de Postgres corre, por omisión, con los permisos de su dueño.
-- Como las creé con el rol de servicio, `cobertura_lado_actual`,
-- `cobertura_manzana` y `cobertura_territorio` estaban salteándose las
-- políticas de las tablas de abajo: cualquier usuario autenticado podía
-- leer la cobertura de todos los territorios aunque no tuviera el módulo.
--
-- security_invoker las hace correr con los permisos del que pregunta.
-- Existe desde Postgres 15; Supabase está por encima. El bloque comprueba
-- la versión para que la migración también corra en un Postgres viejo de
-- pruebas, avisando en vez de fallar.
--
-- Efecto secundario a resolver: con security_invoker, la columna
-- `reservado` de cobertura_territorio pasaba a depender de si el que
-- consulta puede leer territorio_personal_reservas. El que no pudiera
-- vería `false` en vez de un error: una mentira silenciosa, que es peor
-- que un permiso denegado. Por eso ese dato sale ahora de una función
-- que devuelve SOLO el booleano, nunca el nombre de quien lo tiene.
-- =====================================================================

begin;

create or replace function public.territorio_reservado(p_territory_id uuid)
returns boolean
language sql
security definer
set search_path = public
stable
as $$
  select exists (
    select 1 from territorio_personal_reservas
    where territory_id = p_territory_id and status = 'activa'
  );
$$;

comment on function public.territorio_reservado(uuid) is
  'Si el territorio está reservado. Devuelve solo el booleano: para quién lo está no viaja al mapa de todos.';

create or replace view cobertura_territorio as
select
  t.id            as territory_id,
  t.name,
  t.code_text,
  t.parent_id,
  count(cm.manzana_id)                                          as manzanas,
  coalesce(sum(cm.lados), 0)                                    as lados,
  coalesce(sum(cm.lados_hechos), 0)                             as lados_hechos,
  coalesce(sum(cm.metros), 0)                                   as metros,
  coalesce(sum(cm.metros_hechos), 0)                            as metros_hechos,
  case
    when coalesce(sum(cm.metros), 0) = 0 then null
    else round(100.0 * coalesce(sum(cm.metros_hechos), 0) / sum(cm.metros), 1)
  end                                                            as pct_metros,
  max(cm.ultima_marca)                                          as ultima_marca,
  case
    when max(cm.ultima_marca) is null then 'sin_dato'
    when coalesce(sum(cm.metros_hechos), 0) = 0 then 'sin_dato'
    when coalesce(sum(cm.metros_hechos), 0) >= coalesce(sum(cm.metros), 0) then 'completo'
    else 'parcial'
  end                                                            as estado,
  (max(cm.ultima_marca) is not null)                             as tiene_dato,
  public.territorio_reservado(t.id)                              as reservado
from territorios t
left join cobertura_manzana cm on cm.territory_id = t.id
group by t.id, t.name, t.code_text, t.parent_id;

do $$
begin
  if current_setting('server_version_num')::int >= 150000 then
    execute 'alter view cobertura_lado_actual set (security_invoker = on)';
    execute 'alter view cobertura_manzana   set (security_invoker = on)';
    execute 'alter view cobertura_territorio set (security_invoker = on)';
  else
    raise notice 'Postgres % no soporta security_invoker: las vistas quedan con los permisos del dueño.',
      current_setting('server_version');
  end if;
end
$$;

-- PostgREST consulta con el rol authenticated: sin este grant las vistas
-- no existen para la app. Las filas las sigue filtrando el RLS.
grant select on public.cobertura_lado_actual to authenticated;
grant select on public.cobertura_manzana to authenticated;
grant select on public.cobertura_territorio to authenticated;
grant select on public.manzana_lados to authenticated;
grant select on public.puntos_encuentro to authenticated;

commit;
