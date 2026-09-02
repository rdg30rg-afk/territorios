-- =====================================================================
-- Cobertura por lado, geometría de manzanas y puntos de encuentro
--
-- Aditiva: no borra ni renombra ninguna columna existente. Todo lo que
-- ya funciona sigue funcionando si esta migración se revierte.
--
-- Se aplica primero en el clon de desarrollo (rkmioktcsgqqjshrlkmy).
-- NO ejecutar en producción hasta validar.
--
-- Contexto: el mapa del hermano marca "lados" (una fila de casas sobre
-- una calle). Hoy el lado se calcula en el navegador a partir del
-- polígono, con tolerancia de 25° y descarte de tramos < 12 m. Ese
-- cálculo es DERIVADO: si el polígono se redibuja, cambia la cantidad
-- de lados y su orden. Por eso la cobertura NO puede guardarse contra
-- un índice; se guarda contra una fila de lado con id propio, y los
-- lados se versionan en vez de borrarse.
-- =====================================================================

begin;

-- ---------------------------------------------------------------------
-- 1. Identidad de los territorios
-- ---------------------------------------------------------------------

-- El nombre es la clave con la que el mapa del hermano encuentra sus
-- formas. Sin unicidad, dos territorios "20" se pisan en silencio.
create unique index if not exists territorios_name_unique_idx
  on territorios (lower(name));

-- Preparado para la subdivisión (1.1, 1.2, 68.5 del Excel) sin obligar
-- a hacerla ahora. Un subterritorio es un territorio con padre.
alter table territorios add column if not exists code_text text;
alter table territorios add column if not exists parent_id uuid references territorios (id) on delete restrict;
alter table territorios add column if not exists kind text not null default 'territorial'
  check (kind in ('territorial', 'telefonica', 'asamblea', 'especial', 'sin_salida'));
alter table territorios add column if not exists updated_at timestamptz not null default now();

create unique index if not exists territorios_code_text_unique_idx
  on territorios (lower(code_text)) where code_text is not null;

-- Un territorio no puede ser su propio padre.
alter table territorios drop constraint if exists territorios_parent_no_self;
alter table territorios add constraint territorios_parent_no_self check (parent_id is null or parent_id <> id);

-- ---------------------------------------------------------------------
-- 2. Geometría de las manzanas dentro de la base
-- ---------------------------------------------------------------------
-- Hasta hoy la forma vive en public/datos/manzanas-territorios.json,
-- indexada por nombre de territorio. Eso es una bifurcación de la
-- verdad: redibujar en la app no la actualiza y no falla, dibuja lo
-- viejo. Pasa a la base.

alter table territorio_manzanas add column if not exists geometry_geojson jsonb;
alter table territorio_manzanas add column if not exists geometry_version integer not null default 1;
alter table territorio_manzanas add column if not exists area_m2 numeric(12, 2);
alter table territorio_manzanas add column if not exists orden integer;
-- Cuando se subdividan los territorios, la manzana se agrupa acá sin
-- mover su territory_id ni redibujar nada.
alter table territorio_manzanas add column if not exists subterritorio_id uuid references territorios (id) on delete set null;
alter table territorio_manzanas add column if not exists updated_at timestamptz not null default now();

-- Sin PostGIS no se puede consultar el polígono; el área se calcula al
-- cargarla y se guarda, que es lo único que el heatmap necesita para
-- ponderar por superficie en vez de por conteo.

-- ---------------------------------------------------------------------
-- 3. Lados
-- ---------------------------------------------------------------------
-- Un lado es la tira de segmentos casi colineales que dan la vuelta a
-- una misma calle. Se materializa acá para que la cobertura tenga a qué
-- apuntar de forma estable.
--
-- geometry: LineString del borde REAL, no el corrido 9 m hacia adentro.
-- El corrimiento es presentación y lo hace el cliente al dibujar.
--
-- rumbo_grados y el punto medio permiten re-emparejar un lado con su
-- equivalente después de un redibujado, en vez de perder la historia.

