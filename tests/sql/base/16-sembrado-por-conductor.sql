\set ON_ERROR_STOP on
-- A3: el sembrado de responsables de grupo empareja por conductor, no por nombre.

insert into public.conductores (id, full_name) values ('70000000-0000-0000-0000-000000000003', 'Conductor Tres');
insert into public.profiles (id, full_name, role, access_status, driver_id) values
  ('00000000-0000-0000-0000-00000000000b', 'Doble grupo', 'viewer', 'active', '70000000-0000-0000-0000-000000000003');

-- Responsables importados: A (conductor 1, «Juan Perez»), B (conductor 2, «Pedro Gomez», sin cuenta)
-- y el conductor 3 figurando en los dos grupos.
insert into public.grupo_responsables_importados (source_group_id, group_id, driver_id, manager_name, manager_role) values
  ('11000000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-000000000001', '70000000-0000-0000-0000-000000000001', 'Juan Perez', 'superintendente'),
  ('11000000-0000-0000-0000-000000000002', '10000000-0000-0000-0000-000000000002', '70000000-0000-0000-0000-000000000002', 'Pedro Gomez', 'siervo'),
  ('11000000-0000-0000-0000-000000000003', '10000000-0000-0000-0000-000000000001', '70000000-0000-0000-0000-000000000003', 'Doble Grupo', 'auxiliar'),
  ('11000000-0000-0000-0000-000000000004', '10000000-0000-0000-0000-000000000002', '70000000-0000-0000-0000-000000000003', 'Doble Grupo', 'auxiliar');

-- 1. Con la función de producción alcanza con llamarse igual para quedar de responsable.
update public.profiles set full_name = 'pedro gomez ' where id = '00000000-0000-0000-0000-000000000007';
select public.sembrar_encargados_de_grupo();
select public.assert_true(
  exists (select 1 from public.grupo_miembros
          where profile_id = '00000000-0000-0000-0000-000000000007'
            and group_id = '10000000-0000-0000-0000-000000000002'
            and rol_en_grupo = 'siervo' and estado = 'confirmado' and hasta is null),
  'El fixture no reproduce el sembrado por nombre'
);
-- Se deshace todo lo sembrado para partir de cero.
delete from public.grupo_miembro_movimientos;
delete from public.grupo_miembros where profile_id in
  ('00000000-0000-0000-0000-000000000007', '00000000-0000-0000-0000-00000000000a', '00000000-0000-0000-0000-00000000000b');

\ir ../../../supabase/migrations/20261113070000_sembrado_encargados_por_conductor.sql
\ir ../../../supabase/migrations/20261113070000_sembrado_encargados_por_conductor.sql

-- 2. El homónimo ya no queda de responsable, aunque se vuelva a sembrar.
select public.sembrar_encargados_de_grupo();
select public.assert_true(
  not exists (select 1 from public.grupo_miembros where profile_id = '00000000-0000-0000-0000-000000000007'),
  'Quien se llama igual quedó de responsable'
);

-- 3. La cuenta vinculada al conductor 1 queda de superintendente del A.
select public.assert_true(
  exists (select 1 from public.grupo_miembros
          where profile_id = '00000000-0000-0000-0000-00000000000a'
            and group_id = '10000000-0000-0000-0000-000000000001'
            and rol_en_grupo = 'superintendente' and estado = 'confirmado' and hasta is null),
  'La cuenta vinculada al conductor responsable no quedó sembrada'
);

-- 4. El conductor en dos grupos no se siembra en ninguno.
select public.assert_true(
  not exists (select 1 from public.grupo_miembros where profile_id = '00000000-0000-0000-0000-00000000000b'),
  'Se sembró un conductor ambiguo'
);

-- 5. A quien un administrador sacó del grupo no se lo vuelve a sembrar.
update public.grupo_miembros set estado = 'retirado', hasta = current_date
 where profile_id = '00000000-0000-0000-0000-00000000000a' and hasta is null;
select public.sembrar_encargados_de_grupo();
select public.sembrar_encargados_de_grupo();
select public.assert_true(
  (select count(*) from public.grupo_miembros where profile_id = '00000000-0000-0000-0000-00000000000a') = 1
  and not exists (select 1 from public.grupo_miembros
                  where profile_id = '00000000-0000-0000-0000-00000000000a' and hasta is null),
  'Se volvió a sembrar a quien se había sacado del grupo'
);

-- 6. Un administrador que vincula un conductor a una cuenta sí la siembra (el disparador de perfiles).
update public.profiles set driver_id = '70000000-0000-0000-0000-000000000002' where id = '00000000-0000-0000-0000-000000000007';
select public.assert_true(
  exists (select 1 from public.grupo_miembros
          where profile_id = '00000000-0000-0000-0000-000000000007'
            and group_id = '10000000-0000-0000-0000-000000000002' and rol_en_grupo = 'siervo' and estado = 'confirmado'),
  'Vincular el conductor responsable a la cuenta no la sembró'
);

select 'PASS: sembrado de responsables por conductor' as resultado;
