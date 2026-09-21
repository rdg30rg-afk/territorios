-- =====================================================================
-- El programa, al alcance de quien sale a predicar
-- ---------------------------------------------------------------------
-- Dos problemas que se veian como uno solo: la tarjeta de la vista del
-- hermano mostraba la hora y el lugar, y nada mas.
--
-- 1. LO QUE EL PROGRAMA DICE ESTABA GUARDADO DONDE EL NO LLEGA.
--    La importacion del Excel dejo el conductor, el barrio, las manzanas a
--    priorizar y el codigo de territorio en salida_importacion_procedencia
--    y en importacion_registros. Las dos tablas son de administracion: la
--    primera la leen los admins y quien tiene el modulo de salidas, la
--    segunda solo los admins. Medido sobre las 16 salidas proximas: 14
--    tienen conductor, 14 tienen codigo de territorio, y priorizar trae
--    "Manzanas C,D,F" o "Todo". Todo eso existia y no llegaba a la
--    pantalla.
--
--    Aca ese texto sube a salidas, que es la tabla que la pantalla lee. Se
--    copia como TEXTO DE LA FUENTE, no como relacion: conductor_texto no
--    es driver_id y territorio_codigo no es territory_id. Emparejar un
--    alias con una persona sigue necesitando evidencia y una decision, y
--    esta migracion no la toma.
--
-- 2. LA PANTALLA DEL HERMANO ERA, EN LOS HECHOS, UNA PANTALLA DE ADMIN.
--    Cada tabla que lee pide un modulo del panel: salidas pide el modulo
--    de salidas, territorios pide territorio_personal o mapas,
--    territorio_manzanas pide mapas, manzana_lados pide mapas o
--    territorio_personal. Un publicador con rol viewer y sin modulos abria
--    la pantalla y veia todo vacio. No se noto nunca porque en desarrollo
--    hay un solo usuario y es admin, y is_admin saltea todas las
--    politicas.
--
--    El programa de salidas se pasa por WhatsApp a toda la congregacion y
--    los territorios son de la congregacion: no hay nada que esconderle a
--    un publicador. Se agregan politicas de LECTURA para cualquier usuario
--    activo. Las politicas viejas quedan donde estan: en PostgreSQL varias
--    politicas permisivas se suman, asi que esto amplia y no reemplaza.
--
--    Escribir sigue siendo otra cosa. Informar lo que se camino queda para
--    los conductores -que salen con el grupo- y para quien tiene el
--    territorio reservado a su nombre. Nadie informa por otro.
--
-- Idempotente: se puede correr dos veces sin cambiar nada la segunda.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 0. Comparar nombres escritos a mano
-- ---------------------------------------------------------------------
-- "Mateo Luna" y "mateo luna" son la misma persona, y tambien lo son
-- "Jose" y "José". Hace falta dos veces mas abajo: para limpiar la columna
-- de priorizar y para reconocer de quien es un territorio reservado.

create or replace function public.nombre_normalizado(p_texto text)
returns text
language sql
immutable
set search_path = public
as $$
  select btrim(lower(translate(
    coalesce(p_texto, ''),
    'áéíóúüñÁÉÍÓÚÜÑàèìòùÀÈÌÒÙ',
    'aeiouunAEIOUUNaeiouAEIOU'
  )));
$$;

grant execute on function public.nombre_normalizado(text) to authenticated;

-- ---------------------------------------------------------------------
-- 1. Lo que dice el programa, en la tabla que la pantalla lee
-- ---------------------------------------------------------------------

alter table public.salidas
  add column if not exists conductor_texto text,
  add column if not exists barrio text,
  add column if not exists priorizar text,
  add column if not exists territorio_codigo text;

comment on column public.salidas.conductor_texto is
  'Quien conduce, tal como lo escribe el programa. Es texto de la fuente, no una persona del sistema: para eso esta driver_id, que se llena con evidencia y decision explicita.';
comment on column public.salidas.barrio is
  'El barrio donde queda el punto de encuentro, tal como lo resolvia el Excel.';
comment on column public.salidas.priorizar is
  'Que se recorre ese dia: "Todo" o las manzanas concretas ("Manzanas C,D,F").';
comment on column public.salidas.territorio_codigo is
  'El codigo del territorio como lo escribe el programa, con su decimal ("61.1"). El decimal distingue la salida o el punto de encuentro, no el territorio: el 61.1 es el territorio 61. No es territory_id.';