create table if not exists manzana_lados (
  id uuid primary key default gen_random_uuid(),
  manzana_id uuid not null references territorio_manzanas (id) on delete cascade,
  territory_id uuid not null references territorios (id) on delete cascade,
  orden integer not null,
  geometry_geojson jsonb not null,
  largo_m numeric(10, 2) not null,
  rumbo_grados numeric(6, 2) not null,
  medio_lat numeric(9, 6) not null,
  medio_lng numeric(9, 6) not null,
  geometry_version integer not null default 1,
  vigente_desde timestamptz not null default now(),
  vigente_hasta timestamptz,
  created_at timestamptz not null default now()
);

create index if not exists manzana_lados_manzana_idx on manzana_lados (manzana_id);
create index if not exists manzana_lados_territorio_idx on manzana_lados (territory_id);

-- Un solo juego de lados vigente por manzana y orden. Los reemplazados
-- se cierran con vigente_hasta; nunca se borran.
create unique index if not exists manzana_lados_vigente_unique_idx
  on manzana_lados (manzana_id, orden) where vigente_hasta is null;

-- ---------------------------------------------------------------------
-- 4. Cobertura: bitácora, no estado
-- ---------------------------------------------------------------------
-- Cada marca es un hecho con fecha y autor. El "estado actual" es una
-- vista sobre el último hecho, no una columna que se pisa. Corregir es
-- agregar una fila que apunta a la anterior.

create table if not exists cobertura_eventos (
  id uuid primary key default gen_random_uuid(),
  lado_id uuid not null references manzana_lados (id) on delete restrict,
  -- Desnormalizados a propósito: el heatmap agrega por territorio sobre
  -- cientos de miles de filas y no puede pagar dos joins por consulta.
  manzana_id uuid not null references territorio_manzanas (id) on delete restrict,
  territory_id uuid not null references territorios (id) on delete restrict,
  estado text not null check (estado in ('recorrido', 'no_accesible', 'revisitar', 'sin_dato')),
  origen text not null check (origen in ('app_hermano', 'cierre_salida', 'importacion', 'correccion')),
  informado_por uuid references profiles (id) on delete set null,
  informado_at timestamptz not null default now(),
  salida_id uuid references salidas (id) on delete set null,
  nota text,
  -- Una corrección no borra: apunta al evento que corrige.
  corrige_evento_id uuid references cobertura_eventos (id) on delete restrict,
  -- Para lo que venga del Excel: nunca se pierde de dónde salió.
  origen_detalle jsonb,
  created_at timestamptz not null default now()
);

create index if not exists cobertura_eventos_lado_fecha_idx
  on cobertura_eventos (lado_id, informado_at desc);
create index if not exists cobertura_eventos_territorio_fecha_idx
  on cobertura_eventos (territory_id, informado_at desc);

-- ---------------------------------------------------------------------
-- 5. Puntos de encuentro
-- ---------------------------------------------------------------------
-- Hoy cada salida copia nombre + lat + lng adentro de su propia fila.
-- El Excel tiene 191 enlaces de Maps y 39 destinos repetidos: son
-- puntos compartidos, no datos de la salida.

