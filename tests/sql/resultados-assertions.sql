\set ON_ERROR_STOP on

-- Dos escrituras en una transacción comparten now(). El orden de UUID no
-- debe hacer que la vista vuelva a mostrar el hecho anterior.
reset role;
insert into public.salidas(id) values ('30000000-0000-0000-0000-000000000004');
set role authenticated;
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000000001',false);
do $$ begin
 perform public.informar_resultado_salida('61000000-0000-0000-0000-000000000001','30000000-0000-0000-0000-000000000004','sin_dato');
 perform public.informar_resultado_salida('61000000-0000-0000-0000-000000000002','30000000-0000-0000-0000-000000000004','realizada',null,'Corrección dentro de la misma transacción',null,'61000000-0000-0000-0000-000000000001');
 if (select resultado_id from public.salida_resultado_actual where salida_id='30000000-0000-0000-0000-000000000004') <> '61000000-0000-0000-0000-000000000002' then
  raise exception 'el resultado corregido perdió orden dentro de la transacción';
 end if;
end $$;

-- Salidas adicionales sólo para este bloque de pruebas. La primera ya viene
-- del fixture y tiene conductor exacto 700...001.
reset role;
insert into public.salidas(id,driver_id) values
 ('30000000-0000-0000-0000-000000000002','70000000-0000-0000-0000-000000000002'),
 ('30000000-0000-0000-0000-000000000003',null);

set role authenticated;
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000000005',false);

do $$
declare r uuid;
begin
 r:=public.informar_resultado_salida(
   '60000000-0000-0000-0000-000000000001',
   '30000000-0000-0000-0000-000000000001',
   'sin_dato',null,null,'2026-09-05T10:00:00Z',null
 );
 if r<>'60000000-0000-0000-0000-000000000001' then
   raise exception 'RPC no devolvió el UUID de intento';
 end if;
 r:=public.informar_resultado_salida(
   '60000000-0000-0000-0000-000000000001',
   '30000000-0000-0000-0000-000000000001',
   'sin_dato',null,null,'2026-09-05T10:00:00Z',null
 );
 if r<>'60000000-0000-0000-0000-000000000001' then
   raise exception 'reintento idempotente devolvió otro UUID';
 end if;
end $$;

do $$
begin
 begin
  perform public.informar_resultado_salida(
    '60000000-0000-0000-0000-000000000001',
    '30000000-0000-0000-0000-000000000001',
    'no_realizada',null,null,'2026-09-05T10:00:00Z',null
  );
  raise exception 'el mismo UUID aceptó otro payload';
 exception when unique_violation then null;
 end;
 if (select count(*) from public.salida_resultados
     where id='60000000-0000-0000-0000-000000000001')<>1 then
   raise exception 'el reintento duplicó el resultado';
 end if;
 if (select estado from public.salida_resultado_actual
     where salida_id='30000000-0000-0000-0000-000000000001')<>'sin_dato' then
   raise exception 'sin_dato fue interpretado como no_realizada';
 end if;
end $$;

-- La identidad operativa se resuelve sólo por driver_id, nunca por nombre.
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000000006',false);
do $$
begin
 begin
  perform public.informar_resultado_salida(
    '60000000-0000-0000-0000-000000000002',
    '30000000-0000-0000-0000-000000000001',
    'realizada',null,null,null,null
  );
  raise exception 'conductor con driver_id distinto informó la salida';
 exception when insufficient_privilege then null;
 end;
end $$;

select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000000007',false);
do $$
begin
 begin
  perform public.informar_resultado_salida(
    '60000000-0000-0000-0000-000000000003',
    '30000000-0000-0000-0000-000000000001',
    'realizada',null,null,null,null
  );
  raise exception 'conductor inactivo informó la salida';
 exception when insufficient_privilege then null;
 end;
end $$;

-- El admin activo puede informar una salida sin driver y una salida de otro
-- conductor, pero una corrección siempre debe declarar el evento anterior.
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000000001',false);
do $$
declare r uuid;
begin
 r:=public.informar_resultado_salida(
   '60000000-0000-0000-0000-000000000004',
   '30000000-0000-0000-0000-000000000002',
   'realizada','otro','Salida completa','2026-09-05T11:00:00Z',null
 );
 if r<>'60000000-0000-0000-0000-000000000004' then
   raise exception 'admin no pudo informar resultado';
 end if;
 r:=public.informar_resultado_salida(
   '60000000-0000-0000-0000-000000000005',
   '30000000-0000-0000-0000-000000000003',
   'sin_dato',null,null,null,null
 );
 if r<>'60000000-0000-0000-0000-000000000005' then
   raise exception 'admin no pudo guardar sin_dato';
 end if;
end $$;

select pg_sleep(0.01);
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000000005',false);
do $$
begin
 begin
  perform public.informar_resultado_salida(
    '60000000-0000-0000-0000-000000000006',
    '30000000-0000-0000-0000-000000000002',
    'parcial',null,'Conductor no puede corregir',null,
    '60000000-0000-0000-0000-000000000004'
  );
  raise exception 'conductor corrigió un resultado existente';
 exception when insufficient_privilege then null;
 end;