-- ---------------------------------------------------------------------
-- 2. Traer ese texto desde la procedencia
-- ---------------------------------------------------------------------
-- El barrio no quedo en ninguna columna de la procedencia: vive en la
-- celda E de la fila del Excel, que era una formula LOOKUP contra la hoja
-- Territorios. Se lee de ahi, del bruto, que es exactamente lo que la
-- importacion guardo para no tener que volver al archivo.
--
-- Solo se completa lo que esta vacio. Si alguien ya edito una salida a
-- mano, gana lo que decidio esa persona.
--
-- La columna de priorizar hay que mirarla con cuidado. Sobre 1.790 filas
-- tiene 183 valores distintos, y no todos hablan de manzanas: 40 son
-- nombres de conductores ("Ariel Riveros" siete veces), ocho dicen
-- "Telefonica" y unos pocos son el resultado de la salida ("se completo",
-- "no se predico"). Es una columna que se uso para cosas distintas segun
-- la epoca. Copiada tal cual, la tarjeta le diria a un hermano "Priorizá
-- Ariel Riveros". Se descarta lo que se puede reconocer como otra cosa:
-- un nombre que ya figura en la tabla de alias, y el puñado de frases que
-- son un resultado. Lo que queda se copia sin interpretar.

with fuente as (
  select
    s.id as salida_id,
    nullif(btrim(coalesce(p.source_conductor_text, '')), '-') as conductor,
    case
      when exists (
        select 1 from public.conductor_alias a
        where public.nombre_normalizado(a.alias)
            = public.nombre_normalizado(p.source_priorizar)
      ) then null
      when public.nombre_normalizado(p.source_priorizar) in (
        'telefonica', 'se completo', 'no se predico', 'se predico manzana e d'
      ) then null
      else nullif(btrim(coalesce(p.source_priorizar, '')), '-')
    end as priorizar,
    nullif(btrim(coalesce(r.normalizado->>'territorio_codigo_fuente', '')), '-') as codigo,
    (
      select nullif(btrim(celda->>'valor_calculado'), '')
      from jsonb_array_elements(r.bruto->'celdas') as celda
      where celda->>'columna' = 'E'
      limit 1
    ) as barrio
  from public.salidas s
  join public.salida_importacion_procedencia p on p.salida_id = s.id
  left join public.importacion_registros r
    on r.id = s.registro_id
   and jsonb_typeof(r.bruto->'celdas') = 'array'
)
update public.salidas s
set
  conductor_texto   = coalesce(s.conductor_texto, nullif(f.conductor, '')),
  priorizar         = coalesce(s.priorizar, nullif(f.priorizar, '')),
  territorio_codigo = coalesce(s.territorio_codigo, nullif(f.codigo, '')),
  barrio            = coalesce(s.barrio, nullif(f.barrio, ''))
from fuente f
where f.salida_id = s.id
  and (
    s.conductor_texto is distinct from coalesce(s.conductor_texto, nullif(f.conductor, ''))
    or s.priorizar is distinct from coalesce(s.priorizar, nullif(f.priorizar, ''))
    or s.territorio_codigo is distinct from coalesce(s.territorio_codigo, nullif(f.codigo, ''))
    or s.barrio is distinct from coalesce(s.barrio, nullif(f.barrio, ''))
  );

-- Buscar por fecha es lo unico que hace la vista del hermano con esta
-- tabla, y lo hace en cada apertura.
create index if not exists salidas_scheduled_for_idx
  on public.salidas (scheduled_for);

-- ---------------------------------------------------------------------
-- 3. Quien es quien
-- ---------------------------------------------------------------------

-- Un usuario activo es alguien a quien ya le abrieron la puerta. No dice
-- nada de que puede hacer adentro.
create or replace function public.es_usuario_activo()
returns boolean
language sql
security definer
stable
set search_path = public
as $$
  select exists (
    select 1
    from public.profiles
    where id = auth.uid()
      and coalesce(access_status, 'active') = 'active'
  );
$$;

-- Conductor es quien tiene el rol o quien esta enlazado a una ficha de
-- conductor. Sale con el grupo y por eso puede informar lo que se camino.
create or replace function public.es_conductor()
returns boolean
language sql
security definer
stable
set search_path = public
as $$
  select exists (
    select 1
    from public.profiles
    where id = auth.uid()
      and (role = 'conductor' or driver_id is not null)
  );
$$;

