\set ON_ERROR_STOP on
-- Un administrador de territorios o superadmin puede marcar y corregir cualquier territorio.

insert into public.salidas (id, title, territory_id, origen, scheduled_for) values
  ('60000000-0000-0000-0000-0000000000a1', 'Salida del territorio 3', '20000000-0000-0000-0000-000000000003', 'app', now()),
  ('60000000-0000-0000-0000-0000000000a2', 'Salida del territorio 1', '20000000-0000-0000-0000-000000000001', 'app', now());

-- El territorio 1 es de la cuenta 2.
set role authenticated;
select public.actuar_como('00000000-0000-0000-0000-000000000001');
select public.asignar_territorio('20000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000002');

-- 1. Con la función de producción, un admin de territorios NO puede marcar un territorio ajeno.
select public.actuar_como('00000000-0000-0000-0000-000000000006');
select public.assert_raises(
  $$select public.informar_cobertura('61000000-0000-0000-0000-000000000001', '31000000-0000-0000-0000-000000000003', 'recorrido', p_geometry_version => 1)$$,
  '42501', 'Solo podés informar tu territorio asignado');
select public.assert_raises(
  $$select public.informar_cobertura('61000000-0000-0000-0000-000000000001', '31000000-0000-0000-0000-000000000003', 'recorrido', 'admin', p_geometry_version => 1)$$,
  '22023', 'Origen inválido');
reset role;

\ir ../../../supabase/migrations/20261113040000_cobertura_admin_marca.sql
\ir ../../../supabase/migrations/20261113040000_cobertura_admin_marca.sql

set role authenticated;

-- 2. Admin de territorios marca un territorio que no es suyo y una cuadra sin marcas previas.
select public.actuar_como('00000000-0000-0000-0000-000000000006');
select public.assert_true(
  public.informar_cobertura('61000000-0000-0000-0000-000000000001', '31000000-0000-0000-0000-000000000003',
    'recorrido', 'admin', p_geometry_version => 1) = '61000000-0000-0000-0000-000000000001',
  'El admin de territorios no pudo marcar'
);
-- Reintento con el mismo id: misma marca; con otro estado: error de id reciclado.
select public.assert_true(
  public.informar_cobertura('61000000-0000-0000-0000-000000000001', '31000000-0000-0000-0000-000000000003',
    'recorrido', 'admin', p_geometry_version => 1) = '61000000-0000-0000-0000-000000000001',
  'El reintento idempotente no devolvió la misma marca'
);
select public.assert_raises(
  $$select public.informar_cobertura('61000000-0000-0000-0000-000000000001', '31000000-0000-0000-0000-000000000003', 'sin_dato', 'admin', p_geometry_version => 1)$$,
  '23505');

-- 3. Queda registrado quién marcó.
reset role;
select public.assert_true(
  (select informado_por = '00000000-0000-0000-0000-000000000006'
      and origen = 'admin'
      and origen_detalle ->> 'marcado_por_rol' = 'admin_territorios'
      and territory_id = '20000000-0000-0000-0000-000000000003'
   from public.cobertura_eventos where id = '61000000-0000-0000-0000-000000000001'),
  'La marca del admin no quedó con su cuenta, origen y nivel'
);

-- 4. El superadmin también; con salida del mismo territorio sí, de otro no.
set role authenticated;
select public.actuar_como('00000000-0000-0000-0000-000000000001');
select public.informar_cobertura('61000000-0000-0000-0000-000000000002', '31000000-0000-0000-0000-000000000003',
  'revisitar', 'admin', '60000000-0000-0000-0000-0000000000a1', null, 'Se vio gente', 1);
select public.assert_raises(
  $$select public.informar_cobertura('61000000-0000-0000-0000-000000000003', '31000000-0000-0000-0000-000000000003', 'recorrido', 'admin', '60000000-0000-0000-0000-0000000000a2', null, null, 1)$$,
  '22023', 'Esa salida no es de este territorio');

