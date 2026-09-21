\set ON_ERROR_STOP on
insert into territorio_manzanas values('40000000-0000-0000-0000-000000000001','10000000-0000-0000-0000-000000000001',1,null);
insert into manzana_lados values('50000000-0000-0000-0000-000000000001','40000000-0000-0000-0000-000000000001','10000000-0000-0000-0000-000000000001',1,null);
set role authenticated;
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000000001',false);
select public.asignar_territorio('10000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-000000000002');
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000000002',false);
do $$ declare e uuid:='60000000-0000-0000-0000-000000000001'; l uuid:='50000000-0000-0000-0000-000000000001';begin
 perform public.informar_cobertura(e,l,'recorrido',p_geometry_version=>1);
 perform public.informar_cobertura(e,l,'recorrido',p_geometry_version=>1);
 begin
  perform public.informar_cobertura(e,l,'sin_dato',p_geometry_version=>1);raise exception 'ID reciclado con otro estado';
 exception when unique_violation then null;end;
 begin
  perform public.informar_cobertura(gen_random_uuid(),l,'recorrido',p_geometry_version=>2);raise exception 'versión equivocada aceptada';
 exception when serialization_failure then null;end;
 begin
  insert into cobertura_eventos(id) values(gen_random_uuid());raise exception 'API directa permite falsificar marca';
 exception when insufficient_privilege then null;end;
end $$;
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000000003',false);
do $$ begin
 begin
  perform public.informar_cobertura(gen_random_uuid(),'50000000-0000-0000-0000-000000000001','recorrido',p_geometry_version=>1);raise exception 'no dueño informó';
 exception when insufficient_privilege then null;end;
 begin
  perform public.informar_cobertura(gen_random_uuid(),'50000000-0000-0000-0000-000000000001','recorrido','cierre_salida','30000000-0000-0000-0000-000000000001',p_geometry_version=>1);raise exception 'conductor no vinculado informó';
 exception when insufficient_privilege then null;end;
end $$;
reset role;
update manzana_lados set vigente_hasta=now();
set role authenticated;
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000000002',false);
do $$ begin
 begin
  perform public.informar_cobertura(gen_random_uuid(),'50000000-0000-0000-0000-000000000001','recorrido',p_geometry_version=>1);raise exception 'cuadra retirada recibió nueva marca';
 exception when serialization_failure then null;end;
end $$;
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000000001',false);
select public.informar_cobertura('60000000-0000-0000-0000-000000000002','50000000-0000-0000-0000-000000000001','sin_dato','correccion',null,'60000000-0000-0000-0000-000000000001','Se informó por error',1);
do $$ begin
 begin update cobertura_eventos set estado='sin_dato';raise exception 'admin puede actualizar bitácora';exception when insufficient_privilege then null;end;
 begin delete from cobertura_eventos;raise exception 'admin puede borrar bitácora';exception when insufficient_privilege then null;end;
end $$;
reset role;
do $$ begin
 if (select count(*) from cobertura_eventos)<>2 then raise exception 'reintento duplicó evento o corrección borró historia';end if;
 if (select estado from cobertura_eventos where id='60000000-0000-0000-0000-000000000001')<>'recorrido' then raise exception 'evento original cambiado';end if;
end $$;
select 'PASS: marcas idempotentes; identidad y versión comprobadas; propiedad; rechazo de insert directo; corrección histórica append-only' as resultado;
