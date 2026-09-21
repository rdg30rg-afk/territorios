-- Solo mediante verify-dev-access.mjs. Ninguna cuenta ni marca queda persistida.
\set ON_ERROR_STOP on
begin;
create temporary table qa_counts as select
 (select count(*) from public.territorio_personal_reservas) as reservas,
 (select count(*) from public.reserva_movimientos) as movimientos,
 (select count(*) from public.cobertura_eventos) as cobertura;
insert into auth.users(id,email,raw_user_meta_data) values
 ('90000000-0000-0000-0000-000000000001','codex-access-rollback-1@example.invalid','{"full_name":"Prueba transaccional"}'),
 ('90000000-0000-0000-0000-000000000002','codex-access-rollback-2@example.invalid','{"full_name":"Prueba transaccional"}'),
 ('90000000-0000-0000-0000-000000000003','codex-access-rollback-3@example.invalid','{"full_name":"Admin transaccional"}');
update public.profiles set access_status='active',role='viewer' where id='90000000-0000-0000-0000-000000000001';
update public.profiles set access_status='inactive',role='admin' where id='90000000-0000-0000-0000-000000000002';
update public.profiles set access_status='active',role='admin' where id='90000000-0000-0000-0000-000000000003';
insert into public.user_module_access(user_id,module_key) values('90000000-0000-0000-0000-000000000002','mapas');
do $$ declare territorio uuid; begin
 select t.id into territorio from public.territorios t
 where not exists (select 1 from public.territorio_personal_reservas r where r.territory_id=t.id and r.status='activa')
 and exists (select 1 from public.manzana_lados l join public.territorio_manzanas m on m.id=l.manzana_id
   where l.territory_id=t.id and l.vigente_hasta is null and m.vigente_hasta is null and m.geometry_version=l.geometry_version)
 order by t.id limit 1;
 if territorio is null then raise exception 'No hay territorio libre para prueba transaccional'; end if;
 perform set_config('qa.territorio',territorio::text,true);
 perform set_config('qa.lado',l.id::text,true), set_config('qa.version',l.geometry_version::text,true)
 from public.manzana_lados l join public.territorio_manzanas m on m.id=l.manzana_id
 where l.territory_id=territorio and l.vigente_hasta is null and m.vigente_hasta is null and m.geometry_version=l.geometry_version
 order by l.id limit 1;
end $$;
set local role authenticated;
select set_config('request.jwt.claim.sub','90000000-0000-0000-0000-000000000001',true);
do $$ begin
 if not public.es_usuario_activo() or public.can_access_module('mapas') then raise exception 'viewer sin módulos no autorizado correctamente'; end if;
 if (select count(*) from public.salidas) = 0 then raise exception 'viewer no puede leer programa real'; end if;
 if (select count(*) from public.territorios) = 0 then raise exception 'viewer no puede consultar territorios'; end if;
 begin
   perform public.administrar_acceso(auth.uid(),'admin','active','{}',null);
   raise exception 'escalación permitida';
 exception when insufficient_privilege then null; end;
 begin
   delete from public.cobertura_eventos;
   raise exception 'bitácora modificable';
 exception when insufficient_privilege then null; end;
end $$;
-- Flujo B real, todavía dentro de la misma transacción que se revierte.
do $$ declare pedido uuid; begin
 pedido:=public.solicitar_territorio(current_setting('qa.territorio')::uuid);
 if pedido<>public.solicitar_territorio(current_setting('qa.territorio')::uuid) then raise exception 'solicitud duplicada'; end if;
 perform set_config('qa.reserva',pedido::text,true);
 begin
  perform public.gestionar_reserva(pedido,'aprobar',auth.uid());
  raise exception 'publicador pudo autoaprobarse';
 exception when insufficient_privilege then null; end;
