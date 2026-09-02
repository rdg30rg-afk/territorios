-- =====================================================================
-- Lo que hace falta para poder importar el Excel sin mentir
--
-- Hasta acá la base sabe de mapas: territorios, manzanas, lados y
-- cobertura. El Excel es sobre todo otra cosa: agenda, historial y
-- personas. Casi nada de eso tenía dónde caer.
--
-- Tres decisiones que ordenan todo lo demás:
--
-- 1. NADA SE IMPORTA SIN PROCEDENCIA. Cada dato que entre desde el
--    archivo deja la pestaña, la fila y el valor bruto tal cual estaba.
--    El origen tiene 4.841 fórmulas y 33 errores visibles: sin poder
--    volver a la celda, un dato raro es indistinguible de un error de
--    lectura, y la importación no se puede deshacer.
--
-- 2. PLANIFICAR Y HACER SON DOS COSAS. `salidas` guarda lo que se
--    pensaba hacer. Lo que pasó va aparte, y puede no saberse.
--
-- 3. NO SABER ES UN ESTADO. De las 1.854 salidas del archivo, 106 no
--    tienen un booleano concluyente. Meterlas como "no realizada"
--    sería inventar 106 hechos. Por eso 'sin_dato' existe en todos
--    lados y es el valor por omisión.
-- =====================================================================

begin;

-- ---------------------------------------------------------------------
-- 1. Staging con procedencia
-- ---------------------------------------------------------------------

create table if not exists importaciones (
  id uuid primary key default gen_random_uuid(),
  archivo text not null,
  drive_id text,
  nota text,
  estado text not null default 'en_curso'
    check (estado in ('en_curso', 'aplicada', 'revertida')),
  corrida_por uuid references profiles (id) on delete set null,
  corrida_at timestamptz not null default now()
);

comment on table importaciones is
  'Una corrida de importación. Revertir es marcarla, no borrar filas.';

-- Una fila por REGISTRO del origen, no por celda: la fila cruda entera
-- viaja en `bruto`. Guardar celda por celda multiplicaría por veinte el
-- volumen sin agregar nada que `bruto` no tenga.
create table if not exists importacion_registros (
  id uuid primary key default gen_random_uuid(),
  importacion_id uuid not null references importaciones (id) on delete cascade,
  pestania text not null,
  fila integer not null,
  rango text,
  tipo text not null
    check (tipo in ('salida', 'resultado', 'historial_territorio',
                    'territorio', 'conductor', 'grupo', 'punto_encuentro',
                    'territorio_personal', 'otro')),
  bruto jsonb not null,
  normalizado jsonb,
  estado text not null default 'pendiente'
    check (estado in ('pendiente', 'aplicado', 'conflicto', 'descartado')),
  motivo text,
  destino_tabla text,
  destino_id uuid,
  revisado_por uuid references profiles (id) on delete set null,
  revisado_at timestamptz,
  created_at timestamptz not null default now()
);

-- Correr el ETL dos veces no duplica: la misma celda del mismo archivo
-- es el mismo registro.
create unique index if not exists importacion_registros_origen_unique_idx
  on importacion_registros (importacion_id, pestania, fila, tipo);

create index if not exists importacion_registros_pendientes_idx
  on importacion_registros (importacion_id, estado)
  where estado in ('pendiente', 'conflicto');

-- ---------------------------------------------------------------------
-- 2. La salida histórica tiene que poder entrar
-- ---------------------------------------------------------------------

-- Un registro de abril de 2024 no trae coordenadas del punto de
-- encuentro. Con estas columnas en NOT NULL, importarlo obligaba a
-- INVENTAR una posición. Se aflojan; las salidas nuevas siguen
-- pidiéndolas desde la app.
alter table salidas alter column meeting_point_name drop not null;
alter table salidas alter column meeting_point_lat  drop not null;
alter table salidas alter column meeting_point_lng  drop not null;

-- 245 telefónicas, más asambleas y salidas de grupo. La app ya dibuja
-- el cartelito para esto, pero leía una columna que no existía.
alter table salidas add column if not exists tipo text
  check (tipo in ('telefonica', 'grupos', 'asamblea', 'especial'));

