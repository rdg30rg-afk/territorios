\set ON_ERROR_STOP on
insert into territorios values('10000000-0000-0000-0000-000000000001','Prueba'),('10000000-0000-0000-0000-000000000002','Legacy');
insert into territorio_personal_reservas(id,territory_id,reserved_for,status) values
 ('20000000-0000-0000-0000-000000000002','10000000-0000-0000-0000-000000000002','Publicador prueba','activa');
set role authenticated;
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000000002',false);
do $$ declare a uuid;b uuid; begin
 if public.territorio_es_mio('10000000-0000-0000-0000-000000000002') then raise exception 'nombre legacy otorgó propiedad';end if;
 begin
  perform public.gestionar_reserva('20000000-0000-0000-0000-000000000002','devolver');raise exception 'no dueño devolvió legacy';
 exception when insufficient_privilege then null;end;
 a:=public.solicitar_territorio('10000000-0000-0000-0000-000000000001');
 b:=public.solicitar_territorio('10000000-0000-0000-0000-000000000001');
 if a<>b then raise exception 'pedido duplicado';end if;
 begin
  perform public.gestionar_reserva(a,'aprobar',auth.uid());raise exception 'autoaprobación permitida';
 exception when insufficient_privilege then null;end;
end $$;
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000000001',false);
select public.asignar_territorio('10000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-000000000002');
select public.asignar_territorio('10000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-000000000002');
do $$ begin
 begin
  perform public.asignar_territorio('10000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-000000000003');raise exception 'doble reserva';
 exception when unique_violation then null;end;
end $$;
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000000002',false);
do $$ declare r uuid;begin
 if not public.territorio_es_mio('10000000-0000-0000-0000-000000000001') then raise exception 'beneficiario no reconocido';end if;
 perform public.actualizar_mi_nombre('Nombre cambiado');
 if not public.territorio_es_mio('10000000-0000-0000-0000-000000000001') then raise exception 'cambiar nombre perdió propiedad';end if;
 select id into r from territorio_personal_reservas where territory_id='10000000-0000-0000-0000-000000000001';
 perform public.gestionar_reserva(r,'devolver');
 perform public.gestionar_reserva(r,'devolver');
 if public.territorio_es_mio('10000000-0000-0000-0000-000000000001') then raise exception 'devolución conserva propiedad';end if;
 begin
  delete from reserva_movimientos;raise exception 'movimientos borrables';
 exception when insufficient_privilege then null;end;
end $$;
reset role;
do $$ begin
 if (select count(*) from reserva_movimientos)<>3 then raise exception 'acciones duplicaron historial';end if;
 if (select count(*) from territorio_personal_reservas where territory_id='10000000-0000-0000-0000-000000000001')<>1 then raise exception 'pedido no resuelto en su propia fila';end if;
end $$;
select 'PASS: solicitud y asignación idempotentes; exclusividad; propiedad por ID; devolución y bitácora inmutable; legacy sin autoasignar' as resultado;