end $$;
select set_config('request.jwt.claim.sub','90000000-0000-0000-0000-000000000003',true);
select public.gestionar_reserva(current_setting('qa.reserva')::uuid,'aprobar','90000000-0000-0000-0000-000000000001');
select public.gestionar_reserva(current_setting('qa.reserva')::uuid,'aprobar','90000000-0000-0000-0000-000000000001');
select set_config('request.jwt.claim.sub','90000000-0000-0000-0000-000000000001',true);
do $$ begin
 if not public.territorio_es_mio(current_setting('qa.territorio')::uuid) then raise exception 'asignación invisible para beneficiario'; end if;
 perform public.actualizar_mi_nombre('Cambio transaccional de nombre');
 if not public.territorio_es_mio(current_setting('qa.territorio')::uuid) then raise exception 'nombre alteró propiedad'; end if;
 perform public.informar_cobertura('99000000-0000-0000-0000-000000000001',current_setting('qa.lado')::uuid,'recorrido','app_hermano',null,null,null,current_setting('qa.version')::integer);
 perform public.informar_cobertura('99000000-0000-0000-0000-000000000001',current_setting('qa.lado')::uuid,'recorrido','app_hermano',null,null,null,current_setting('qa.version')::integer);
 begin
  perform public.informar_cobertura('99000000-0000-0000-0000-000000000002',current_setting('qa.lado')::uuid,'recorrido','app_hermano',null,null,null,current_setting('qa.version')::integer+1);
  raise exception 'marca con versión incorrecta aceptada';
 exception when serialization_failure then null; end;
 perform public.gestionar_reserva(current_setting('qa.reserva')::uuid,'devolver');
 perform public.gestionar_reserva(current_setting('qa.reserva')::uuid,'devolver');
 if public.territorio_es_mio(current_setting('qa.territorio')::uuid) then raise exception 'devolución dejó propiedad'; end if;
 begin
  perform public.informar_cobertura('99000000-0000-0000-0000-000000000002',current_setting('qa.lado')::uuid,'revisitar','app_hermano',null,null,null,current_setting('qa.version')::integer);
  raise exception 'marca nueva aceptada después de devolución';
 exception when insufficient_privilege then null; end;
 begin
  update public.reserva_movimientos set nota='modificación prohibida';
  raise exception 'bitácora de reservas modificable';
 exception when insufficient_privilege then null; end;
end $$;
select set_config('request.jwt.claim.sub','90000000-0000-0000-0000-000000000003',true);
select public.informar_cobertura('99000000-0000-0000-0000-000000000002',current_setting('qa.lado')::uuid,'sin_dato','correccion',null,'99000000-0000-0000-0000-000000000001','Corrección transaccional QA',current_setting('qa.version')::integer);
select set_config('request.jwt.claim.sub','90000000-0000-0000-0000-000000000002',true);
do $$ begin
 if public.es_usuario_activo() or public.is_admin(auth.uid()) or public.can_access_module('mapas') then raise exception 'inactivo con rol/módulo conserva acceso'; end if;
 if (select count(*) from public.salidas) <> 0 or (select count(*) from public.cobertura_territorio) <> 0 then raise exception 'inactivo lee datos por tabla o vista'; end if;
end $$;
reset role;
do $$ begin
 if (select count(*) from public.reserva_movimientos)<>(select movimientos+3 from qa_counts) then raise exception 'movimientos duplicados o incompletos'; end if;
 if (select count(*) from public.territorio_personal_reservas)<>(select reservas+1 from qa_counts) then raise exception 'reservas duplicadas'; end if;
 if (select count(*) from public.cobertura_eventos)<>(select cobertura+2 from qa_counts) then raise exception 'cobertura duplicada o incompleta'; end if;
 if (select estado from public.cobertura_lado_actual where lado_id=current_setting('qa.lado')::uuid)<>'sin_dato' then raise exception 'corrección no es estado actual'; end if;
end $$;
rollback;
do $$ begin
 if exists(select 1 from public.cobertura_eventos where id in ('99000000-0000-0000-0000-000000000001','99000000-0000-0000-0000-000000000002')) then raise exception 'quedaron marcas de prueba'; end if;
end $$;
do $$ begin
 if exists(select 1 from auth.users where id in ('90000000-0000-0000-0000-000000000001','90000000-0000-0000-0000-000000000002','90000000-0000-0000-0000-000000000003')) then
   raise exception 'quedaron cuentas de prueba';
 end if;
end $$;
select 'PASS: RLS authenticated DEV; programa sin módulos; inactivo bloqueado; reservas y marcas idempotentes; versión incorrecta rechazada; devolución revoca marcas nuevas; corrección append-only; rollback sin cuentas ni marcas persistidas' as resultado;
