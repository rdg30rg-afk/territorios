\set ON_ERROR_STOP on
-- Pedir y aprobar un territorio que ya tiene asignación vigente de otra persona (+ B6).

-- Estado de partida: el territorio 1 está asignado a la cuenta 2.
set role authenticated;
select public.actuar_como('00000000-0000-0000-0000-000000000001');
select public.asignar_territorio('20000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000002');

-- 1. Con las funciones de producción el pedido de otra persona entra igual (el problema).
select public.actuar_como('00000000-0000-0000-0000-000000000009');
select public.assert_true(
  public.solicitar_territorio('20000000-0000-0000-0000-000000000001') is not null,
  'El fixture no reproduce el pedido sobre un territorio ya asignado'
);
reset role;
-- Se limpia ese pedido para que las pruebas de abajo partan de cero.
delete from public.reserva_movimientos
 where reserva_id in (select id from public.territorio_personal_reservas where requested_by = '00000000-0000-0000-0000-000000000009');
delete from public.territorio_personal_reservas where requested_by = '00000000-0000-0000-0000-000000000009';

\ir ../../../supabase/migrations/20261113030000_reservas_bloquear_territorio_asignado.sql
\ir ../../../supabase/migrations/20261113030000_reservas_bloquear_territorio_asignado.sql

set role authenticated;

-- 2. Pedir un territorio asignado a otra persona: bloqueado, con mensaje claro.
select public.actuar_como('00000000-0000-0000-0000-000000000009');
select public.assert_raises(
  $$select public.solicitar_territorio('20000000-0000-0000-0000-000000000001')$$,
  '23505', 'Este territorio ya está asignado a otra persona%');
select public.actuar_como('00000000-0000-0000-0000-000000000002');
select public.assert_raises(
  $$select public.solicitar_territorio('20000000-0000-0000-0000-000000000001')$$,
  '22023', 'Ya tenés este territorio asignado');
reset role;
select public.assert_true(
  (select count(*) from public.territorio_personal_reservas where territory_id = '20000000-0000-0000-0000-000000000001') = 1,
  'El pedido bloqueado dejó una fila'
);

-- 3. Un territorio libre sí se puede pedir, y pedirlo dos veces devuelve el mismo pedido.
set role authenticated;
select public.actuar_como('00000000-0000-0000-0000-000000000009');
select public.assert_true(
  public.solicitar_territorio('20000000-0000-0000-0000-000000000002')
    = public.solicitar_territorio('20000000-0000-0000-0000-000000000002'),
  'Pedir dos veces el mismo territorio libre no devolvió el mismo pedido'
);

-- 4. Si mientras tanto el administrador se lo asigna a otra persona, aprobar ese pedido falla claro.
select public.actuar_como('00000000-0000-0000-0000-000000000001');
select public.asignar_territorio('20000000-0000-0000-0000-000000000002', '00000000-0000-0000-0000-000000000005');
select public.assert_raises(
  format($q$select public.gestionar_reserva(%L, 'aprobar')$q$,
    (select id from public.territorio_personal_reservas
      where territory_id = '20000000-0000-0000-0000-000000000002' and status = 'solicitada')),
  '23505', 'Este territorio ya está asignado a otra persona%');
select public.assert_raises(
  $$select public.asignar_territorio('20000000-0000-0000-0000-000000000002', '00000000-0000-0000-0000-000000000007')$$,
  '23505', 'Este territorio ya está asignado a otra persona%');

-- 5. B6: el responsable del grupo A decide sobre el pedido de un miembro de su grupo.
select public.actuar_como('00000000-0000-0000-0000-000000000009');
select public.solicitar_territorio('20000000-0000-0000-0000-000000000003');
select public.actuar_como('00000000-0000-0000-0000-000000000004');
select public.assert_raises(
  format($q$select public.gestionar_reserva(%L, 'aprobar', '00000000-0000-0000-0000-000000000005')$q$,
    (select id from public.territorio_personal_reservas
      where territory_id = '20000000-0000-0000-0000-000000000003' and status = 'solicitada')),
  '42501', 'Esa persona no es de tu grupo');
select public.assert_raises(
  format($q$select public.gestionar_reserva(%L, 'aprobar', '00000000-0000-0000-0000-000000000004')$q$,
    (select id from public.territorio_personal_reservas
      where territory_id = '20000000-0000-0000-0000-000000000003' and status = 'solicitada')),
  '42501', 'No podés aprobarte%');
select public.assert_true(
  public.gestionar_reserva(
    (select id from public.territorio_personal_reservas
      where territory_id = '20000000-0000-0000-0000-000000000003' and status = 'solicitada'),
    'aprobar') is not null,
  'El responsable no pudo aprobar el pedido de un miembro de su grupo'
);

-- 6. El responsable no se aprueba su propio pedido ni se asigna un territorio.
select public.solicitar_territorio('20000000-0000-0000-0000-000000000004');
select public.assert_raises(
  format($q$select public.gestionar_reserva(%L, 'aprobar')$q$,
    (select id from public.territorio_personal_reservas
      where territory_id = '20000000-0000-0000-0000-000000000004' and status = 'solicitada')),
  '42501', 'No podés aprobarte%');
select public.assert_raises(
  $$select public.asignar_territorio('20000000-0000-0000-0000-000000000004', '00000000-0000-0000-0000-000000000004')$$,
  '42501', 'No podés asignarte%');
-- ...ni asigna a alguien de otro grupo o sin grupo, ni a uno pendiente.
select public.assert_raises(
  $$select public.asignar_territorio('20000000-0000-0000-0000-000000000004', '00000000-0000-0000-0000-000000000005')$$,
  '42501', 'Solo un admin o el superintendente%');
select public.assert_raises(
  $$select public.asignar_territorio('20000000-0000-0000-0000-000000000004', '00000000-0000-0000-0000-000000000007')$$,
  '42501', 'Solo un admin o el superintendente%');
select public.assert_raises(
  $$select public.asignar_territorio('20000000-0000-0000-0000-000000000004', '00000000-0000-0000-0000-000000000003')$$,
  '42501', 'Primero confirmalo en el grupo');

-- 7. Un administrador sí puede aprobarle el pedido al responsable.
select public.actuar_como('00000000-0000-0000-0000-000000000006');
select public.assert_true(
  public.gestionar_reserva(
    (select id from public.territorio_personal_reservas
      where territory_id = '20000000-0000-0000-0000-000000000004' and status = 'solicitada'),
    'aprobar') is not null,
  'El admin de territorios no pudo aprobar el pedido del responsable'
);
reset role;

select public.assert_true(
  (select count(*) from public.territorio_personal_reservas where status = 'activa') = 4
  and (select assigned_to from public.territorio_personal_reservas
        where territory_id = '20000000-0000-0000-0000-000000000004' and status = 'activa')
      = '00000000-0000-0000-0000-000000000004',
  'Estado final de reservas inesperado'
);

select 'PASS: reservas, territorio asignado y aprobación del responsable' as resultado;
