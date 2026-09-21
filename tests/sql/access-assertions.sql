\set ON_ERROR_STOP on
set role authenticated;
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000000002',false);
do $$ begin
 if not public.es_usuario_activo() then raise exception 'viewer activo bloqueado'; end if;
 if public.can_access_module('mapas') then raise exception 'viewer obtuvo modulo'; end if;
 if (select count(*) from salidas) <> 1 then raise exception 'viewer no ve programa'; end if;
 begin
   perform public.administrar_acceso('00000000-0000-0000-0000-000000000002','admin','active','{}',null);
   raise exception 'viewer elevó privilegios';
 exception when insufficient_privilege then null; end;
 begin
   update profiles set role='admin' where id=auth.uid();
   raise exception 'mutación directa de perfil permitida';
 exception when insufficient_privilege then null; end;
end $$;
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000000004',false);
do $$ begin
 if public.es_usuario_activo() or public.is_admin(auth.uid()) or public.can_access_module('mapas') then raise exception 'inactivo autorizado'; end if;
 if (select count(*) from salidas) <> 0 then raise exception 'inactivo leyó datos'; end if;
 begin
   insert into salidas(id) values('30000000-0000-0000-0000-000000000002'); raise exception 'inactivo escribió datos';
 exception when insufficient_privilege then null; end;
end $$;
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000000003',false);
do $$ begin
 if public.es_usuario_activo() or (select count(*) from salidas) <> 0 then raise exception 'pendiente autorizado'; end if;
end $$;
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000000001',false);
do $$ begin
 begin
   perform public.administrar_acceso(auth.uid(),'viewer','inactive','{}',null);
   raise exception 'último admin desactivado';
 exception when check_violation then null; end;
 begin
   perform public.administrar_acceso('00000000-0000-0000-0000-000000000003','viewer','active',array['inventado'],null);
   raise exception 'módulo inventado aceptado';
 exception when invalid_parameter_value then null; end;
 perform public.administrar_acceso('00000000-0000-0000-0000-000000000003','viewer','active','{}',null);
end $$;
reset role;
do $$ begin
 if (select access_status from profiles where id='00000000-0000-0000-0000-000000000003') <> 'active' then raise exception 'no aprobó sin módulos'; end if;
 if exists(select 1 from user_module_access where user_id='00000000-0000-0000-0000-000000000003') then raise exception 'asignó módulos implícitos'; end if;
 if has_table_privilege('authenticated','profiles','UPDATE') or has_table_privilege('authenticated','user_module_access','INSERT') then raise exception 'privilegio directo residual'; end if;
end $$;
select 'PASS: viewer activo, pendiente, inactivo, API sin escalación, último admin, módulos válidos y aprobación sin módulos' as resultado;