-- El territorio es mio si la reserva activa la pedi yo, o si esta a mi
-- nombre. Lo segundo es fragil a proposito y se sabe: reserved_for es
-- texto libre y no una referencia a la persona. Mientras siga siendo
-- texto, esto es lo mismo que ya hace la pantalla para reconocerte.
create or replace function public.territorio_es_mio(p_territory_id uuid)
returns boolean
language sql
security definer
stable
set search_path = public
as $$
  select exists (
    select 1
    from public.territorio_personal_reservas r
    left join public.profiles p on p.id = auth.uid()
    where r.territory_id = p_territory_id
      and r.status = 'activa'
      and (
        r.requested_by = auth.uid()
        or (
          p.full_name is not null
          and public.nombre_normalizado(r.reserved_for)
              = public.nombre_normalizado(p.full_name)
        )
      )
  );
$$;

grant execute on function public.es_usuario_activo() to authenticated;
grant execute on function public.es_conductor() to authenticated;
grant execute on function public.territorio_es_mio(uuid) to authenticated;

-- ---------------------------------------------------------------------
-- 4. Leer: lo que necesita la vista del hermano
-- ---------------------------------------------------------------------
-- Cinco lecturas, las cinco de la misma pantalla. Se nombran igual para
-- que se vea que son una sola decision y no cinco sueltas.

drop policy if exists "Publicador ve el programa" on public.salidas;
create policy "Publicador ve el programa"
on public.salidas
for select to authenticated
using (public.es_usuario_activo());

drop policy if exists "Publicador ve los territorios" on public.territorios;
create policy "Publicador ve los territorios"
on public.territorios
for select to authenticated
using (public.es_usuario_activo());

drop policy if exists "Publicador ve las manzanas" on public.territorio_manzanas;
create policy "Publicador ve las manzanas"
on public.territorio_manzanas
for select to authenticated
using (public.es_usuario_activo());

drop policy if exists "Publicador ve las cuadras" on public.manzana_lados;
create policy "Publicador ve las cuadras"
on public.manzana_lados
for select to authenticated
using (public.es_usuario_activo());

-- Lo ya informado es lo que pinta el mapa de verde. Sin esto, la pantalla
-- muestra un territorio entero sin recorrer y hace salir de nuevo a donde
-- ya se paso.
drop policy if exists "Publicador ve lo informado" on public.cobertura_eventos;
create policy "Publicador ve lo informado"
on public.cobertura_eventos
for select to authenticated
using (public.es_usuario_activo());

-- Y ver la reserva que esta a su nombre, aunque la haya cargado un siervo:
-- la politica que ya existia solo alcanza a la que uno mismo pidio.
drop policy if exists "Ver la reserva que esta a mi nombre" on public.territorio_personal_reservas;
create policy "Ver la reserva que esta a mi nombre"
on public.territorio_personal_reservas
for select to authenticated
using (
  public.es_usuario_activo()
  and (
    requested_by = auth.uid()
    or public.territorio_es_mio(territory_id)
  )
);

-- ---------------------------------------------------------------------
-- 5. Informar: los conductores, y cada uno lo suyo
-- ---------------------------------------------------------------------
-- La politica que ya estaba pedia un modulo del panel. Esta se suma:
-- informa el conductor, que sale con el grupo, o quien tiene ese
-- territorio a su nombre. En los dos casos queda firmado con su id, asi
-- que nadie informa por otro.

drop policy if exists "Informar lo que camine" on public.cobertura_eventos;
create policy "Informar lo que camine"
on public.cobertura_eventos
for insert to authenticated
with check (
  informado_por = auth.uid()
  and public.es_usuario_activo()
  and (public.es_conductor() or public.territorio_es_mio(territory_id))
);

-- ---------------------------------------------------------------------
-- 6. Que quedo
-- ---------------------------------------------------------------------

do $$
declare
  con_conductor int;
  con_barrio int;
  con_codigo int;
  con_priorizar int;
  proximas int;
begin
  select count(*) into con_conductor from public.salidas where conductor_texto is not null;
  select count(*) into con_barrio from public.salidas where barrio is not null;
  select count(*) into con_codigo from public.salidas where territorio_codigo is not null;
  select count(*) into con_priorizar from public.salidas where priorizar is not null;
  select count(*) into proximas from public.salidas where scheduled_for >= date_trunc('day', now());

  raise notice 'Salidas con conductor: %', con_conductor;
  raise notice 'Salidas con barrio: %', con_barrio;
  raise notice 'Salidas con codigo de territorio: %', con_codigo;
  raise notice 'Salidas con priorizar: %', con_priorizar;
  raise notice 'Salidas de hoy en adelante: %', proximas;
end;
$$;
