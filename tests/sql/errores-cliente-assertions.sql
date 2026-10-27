\set ON_ERROR_STOP on
reset role;

-- 1. Forma de la tabla: ninguna columna puede guardar email, nombre ni coordenadas.
do $$ declare columnas text; f regprocedure:='public.reportar_error_cliente(text,text,text,text,text)'::regprocedure; begin
 select string_agg(column_name,',' order by ordinal_position) into columnas
 from information_schema.columns where table_schema='public' and table_name='errores_cliente';
 if columnas is distinct from 'id,creado_at,reportado_por,version_app,ruta,rol,mensaje,pila,user_agent' then
  raise exception 'Columnas inesperadas en errores_cliente: %',columnas;end if;
 if not (select relrowsecurity from pg_class where oid='public.errores_cliente'::regclass) then
  raise exception 'errores_cliente sin RLS';end if;
 if has_table_privilege('anon','public.errores_cliente','select')
   or has_table_privilege('authenticated','public.errores_cliente','insert')
   or has_table_privilege('authenticated','public.errores_cliente','update')
   or has_table_privilege('authenticated','public.errores_cliente','delete')
   or not has_table_privilege('authenticated','public.errores_cliente','select') then
  raise exception 'Privilegios de tabla incorrectos';end if;
 if (select count(*) from pg_proc where proname='reportar_error_cliente')<>1
   or not (select prosecdef from pg_proc where oid=f)
   or not (select coalesce(proconfig,'{}') @> array['search_path=public, pg_temp'] from pg_proc where oid=f) then
  raise exception 'reportar_error_cliente: firma única, security definer y search_path';end if;
 if has_function_privilege('anon',f,'execute') or not has_function_privilege('authenticated',f,'execute') then
  raise exception 'Grants de reportar_error_cliente incorrectos';end if;
 if has_function_privilege('authenticated','public.errores_cliente_limpiar(text)','execute') then
  raise exception 'errores_cliente_limpiar no debe ser invocable desde el navegador';end if;
end $$;

-- 2. Limpieza de datos personales (espejo de limpiarTexto en el cliente).
do $$ begin
 if public.errores_cliente_limpiar('Falló para ana.perez@example.com en -31.537512,-68.536412')
    is distinct from 'Falló para [email] en [coord],[coord]' then
  raise exception 'Email o coordenadas sin limpiar: %',public.errores_cliente_limpiar('Falló para ana.perez@example.com en -31.537512,-68.536412');end if;
 if public.errores_cliente_limpiar('Bearer eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.abc123_-XYZ fin')
    is distinct from 'Bearer [token] fin' then raise exception 'JWT sin limpiar';end if;
 if public.errores_cliente_limpiar('GET https://x.supabase.co/rest/v1/territorios?select=*&apikey=abc#frag falló')
    is distinct from 'GET https://x.supabase.co/rest/v1/territorios falló' then raise exception 'Query de URL sin limpiar';end if;
 if public.errores_cliente_limpiar('clave 0123456789abcdef0123456789abcdef0123456789abcdef')
    is distinct from 'clave [token]' then raise exception 'Cadena opaca sin limpiar';end if;
 -- Lo que NO es un dato personal tiene que quedar igual: UUID, versiones, IP,
 -- líneas de pila, enteros y decimales cortos.
 if public.errores_cliente_limpiar('t=81000000-0000-0000-0000-000000000091 v1.2.3 192.168.1.10 main-AbC123.js:12:3456 n=12345 pi=3.14 fn@https://h.test/a.js:1:2')
    is distinct from 't=81000000-0000-0000-0000-000000000091 v1.2.3 192.168.1.10 main-AbC123.js:12:3456 n=12345 pi=3.14 fn@https://h.test/a.js:1:2' then
  raise exception 'Se limpió de más: %',public.errores_cliente_limpiar('t=81000000-0000-0000-0000-000000000091 v1.2.3 192.168.1.10 main-AbC123.js:12:3456 n=12345 pi=3.14 fn@https://h.test/a.js:1:2');end if;
end $$;

-- 3. Un publicador activo reporta: se guarda truncado y sin datos personales.
set role authenticated;
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000000002',false);
do $$ begin
 if not public.reportar_error_cliente(
   repeat('fallo ',150)||'para ana@example.com en -31.537512',
   repeat('at x ',1000),
   '/mapas?code=secreto#sec',
   'v1.2.3',
   repeat('Mozilla ',150)) then
  raise exception 'No guardó el primer reporte';end if;
 if (select count(*) from public.errores_cliente)<>0 then
  raise exception 'Un publicador leyó errores_cliente';end if;
 begin
  insert into public.errores_cliente(mensaje) values('directo');
  raise exception 'Escritura directa aceptada';
 exception when insufficient_privilege then null;end;