comment on column salidas.tipo is
  'Null es la salida común. Los demás valores son las excepciones del archivo.';

alter table salidas add column if not exists origen text not null default 'app'
  check (origen in ('app', 'excel'));
alter table salidas add column if not exists registro_id uuid
  references importacion_registros (id) on delete set null;

-- ---------------------------------------------------------------------
-- 3. Lo que efectivamente pasó
-- ---------------------------------------------------------------------

create table if not exists salida_resultados (
  id uuid primary key default gen_random_uuid(),
  salida_id uuid not null references salidas (id) on delete cascade,
  estado text not null default 'sin_dato'
    check (estado in ('realizada', 'parcial', 'no_realizada', 'cancelada', 'sin_dato')),
  motivo text
    check (motivo in ('acceso', 'edificio', 'consorcio', 'clima', 'feriado',
                      'sin_conductor', 'sin_publicadores', 'otro')),
  observaciones text,
  ocurrio_at timestamptz,
  -- Corregir es agregar una fila que apunta a la anterior. La primera
  -- versión queda a la vista, igual que en cobertura_eventos.
  corrige_id uuid references salida_resultados (id) on delete set null,
  origen text not null default 'app' check (origen in ('app', 'excel')),
  registro_id uuid references importacion_registros (id) on delete set null,
  informado_por uuid references profiles (id) on delete set null,
  informado_at timestamptz not null default now()
);

create index if not exists salida_resultados_salida_idx
  on salida_resultados (salida_id, informado_at desc);

-- El último informe de cada salida, que es lo que se muestra.
create or replace view salida_resultado_actual as
select distinct on (r.salida_id)
  r.salida_id, r.id as resultado_id, r.estado, r.motivo, r.observaciones,
  r.ocurrio_at, r.origen, r.informado_por, r.informado_at,
  (r.corrige_id is not null) as es_correccion
from salida_resultados r
order by r.salida_id, r.informado_at desc, r.id;

-- ---------------------------------------------------------------------
-- 4. El historial de rotación por territorio
-- ---------------------------------------------------------------------

-- 1.031 entradas en el archivo: 961 fechas y 70 bloqueos o excepciones
-- escritos a mano. Los 70 no son fechas y no se van a convertir en una:
-- entran como texto, con su clase, y siguen siendo legibles.
--
-- Esto es lo que contesta "cuándo se trabajó por última vez el 57", que
-- es la pregunta de la que cuelgan el ranking y las recomendaciones.
create table if not exists territorio_historial (
  id uuid primary key default gen_random_uuid(),
  territory_id uuid not null references territorios (id) on delete cascade,
  fecha date,
  texto text,
  clase text not null default 'sin_dato'
    check (clase in ('trabajado', 'bloqueo', 'excepcion', 'sin_dato')),
  salida_id uuid references salidas (id) on delete set null,
  origen text not null default 'app' check (origen in ('app', 'excel')),
  registro_id uuid references importacion_registros (id) on delete set null,
  created_by uuid references profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  -- Una entrada sin fecha y sin texto no dice nada.
  constraint territorio_historial_dice_algo check (fecha is not null or texto is not null)
);

create index if not exists territorio_historial_terr_idx
  on territorio_historial (territory_id, fecha desc nulls last);

-- ---------------------------------------------------------------------
-- 5. Los nombres de conductor del archivo
-- ---------------------------------------------------------------------

-- 55 variantes de texto que son unas 37 personas, con casos ambiguos.
-- Importar sin esto deja 55 conductores. `conductor_id` puede quedar en
-- null: "todavía no sabemos quién es" es una respuesta válida y hay que
-- poder guardarla.
create table if not exists conductor_alias (
  id uuid primary key default gen_random_uuid(),
  alias text not null,
  conductor_id uuid references conductores (id) on delete set null,
  confianza text not null default 'dudoso'
    check (confianza in ('confirmado', 'probable', 'dudoso')),
  nota text,
  decidido_por uuid references profiles (id) on delete set null,
  decidido_at timestamptz,
  created_at timestamptz not null default now()
);

create unique index if not exists conductor_alias_unique_idx
  on conductor_alias (lower(alias));