create table if not exists puntos_encuentro (
  id uuid primary key default gen_random_uuid(),
  nombre text not null,
  barrio text,
  lat numeric(9, 6),
  lng numeric(9, 6),
  maps_url text,
  territory_id uuid references territorios (id) on delete set null,
  activo boolean not null default true,
  notas text,
  created_by uuid references profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists puntos_encuentro_nombre_unique_idx
  on puntos_encuentro (lower(nombre));

-- La salida puede apuntar al punto compartido. Las columnas viejas
-- (meeting_point_name/lat/lng) siguen intactas: nada se rompe si esto
-- queda en null.
alter table salidas add column if not exists meeting_point_id uuid references puntos_encuentro (id) on delete set null;

-- ---------------------------------------------------------------------
-- 6. Vistas para el heatmap
-- ---------------------------------------------------------------------

-- El último hecho conocido de cada lado vigente.
create or replace view cobertura_lado_actual as
select distinct on (l.id)
  l.id                as lado_id,
  l.manzana_id,
  l.territory_id,
  l.orden,
  l.largo_m,
  l.medio_lat,
  l.medio_lng,
  coalesce(e.estado, 'sin_dato') as estado,
  e.informado_at,
  e.informado_por
from manzana_lados l
left join cobertura_eventos e on e.lado_id = l.id
where l.vigente_hasta is null
order by l.id, e.informado_at desc nulls last;

-- Cobertura de cada manzana, medida en lados y ponderada por metros.
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
group by m.id, m.territory_id, m.label, m.area_m2;

-- La fila que pinta el heatmap general. Un territorio sin ningún lado
-- informado queda en 'sin_dato', que NO es lo mismo que 0% recorrido.
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
  -- Sin nombre: quién lo tiene reservado no viaja al mapa de todos.
  exists (
    select 1 from territorio_personal_reservas r
    where r.territory_id = t.id and r.status = 'activa'
  )                                                              as reservado
from territorios t
left join cobertura_manzana cm on cm.territory_id = t.id
group by t.id, t.name, t.code_text, t.parent_id;

-- ---------------------------------------------------------------------
-- 7. Permisos
-- ---------------------------------------------------------------------

alter table manzana_lados enable row level security;
alter table cobertura_eventos enable row level security;
alter table puntos_encuentro enable row level security;

-- Los lados se leen con el mismo permiso que las manzanas.
drop policy if exists "Leer lados" on manzana_lados;
create policy "Leer lados" on manzana_lados
for select to authenticated
using (public.can_access_module('mapas') or public.can_access_module('territorio_personal'));

drop policy if exists "Admins gestionan lados" on manzana_lados;
create policy "Admins gestionan lados" on manzana_lados
for all to authenticated
using (public.is_admin(auth.uid()))
with check (public.is_admin(auth.uid()));

drop policy if exists "Leer cobertura" on cobertura_eventos;
create policy "Leer cobertura" on cobertura_eventos
for select to authenticated
using (
  public.can_access_module('mapas') or
  public.can_access_module('salidas') or
  public.can_access_module('territorio_personal')
);

-- Cualquiera que tenga territorio personal o salidas puede INFORMAR lo
-- que caminó, y queda firmado con su id. No puede informar por otro.
drop policy if exists "Informar cobertura" on cobertura_eventos;
create policy "Informar cobertura" on cobertura_eventos
for insert to authenticated
with check (
  informado_por = auth.uid()
  and (
    public.can_access_module('territorio_personal') or
    public.can_access_module('salidas') or
    public.can_access_module('salidas_grupo') or
    public.is_admin(auth.uid())
  )
);

drop policy if exists "Leer puntos de encuentro" on puntos_encuentro;
create policy "Leer puntos de encuentro" on puntos_encuentro
for select to authenticated
using (
  public.can_access_module('salidas') or
  public.can_access_module('salidas_grupo') or
  public.can_access_module('mapas')
);

drop policy if exists "Admins gestionan puntos de encuentro" on puntos_encuentro;
create policy "Admins gestionan puntos de encuentro" on puntos_encuentro
for all to authenticated
using (public.is_admin(auth.uid()))
with check (public.is_admin(auth.uid()));

-- ---------------------------------------------------------------------
-- 8. Inmutabilidad de la bitácora
-- ---------------------------------------------------------------------
-- Esto NO se consigue con RLS: las políticas "for all" de admin incluyen
-- delete. Se consigue quitando el verbo. Corregir = insertar una fila
-- que apunta a la anterior con corrige_evento_id.

revoke update, delete on public.cobertura_eventos from authenticated;
revoke update, delete on public.cobertura_eventos from anon;
grant select, insert on public.cobertura_eventos to authenticated;

commit;
