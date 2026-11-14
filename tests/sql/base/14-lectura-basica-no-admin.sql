\set ON_ERROR_STOP on
-- G2: un hermano común y un superintendente leen lo suyo; no lo ajeno.

-- Las políticas de lectura de producción antes de la migración (supabase/schema.sql
-- y 20260902120000): sólo pasa quien tiene el módulo, y hoy eso es sólo el admin.
alter table public.grupos_servicio enable row level security;
alter table public.puntos_encuentro enable row level security;
alter table public.conductores enable row level security;
create policy "Users with grupos can read groups" on public.grupos_servicio
  for select to authenticated
  using (public.can_access_module('grupos') or public.can_access_module('salidas') or public.can_access_module('salidas_grupo'));
create policy "Leer puntos de encuentro" on public.puntos_encuentro
  for select to authenticated
  using (public.can_access_module('salidas') or public.can_access_module('salidas_grupo') or public.can_access_module('mapas'));
create policy "Users with conductores can read drivers" on public.conductores
  for select to authenticated
  using (public.can_access_module('conductores') or public.can_access_module('salidas') or public.can_access_module('salidas_grupo'));
create policy "Admins gestionan puntos de encuentro" on public.puntos_encuentro
  for all to authenticated using (public.is_admin(auth.uid())) with check (public.is_admin(auth.uid()));
grant select, insert, update, delete on public.grupos_servicio, public.puntos_encuentro, public.conductores to authenticated;
grant select on public.profiles, public.grupo_miembros to authenticated;
grant select on public.mi_contexto to authenticated;

insert into public.puntos_encuentro (id, nombre, tipo, group_id, activo, lat, lng) values
  ('50000000-0000-0000-0000-000000000001', 'Plaza (territorial)', 'territorial', null, true, -31.5, -68.5),
  ('50000000-0000-0000-0000-000000000002', 'Casa del Grupo A', 'grupo', '10000000-0000-0000-0000-000000000001', true, -31.51, -68.51),
  ('50000000-0000-0000-0000-000000000003', 'Casa del Grupo B', 'grupo', '10000000-0000-0000-0000-000000000002', true, -31.52, -68.52),
  ('50000000-0000-0000-0000-000000000004', 'Punto viejo', 'territorial', null, false, -31.53, -68.53);

-- 1. Antes: el hermano ve todo en blanco (el problema).
set role authenticated;
select public.actuar_como('00000000-0000-0000-0000-000000000002');
select public.assert_true(
  (select count(*) from public.grupos_servicio) = 0
  and (select count(*) from public.puntos_encuentro) = 0
  and (select group_name is null and punto_grupo_nombre is null from public.mi_contexto),
  'El fixture no reproduce el problema: el hermano ya veía su grupo'
);
reset role;

\ir ../../../supabase/migrations/20261113050000_lectura_basica_no_admin.sql
\ir ../../../supabase/migrations/20261113050000_lectura_basica_no_admin.sql

set role authenticated;

-- 2. Hermano del grupo A: su grupo, su punto y los lugares públicos; nada ajeno.
select public.actuar_como('00000000-0000-0000-0000-000000000002');
select public.assert_true(
  (select array_agg(group_name order by group_name) from public.grupos_servicio) = array['Grupo A']
  and (select array_agg(nombre order by nombre) from public.puntos_encuentro)
      = array['Casa del Grupo A', 'Plaza (territorial)']
  and (select count(*) from public.conductores) = 0
  and (select group_name = 'Grupo A' and punto_grupo_nombre = 'Casa del Grupo A' from public.mi_contexto),
  'El hermano del grupo A no ve lo suyo, o ve lo ajeno'
);

-- 3. Superintendente del grupo A y pendiente del grupo A: ídem.
select public.actuar_como('00000000-0000-0000-0000-000000000004');
select public.assert_true(
  (select array_agg(group_name) from public.grupos_servicio) = array['Grupo A']
  and (select punto_grupo_nombre = 'Casa del Grupo A' from public.mi_contexto),
  'El superintendente no ve su grupo y su punto'
);
select public.actuar_como('00000000-0000-0000-0000-000000000003');
select public.assert_true(
  (select array_agg(group_name) from public.grupos_servicio) = array['Grupo A'],
  'El miembro pendiente no ve el grupo al que se sumó'
);

-- 4. Grupo B: el suyo y no el de A.
select public.actuar_como('00000000-0000-0000-0000-000000000005');
select public.assert_true(
  (select array_agg(group_name) from public.grupos_servicio) = array['Grupo B']
  and (select array_agg(nombre order by nombre) from public.puntos_encuentro)
      = array['Casa del Grupo B', 'Plaza (territorial)'],
  'El hermano del grupo B ve lo del grupo A o no ve lo suyo'
);

-- 5. Sin grupo: sólo los lugares públicos activos.
select public.actuar_como('00000000-0000-0000-0000-000000000007');
select public.assert_true(
  (select count(*) from public.grupos_servicio) = 0
  and (select array_agg(nombre) from public.puntos_encuentro) = array['Plaza (territorial)'],
  'La cuenta sin grupo ve grupos o puntos de grupo'
);

-- 6. Conductor con cuenta: sólo su ficha.
select public.actuar_como('00000000-0000-0000-0000-00000000000a');
select public.assert_true(
  (select array_agg(id) from public.conductores) = array['70000000-0000-0000-0000-000000000001'::uuid],
  'El conductor no ve su ficha, o ve la de otros'
);

-- 7. El administrador sigue viendo todo (incluido lo inactivo).
select public.actuar_como('00000000-0000-0000-0000-000000000006');
select public.assert_true(
  (select count(*) from public.grupos_servicio) = 2
  and (select count(*) from public.puntos_encuentro) = 4
  and (select count(*) from public.conductores) = 2,
  'El administrador dejó de ver todo'
);

-- 8. Nada de esto da permiso para escribir.
select public.actuar_como('00000000-0000-0000-0000-000000000004');
select public.assert_raises(
  $$insert into public.puntos_encuentro (nombre, tipo, group_id) values ('Falso', 'grupo', '10000000-0000-0000-0000-000000000001')$$,
  '42501');
update public.grupos_servicio set group_name = 'Otro' where id = '10000000-0000-0000-0000-000000000001';
reset role;
select public.assert_true(
  (select group_name = 'Grupo A' from public.grupos_servicio where id = '10000000-0000-0000-0000-000000000001'),
  'El superintendente pudo renombrar el grupo con la lectura nueva'
);

-- 9. Una cuenta dada de baja no lee nada.
update public.profiles set access_status = 'inactive' where id = '00000000-0000-0000-0000-000000000002';
set role authenticated;
select public.actuar_como('00000000-0000-0000-0000-000000000002');
select public.assert_true(
  (select count(*) from public.grupos_servicio) = 0 and (select count(*) from public.puntos_encuentro) = 0,
  'Una cuenta inactiva lee grupos o puntos'
);
reset role;

select 'PASS: lectura básica de grupo, punto y ficha para quien no es admin' as resultado;