-- ---------------------------------------------------------------------
-- 6. Qué territorio le toca a cada grupo, y desde cuándo
-- ---------------------------------------------------------------------

create table if not exists grupo_territorio (
  id uuid primary key default gen_random_uuid(),
  group_id uuid not null references grupos_servicio (id) on delete cascade,
  territory_id uuid not null references territorios (id) on delete cascade,
  vigente_desde date not null default current_date,
  vigente_hasta date,
  nota text,
  origen text not null default 'app' check (origen in ('app', 'excel')),
  registro_id uuid references importacion_registros (id) on delete set null,
  created_by uuid references profiles (id) on delete set null,
  created_at timestamptz not null default now()
);

create unique index if not exists grupo_territorio_vigente_unique_idx
  on grupo_territorio (group_id, territory_id)
  where vigente_hasta is null;

-- ---------------------------------------------------------------------
-- 7. Permisos
-- ---------------------------------------------------------------------

alter table importaciones          enable row level security;
alter table importacion_registros  enable row level security;
alter table salida_resultados      enable row level security;
alter table territorio_historial   enable row level security;
alter table conductor_alias        enable row level security;
alter table grupo_territorio       enable row level security;

-- El staging es cocina: solo admin.
drop policy if exists "Admins manejan importaciones" on importaciones;
create policy "Admins manejan importaciones" on importaciones
for all to authenticated
using (public.is_admin(auth.uid())) with check (public.is_admin(auth.uid()));

drop policy if exists "Admins manejan registros importados" on importacion_registros;
create policy "Admins manejan registros importados" on importacion_registros
for all to authenticated
using (public.is_admin(auth.uid())) with check (public.is_admin(auth.uid()));

drop policy if exists "Admins manejan alias" on conductor_alias;
create policy "Admins manejan alias" on conductor_alias
for all to authenticated
using (public.is_admin(auth.uid())) with check (public.is_admin(auth.uid()));

-- El resultado lo ve y lo informa quien tiene salidas. Corregirlo es
-- insertar otra fila, no editar la que está.
drop policy if exists "Ver resultados de salidas" on salida_resultados;
create policy "Ver resultados de salidas" on salida_resultados
for select to authenticated
using (public.can_access_module('salidas') or public.can_access_module('salidas_grupo'));

drop policy if exists "Informar el resultado" on salida_resultados;
create policy "Informar el resultado" on salida_resultados
for insert to authenticated
with check (
  (public.can_access_module('salidas') or public.can_access_module('salidas_grupo'))
  and informado_por = auth.uid()
);

-- Igual que cobertura_eventos: la inmutabilidad va por privilegio, no
-- por política. Una política se puede reemplazar desde la app; un
-- privilegio revocado, no.
revoke update, delete on public.salida_resultados from authenticated;
grant select, insert on public.salida_resultados to authenticated;

drop policy if exists "Ver el historial del territorio" on territorio_historial;
create policy "Ver el historial del territorio" on territorio_historial
for select to authenticated
using (
  public.can_access_module('mapas')
  or public.can_access_module('salidas')
  or public.can_access_module('territorio_personal')
);

drop policy if exists "Admins escriben el historial" on territorio_historial;
create policy "Admins escriben el historial" on territorio_historial
for insert to authenticated
with check (public.is_admin(auth.uid()));

revoke update, delete on public.territorio_historial from authenticated;
grant select, insert on public.territorio_historial to authenticated;

drop policy if exists "Ver territorios del grupo" on grupo_territorio;
create policy "Ver territorios del grupo" on grupo_territorio
for select to authenticated
using (
  public.can_access_module('grupos')
  or public.can_access_module('salidas')
  or public.can_access_module('salidas_grupo')
);

drop policy if exists "Admins asignan territorios a grupos" on grupo_territorio;
create policy "Admins asignan territorios a grupos" on grupo_territorio
for all to authenticated
using (public.is_admin(auth.uid())) with check (public.is_admin(auth.uid()));

grant select on public.salida_resultado_actual to authenticated;

do $$
begin
  if current_setting('server_version_num')::int >= 150000 then
    execute 'alter view salida_resultado_actual set (security_invoker = on)';
  end if;
end
$$;

commit;