-- 5. Corregir una marca (la propia o ajena) en cualquier territorio, sin pasar por 'correccion'.
select public.informar_cobertura('61000000-0000-0000-0000-000000000004', '31000000-0000-0000-0000-000000000003',
  'recorrido', 'admin', null, '61000000-0000-0000-0000-000000000002', 'Se había marcado mal', 1);
select public.assert_raises(
  $$select public.informar_cobertura('61000000-0000-0000-0000-000000000005', '31000000-0000-0000-0000-000000000001', 'recorrido', 'admin', null, '61000000-0000-0000-0000-000000000002', null, 1)$$,
  '22023', 'Elegí el evento de esta cuadra%');
-- La corrección de siempre sigue funcionando.
select public.informar_cobertura('61000000-0000-0000-0000-000000000006', '31000000-0000-0000-0000-000000000003',
  'sin_dato', 'correccion', null, '61000000-0000-0000-0000-000000000004', 'Corrección clásica', 1);

-- 6. Quien no es administrador no puede usar el origen 'admin' en ningún territorio.
select public.actuar_como('00000000-0000-0000-0000-000000000009');
select public.assert_raises(
  $$select public.informar_cobertura('61000000-0000-0000-0000-000000000007', '31000000-0000-0000-0000-000000000003', 'recorrido', 'admin', p_geometry_version => 1)$$,
  '42501', 'Solo un administrador de territorios%');
select public.actuar_como('00000000-0000-0000-0000-000000000004'); -- responsable de grupo
select public.assert_raises(
  $$select public.informar_cobertura('61000000-0000-0000-0000-000000000007', '31000000-0000-0000-0000-000000000003', 'recorrido', 'admin', p_geometry_version => 1)$$,
  '42501', 'Solo un administrador de territorios%');

-- 7. El hermano dueño sigue marcando lo suyo.
select public.actuar_como('00000000-0000-0000-0000-000000000002');
select public.informar_cobertura('61000000-0000-0000-0000-000000000008', '31000000-0000-0000-0000-000000000001',
  'recorrido', p_geometry_version => 1);

-- 8. El dibujo viejo y la cuadra retirada se rechazan también para el admin.
select public.actuar_como('00000000-0000-0000-0000-000000000006');
select public.assert_raises(
  $$select public.informar_cobertura('61000000-0000-0000-0000-000000000009', '31000000-0000-0000-0000-000000000003', 'recorrido', 'admin', p_geometry_version => 2)$$,
  '40001');
reset role;
update public.manzana_lados set vigente_hasta = now() where id = '31000000-0000-0000-0000-000000000001';
set role authenticated;
select public.assert_raises(
  $$select public.informar_cobertura('61000000-0000-0000-0000-000000000009', '31000000-0000-0000-0000-000000000001', 'recorrido', 'admin', p_geometry_version => 1)$$,
  '40001');
reset role;

-- 9. La tabla sigue rechazando orígenes inventados y a authenticated no le deja escribir directo.
select public.assert_raises(
  $$insert into public.cobertura_eventos (lado_id, manzana_id, territory_id, estado, origen)
    values ('31000000-0000-0000-0000-000000000003', '30000000-0000-0000-0000-000000000003', '20000000-0000-0000-0000-000000000003', 'recorrido', 'inventado')$$,
  '23514');

-- 10. Un admin dado de baja ya no marca.
update public.profiles set access_status = 'inactive' where id = '00000000-0000-0000-0000-000000000006';
set role authenticated;
select public.actuar_como('00000000-0000-0000-0000-000000000006');
select public.assert_raises(
  $$select public.informar_cobertura('61000000-0000-0000-0000-00000000000a', '31000000-0000-0000-0000-000000000003', 'recorrido', 'admin', p_geometry_version => 1)$$,
  '42501');
reset role;
update public.profiles set access_status = 'active' where id = '00000000-0000-0000-0000-000000000006';

select public.assert_true(
  (select count(*) from public.cobertura_eventos) = 5,
  'Cantidad de eventos de cobertura inesperada'
);

select 'PASS: cobertura marcada por administradores' as resultado;
