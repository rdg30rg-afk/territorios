\set ON_ERROR_STOP on
-- borrar_salida: no existe antes, existe y autoriza bien después.

select public.assert_true(
  not exists (select 1 from pg_proc where proname = 'borrar_salida'),
  'borrar_salida ya existía antes de la migración: el fixture no refleja la base'
);

\ir ../../../supabase/migrations/20261113010000_borrar_salida.sql
\ir ../../../supabase/migrations/20261113010000_borrar_salida.sql

insert into public.salidas (id, title, group_id, territory_id, origen, scheduled_for) values
  ('60000000-0000-0000-0000-000000000001', 'General libre', null, '20000000-0000-0000-0000-000000000001', 'app', now() + interval '3 days'),
  ('60000000-0000-0000-0000-000000000002', 'Del grupo A', '10000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000002', 'app', now() + interval '3 days'),
  ('60000000-0000-0000-0000-000000000003', 'Importada', null, '20000000-0000-0000-0000-000000000003', 'excel', now() - interval '30 days'),
  ('60000000-0000-0000-0000-000000000004', 'Con resultado', null, '20000000-0000-0000-0000-000000000004', 'app', now() - interval '1 day'),
  ('60000000-0000-0000-0000-000000000005', 'Del grupo B', '10000000-0000-0000-0000-000000000002', '20000000-0000-0000-0000-000000000002', 'app', now() + interval '4 days'),
  ('60000000-0000-0000-0000-000000000006', 'Otra del grupo A', '10000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000002', 'app', now() + interval '5 days');
insert into public.salida_resultados (salida_id, estado) values ('60000000-0000-0000-0000-000000000004', 'realizada');

set role authenticated;

-- Sin sesión.
select public.actuar_como('');
select public.assert_raises($$select public.borrar_salida('general', '60000000-0000-0000-0000-000000000001')$$, '42501');

-- Un publicador cualquiera no borra nada, ni general ni de grupo.
select public.actuar_como('00000000-0000-0000-0000-000000000002');
select public.assert_raises($$select public.borrar_salida('general', '60000000-0000-0000-0000-000000000001')$$, '42501', 'No tenés permiso%');
select public.assert_raises($$select public.borrar_salida('grupo', '60000000-0000-0000-0000-000000000002')$$, '42501', 'No tenés permiso%');

-- El responsable del grupo A borra la salida de su grupo, no la general ni la de otro grupo.
select public.actuar_como('00000000-0000-0000-0000-000000000004');
select public.assert_raises($$select public.borrar_salida('general', '60000000-0000-0000-0000-000000000001')$$, '42501');
select public.assert_raises($$select public.borrar_salida('grupo', '60000000-0000-0000-0000-000000000005')$$, '42501');
select public.assert_raises($$select public.borrar_salida('grupo', '60000000-0000-0000-0000-000000000001')$$, '42501');
select public.assert_raises($$select public.borrar_salida('xx', '60000000-0000-0000-0000-000000000002')$$, '22023');
select public.assert_true(
  public.borrar_salida('grupo', '60000000-0000-0000-0000-000000000002') = '60000000-0000-0000-0000-000000000002',
  'El responsable no pudo borrar la salida de su grupo'
);

-- Un administrador de territorios borra la general y la de cualquier grupo.
select public.actuar_como('00000000-0000-0000-0000-000000000006');
select public.assert_true(
  public.borrar_salida('general', '60000000-0000-0000-0000-000000000001') is not null
  and public.borrar_salida('grupo', '60000000-0000-0000-0000-000000000005') is not null,
  'El admin de territorios no pudo borrar'
);
-- Y el superadmin.
select public.actuar_como('00000000-0000-0000-0000-000000000001');
select public.assert_true(
  public.borrar_salida('general', '60000000-0000-0000-0000-000000000006') is not null,
  'El superadmin no pudo borrar'
);

-- Una salida que ya no existe, una importada y una con resultados no se borran.
select public.assert_raises($$select public.borrar_salida('general', '60000000-0000-0000-0000-000000000001')$$, '22023', 'La salida no existe');
select public.assert_raises($$select public.borrar_salida('general', '60000000-0000-0000-0000-000000000003')$$, '55000');
select public.assert_raises($$select public.borrar_salida('general', '60000000-0000-0000-0000-000000000004')$$, '23503', '%resultados informados%');

reset role;
select public.assert_true(
  (select count(*) from public.salidas) = 2
  and exists (select 1 from public.salidas where id = '60000000-0000-0000-0000-000000000003')
  and exists (select 1 from public.salidas where id = '60000000-0000-0000-0000-000000000004'),
  'Quedaron salidas de más o de menos'
);

-- Una cuenta pendiente no puede, aunque el rol venga de antes.
update public.profiles set access_status = 'inactive' where id = '00000000-0000-0000-0000-000000000006';
set role authenticated;
select public.actuar_como('00000000-0000-0000-0000-000000000006');
select public.assert_raises($$select public.borrar_salida('general', '60000000-0000-0000-0000-000000000003')$$, '42501');
reset role;
update public.profiles set access_status = 'active' where id = '00000000-0000-0000-0000-000000000006';

select 'PASS: borrar_salida' as resultado;
