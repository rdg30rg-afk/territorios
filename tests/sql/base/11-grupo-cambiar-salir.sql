\set ON_ERROR_STOP on
-- G1: cambiar de grupo y salir del grupo.

-- 1. Con las funciones de producción el error se reproduce: la base rechaza la
--    membresía cerrada sin estado «retirado».
set role authenticated;
select public.actuar_como('00000000-0000-0000-0000-000000000002');
select public.assert_raises($$select public.unirme_a_grupo('BBBBBB')$$, '23514', '%retiro_coherente%');
select public.assert_raises($$select public.salir_de_mi_grupo()$$, '23514', '%retiro_coherente%');
reset role;

\ir ../../../supabase/migrations/20261113020000_grupo_cambiar_y_salir.sql
\ir ../../../supabase/migrations/20261113020000_grupo_cambiar_y_salir.sql

set role authenticated;

-- 2. Cambiar de grupo: queda retirado del A y pendiente en el B.
select public.actuar_como('00000000-0000-0000-0000-000000000002');
select public.assert_true(
  public.unirme_a_grupo('bbbbbb ') = '10000000-0000-0000-0000-000000000002',
  'unirme_a_grupo no devolvió el grupo B'
);
reset role;
select public.assert_true(
  exists (select 1 from public.grupo_miembros
          where profile_id = '00000000-0000-0000-0000-000000000002'
            and group_id = '10000000-0000-0000-0000-000000000001'
            and estado = 'retirado' and hasta is not null)
  and exists (select 1 from public.grupo_miembros
              where profile_id = '00000000-0000-0000-0000-000000000002'
                and group_id = '10000000-0000-0000-0000-000000000002'
                and estado = 'pendiente' and hasta is null and rol_en_grupo = 'publicador')
  and (select count(*) from public.grupo_miembros
       where profile_id = '00000000-0000-0000-0000-000000000002' and hasta is null) = 1,
  'El cambio de grupo no dejó una sola membresía vigente, pendiente, en el grupo B'
);
select public.assert_true(
  exists (select 1 from public.grupo_miembro_movimientos
          where profile_id = '00000000-0000-0000-0000-000000000002'
            and group_id = '10000000-0000-0000-0000-000000000001' and accion = 'retiro')
  and exists (select 1 from public.grupo_miembro_movimientos
              where profile_id = '00000000-0000-0000-0000-000000000002'
                and group_id = '10000000-0000-0000-0000-000000000002' and accion = 'ingreso'),
  'No quedó auditado el retiro del A y el ingreso al B'
);

-- 3. Volver a pegar el código del grupo en el que ya estás no cambia nada.
set role authenticated;
select public.actuar_como('00000000-0000-0000-0000-000000000004');
select public.assert_true(
  public.unirme_a_grupo('AAAAAA') = '10000000-0000-0000-0000-000000000001',
  'unirme al propio grupo no devolvió el grupo'
);
reset role;
select public.assert_true(
  exists (select 1 from public.grupo_miembros
          where profile_id = '00000000-0000-0000-0000-000000000004'
            and estado = 'confirmado' and rol_en_grupo = 'superintendente' and hasta is null)
  and (select count(*) from public.grupo_miembros where profile_id = '00000000-0000-0000-0000-000000000004') = 1,
  'El superintendente perdió su cargo por repetir el código de su grupo'
);

-- 4. Código que no existe.
set role authenticated;
select public.actuar_como('00000000-0000-0000-0000-000000000002');
select public.assert_raises($$select public.unirme_a_grupo('ZZZZZZ')$$, '22023', 'Ese código no es de ningún grupo%');

-- 5. Salir del grupo.
select public.actuar_como('00000000-0000-0000-0000-000000000005');
select public.salir_de_mi_grupo();
select public.salir_de_mi_grupo(); -- sin grupo: no falla
reset role;
select public.assert_true(
  exists (select 1 from public.grupo_miembros
          where profile_id = '00000000-0000-0000-0000-000000000005'
            and estado = 'retirado' and hasta is not null)
  and not exists (select 1 from public.grupo_miembros
                  where profile_id = '00000000-0000-0000-0000-000000000005' and hasta is null),
  'Salir del grupo no dejó la membresía retirada'
);

-- 6. Una cuenta nueva pendiente se activa al unirse.
set role authenticated;
select public.actuar_como('00000000-0000-0000-0000-000000000008');
select public.unirme_a_grupo('AAAAAA');
reset role;
select public.assert_true(
  (select access_status = 'active' from public.profiles where id = '00000000-0000-0000-0000-000000000008')
  and exists (select 1 from public.grupo_miembros
              where profile_id = '00000000-0000-0000-0000-000000000008' and estado = 'pendiente' and hasta is null),
  'La cuenta pendiente no se activó o no quedó pendiente en el grupo'
);

-- 7. Quien sale y vuelve a entrar al mismo grupo entra otra vez como pendiente.
set role authenticated;
select public.actuar_como('00000000-0000-0000-0000-000000000009');
select public.salir_de_mi_grupo();
select public.unirme_a_grupo('AAAAAA');
reset role;
select public.assert_true(
  (select count(*) from public.grupo_miembros where profile_id = '00000000-0000-0000-0000-000000000009') = 2
  and exists (select 1 from public.grupo_miembros
              where profile_id = '00000000-0000-0000-0000-000000000009' and estado = 'pendiente' and hasta is null),
  'Salir y volver no dejó historial más una membresía pendiente'
);

-- 8. Sin sesión no se puede.
set role authenticated;
select public.actuar_como('');
select public.assert_raises($$select public.unirme_a_grupo('AAAAAA')$$, '42501');
select public.assert_raises($$select public.salir_de_mi_grupo()$$, '42501');
reset role;

select 'PASS: cambiar de grupo y salir del grupo' as resultado;