end $$;
reset role;
do $$ declare r public.errores_cliente; begin
 select * into r from public.errores_cliente;
 if r.reportado_por<>'00000000-0000-0000-0000-000000000002' then raise exception 'reportado_por incorrecto';end if;
 if r.rol is distinct from 'viewer' then raise exception 'rol incorrecto: %',r.rol;end if;
 if char_length(r.mensaje)<>500 or char_length(r.pila)<>2000 or char_length(r.user_agent)<>300 then
  raise exception 'Truncado incorrecto: % % %',char_length(r.mensaje),char_length(r.pila),char_length(r.user_agent);end if;
 if r.ruta<>'/mapas' then raise exception 'La ruta conservó query o hash: %',r.ruta;end if;
 if r.version_app<>'v1.2.3' then raise exception 'version_app incorrecta';end if;
 -- Con el mensaje cortado a 500, el email y la coordenada ya no entran; se prueba
 -- aparte, con un mensaje corto, que el guardado los limpia.
 if r.creado_at is null then raise exception 'sin fecha';end if;
end $$;

-- 4. Un mensaje corto con datos personales se guarda limpio.
set role authenticated;
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000000002',false);
do $$ begin
 perform public.reportar_error_cliente('No se pudo avisar a ana@example.com en -31.537512, -68.536412',
  'at f (https://h.test/a.js?v=1:3:4)','/salidas','v1.2.3','Mozilla/5.0 (Linux; Android 12) Chrome/118.0.0.0 Mobile Safari/537.36');
end $$;
reset role;
do $$ declare r public.errores_cliente; begin
 select * into r from public.errores_cliente where ruta='/salidas';
 if r.mensaje<>'No se pudo avisar a [email] en [coord], [coord]' then raise exception 'Mensaje sin limpiar: %',r.mensaje;end if;
 if r.pila<>'at f (https://h.test/a.js)' then raise exception 'Pila sin limpiar: %',r.pila;end if;
 if r.user_agent not like 'Mozilla/5.0 (Linux; Android 12) Chrome/118.0.0.0%' then raise exception 'user agent alterado: %',r.user_agent;end if;
end $$;

-- 5. Tope por usuario y por hora: 30. El 31 se descarta sin error, y el tope de
--    uno no afecta a otro. Pasada la hora, vuelve a aceptar.
set role authenticated;
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000000002',false);
do $$ declare i integer; begin
 for i in 3..30 loop
  if not public.reportar_error_cliente('error '||i) then raise exception 'Descartó el reporte % antes del tope',i;end if;
 end loop;
 if public.reportar_error_cliente('error 31') then raise exception 'Aceptó más del tope por hora';end if;
 if public.reportar_error_cliente('error 32') then raise exception 'Aceptó más del tope por hora (2)';end if;
end $$;
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000000001',false);
do $$ begin
 if not public.reportar_error_cliente(null,null,null,null,null) then
  raise exception 'El tope de un usuario bloqueó a otro';end if;
 -- Un admin sí lee todo.
 if (select count(*) from public.errores_cliente)<>31 then
  raise exception 'El admin debía ver 31 reportes y vio %',(select count(*) from public.errores_cliente);end if;
 if not exists(select 1 from public.errores_cliente where mensaje='(sin mensaje)' and ruta='/' and version_app='sin-version' and pila is null and user_agent is null) then
  raise exception 'Valores por defecto incorrectos para un reporte vacío';end if;
end $$;
reset role;
update public.errores_cliente set creado_at=creado_at-interval '2 hours'
 where reportado_por='00000000-0000-0000-0000-000000000002';
set role authenticated;
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000000002',false);
do $$ begin
 if not public.reportar_error_cliente('después de la hora') then
  raise exception 'No volvió a aceptar pasada la hora';end if;
end $$;

-- 6. Cuentas sin acceso activo, sin sesión y anónimo: nada se guarda.
--    Perfiles propios: otras aserciones del encadenado aprueban al "pendiente"
--    del fixture, y este caso no puede depender de ese estado.
reset role;
insert into public.profiles(id,full_name,role,access_status,driver_id) values
 ('00000000-0000-0000-0000-0000000000e1','Pendiente errores','viewer','pending',null),
 ('00000000-0000-0000-0000-0000000000e2','Inactivo errores','viewer','inactive',null);
set role authenticated;
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-0000000000e1',false);
do $$ begin
 if public.reportar_error_cliente('pendiente') then raise exception 'Una cuenta pendiente guardó un reporte';end if;
end $$;
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-0000000000e2',false);
do $$ begin
 if public.reportar_error_cliente('inactivo') then raise exception 'Una cuenta inactiva guardó un reporte';end if;
end $$;
select set_config('request.jwt.claim.sub','',false);
do $$ begin
 begin
  perform public.reportar_error_cliente('sin sesión');
  raise exception 'Se aceptó un reporte sin sesión';
 exception when insufficient_privilege then null;end;
end $$;
reset role;
set role anon;
do $$ begin
 begin
  perform public.reportar_error_cliente('anónimo');
  raise exception 'anon pudo ejecutar reportar_error_cliente';
 exception when insufficient_privilege then null;end;
end $$;
reset role;
do $$ begin
 if exists(select 1 from public.errores_cliente where mensaje in('pendiente','inactivo','sin sesión','anónimo')) then
  raise exception 'Se guardó un reporte que debía descartarse';end if;
end $$;
select 'PASS errores_cliente: sin columnas personales, limpieza, RLS solo admin, escritura solo por RPC, truncado, tope por usuario y hora, cuentas sin acceso y anon' as resultado;