end $$;

-- La corrección es otro evento, con explicación y vínculo al evento actual.
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000000001',false);
do $$
begin
 begin
  perform public.informar_resultado_salida(
    '60000000-0000-0000-0000-000000000006',
    '30000000-0000-0000-0000-000000000002',
    'parcial','otro',null,null,
    '60000000-0000-0000-0000-000000000004'
  );
  raise exception 'corrección sin motivo en observaciones aceptada';
 exception when invalid_parameter_value then null;
 end;
 perform public.informar_resultado_salida(
   '60000000-0000-0000-0000-000000000006',
   '30000000-0000-0000-0000-000000000002',
   'parcial','otro','Corrección: quedó una parte pendiente',
   '2026-09-05T11:30:00Z','60000000-0000-0000-0000-000000000004'
 );
end $$;

do $$
begin
 if (select count(*) from public.salida_resultados
     where salida_id='30000000-0000-0000-0000-000000000002')<>2 then
   raise exception 'la corrección no fue append-only o se duplicó';
 end if;
 if (select estado from public.salida_resultados
     where id='60000000-0000-0000-0000-000000000004')<>'realizada' then
   raise exception 'el evento original fue modificado';
 end if;
 if (select resultado_id from public.salida_resultado_actual
     where salida_id='30000000-0000-0000-0000-000000000002')<>
     '60000000-0000-0000-0000-000000000006' then
   raise exception 'la vista actual no eligió la corrección';
 end if;
 if (select estado from public.salida_resultado_actual
     where salida_id='30000000-0000-0000-0000-000000000002')<>'parcial' then
   raise exception 'la vista actual no muestra el estado corregido';
 end if;
end $$;

do $$
begin
 begin
  perform public.informar_resultado_salida(
    '60000000-0000-0000-0000-000000000007',
    '30000000-0000-0000-0000-000000000002',
    'realizada',null,'Corrección con puntero viejo',null,
    '60000000-0000-0000-0000-000000000004'
  );
  raise exception 'se aceptó corregir una versión vieja';
 exception when invalid_parameter_value then null;
 end;
 begin
  perform public.informar_resultado_salida(
    '60000000-0000-0000-0000-000000000008',
    '30000000-0000-0000-0000-000000000003',
    'sin_dato',null,'No hay evento para corregir',null,
    '60000000-0000-0000-0000-000000000004'
  );
  raise exception 'se aceptó corrección sin resultado actual';
 exception when invalid_parameter_value then null;
 end;
 begin
  perform public.informar_resultado_salida(
    '60000000-0000-0000-0000-000000000009',
    '30000000-0000-0000-0000-000000000003',
    'sin_dato','nombre_inventado',null,null,null
  );
  raise exception 'se aceptó un motivo inventado';
 exception when invalid_parameter_value then null;
 end;
end $$;

reset role;
do $$
begin
 if has_table_privilege('authenticated','public.salida_resultados','INSERT')
    or has_table_privilege('authenticated','public.salida_resultados','UPDATE')
    or has_table_privilege('authenticated','public.salida_resultados','DELETE') then
   raise exception 'quedó un privilegio directo de escritura';
 end if;
 if not has_function_privilege(
   'authenticated',
   'public.informar_resultado_salida(uuid,uuid,text,text,text,timestamptz,uuid)',
   'EXECUTE'
 ) then
   raise exception 'authenticated no tiene acceso a la RPC';
 end if;
end $$;

set role authenticated;
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000000005',false);
do $$
begin
 begin
  insert into public.salida_resultados(id,salida_id,estado,informado_por)
  values('60000000-0000-0000-0000-000000000010',
         '30000000-0000-0000-0000-000000000001','realizada',auth.uid());
  raise exception 'insert directo de resultado permitido';
 exception when insufficient_privilege then null;
 end;
 begin
  update public.salida_resultados set estado='no_realizada';
  raise exception 'update directo de resultado permitido';
 exception when insufficient_privilege then null;
 end;
 begin
  delete from public.salida_resultados;
  raise exception 'delete directo de resultado permitido';
 exception when insufficient_privilege then null;
 end;
end $$;

reset role;
do $$
begin
 begin
  delete from public.salidas where id='30000000-0000-0000-0000-000000000004';
  raise exception 'borrar salida pudo borrar su historial en cascada';
 exception when foreign_key_violation then null;
 end;
 -- 1 cierre de conductor + 2 cierres admin + 1 corrección admin
 -- + 2 hechos de la prueba de orden en una sola transacción = 6.
 if (select count(*) from public.salida_resultados)<>6 then
   raise exception 'cantidad final inesperada: %', (select count(*) from public.salida_resultados);
 end if;
 if (select estado from public.salida_resultado_actual
     where salida_id='30000000-0000-0000-0000-000000000003')<>'sin_dato' then
   raise exception 'la salida sin dato terminó como no_realizada';
 end if;
end $$;

select 'PASS: resultados por RPC idempotentes; identidad exacta por driver_id; sin_dato explícito; corrección admin append-only; direct writes revocados' as resultado;
