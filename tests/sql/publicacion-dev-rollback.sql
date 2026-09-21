-- Ejecutar solo con verify-dev-publicacion.mjs: abre transacción externa.
insert into auth.users(id,email,raw_user_meta_data) values
 ('90000000-0000-0000-0000-000000000009','qa-publicacion@example.invalid','{"full_name":"QA publicación rollback"}');
update public.profiles set role='admin',access_status='active' where id='90000000-0000-0000-0000-000000000009';
insert into public.territorios(id,name,polygon_geojson) values
 ('81000000-0000-0000-0000-000000000091','QA-ATOMIC-A','{"type":"Polygon","coordinates":[[[-68.5,-31.5],[-68.4,-31.5],[-68.5,-31.4],[-68.5,-31.5]]]}'),
 ('81000000-0000-0000-0000-000000000092','QA-ATOMIC-B','{"type":"Polygon","coordinates":[[[-68.5,-31.5],[-68.4,-31.5],[-68.5,-31.4],[-68.5,-31.5]]]}');
insert into public.territorio_manzanas(id,territory_id,label,lat,lng) values
 ('82000000-0000-0000-0000-000000000091','81000000-0000-0000-0000-000000000091','A',-31.5,-68.5),
 ('82000000-0000-0000-0000-000000000092','81000000-0000-0000-0000-000000000092','A',-31.5,-68.5);
set local role authenticated;
select set_config('request.jwt.claim.sub','90000000-0000-0000-0000-000000000009',true);
do $$ declare r jsonb; begin
 if has_function_privilege('authenticated','public.cargar_manzanas_de_territorio(text,jsonb)','execute')
 or has_function_privilege('anon','public.publicar_territorios_atomico(jsonb)','execute') then raise exception 'permisos incorrectos';end if;
 r:=public.revisar_publicacion_editor(array['QA-ATOMIC-A','QA-ATOMIC-B']);
 if jsonb_array_length(r)<>2 then raise exception 'revisión incompleta';end if;
 begin
  perform public.publicar_territorios_atomico('[{"nombre":"QA-ATOMIC-A","version_esperada":1,"manzanas":[]},{"nombre":"QA-ATOMIC-B","version_esperada":1,"manzanas":[{"label":"A","lat":"inválido","lng":-68.5}]}]');
  raise exception 'se aceptó dato inválido';
 exception when invalid_text_representation then null;end;
 if exists(select 1 from territorio_manzanas where id in('82000000-0000-0000-0000-000000000091','82000000-0000-0000-0000-000000000092') and vigente_hasta is not null)
 or exists(select 1 from territorios where name in('QA-ATOMIC-A','QA-ATOMIC-B') and editor_revision<>0) then raise exception 'fallo dejó publicación parcial';end if;
 r:=public.publicar_territorios_atomico('[{"nombre":"QA-ATOMIC-A","version_esperada":1,"manzanas":[{"label":"A","orden":0,"lat":-31.5,"lng":-68.5,"area_m2":100,"geom":{"type":"Polygon","coordinates":[[[-68.5,-31.5],[-68.4,-31.5],[-68.5,-31.4],[-68.5,-31.5]]]},"lados":[{"orden":0,"geom":{"type":"LineString","coordinates":[[-68.5,-31.5],[-68.4,-31.5]]},"largo_m":100,"rumbo_grados":90,"medio_lat":-31.5,"medio_lng":-68.45}]}]},{"nombre":"QA-ATOMIC-B","version_esperada":1,"manzanas":[]}]');
 if jsonb_array_length(r)<>2 or (r->0->>'lados')::int<>1 or (r->1->>'manzanas')::int<>0 then raise exception 'conteos inesperados %',r;end if;
 if (select count(*) from territorio_manzanas where id in('82000000-0000-0000-0000-000000000091','82000000-0000-0000-0000-000000000092') and vigente_hasta is not null)<>2 then raise exception 'historia no conservada';end if;
 begin
  perform public.publicar_territorios_atomico('[{"nombre":"QA-ATOMIC-B","version_esperada":1,"manzanas":[]}]');
  raise exception 'vaciado aceptó versión vieja';
 exception when serialization_failure then null;end;
end $$;
reset role;
update public.profiles set role='viewer' where id='90000000-0000-0000-0000-000000000009';
set local role authenticated;
do $$ begin
 if to_regprocedure('public.agregar_manzana(uuid,text,numeric,numeric)') is not null then
  begin
   perform public.agregar_manzana('81000000-0000-0000-0000-000000000091','Z',-31.5,-68.5);raise exception 'viewer agregó manzana';
  exception when insufficient_privilege then null;end;
  begin
   perform public.retirar_manzana('82000000-0000-0000-0000-000000000091');raise exception 'viewer retiró manzana';
  exception when insufficient_privilege then null;end;
 end if;
 begin
  perform public.revisar_publicacion_editor(array['QA-ATOMIC-A']);raise exception 'viewer revisó';
 exception when insufficient_privilege then null;end;
 begin
  perform public.publicar_territorios_atomico('[{"nombre":"QA-ATOMIC-A","version_esperada":2,"manzanas":[]}]');raise exception 'viewer publicó';
 exception when insufficient_privilege then null;end;
end $$;
reset role;
rollback;
do $$ begin
 if exists(select 1 from auth.users where id='90000000-0000-0000-0000-000000000009')
 or exists(select 1 from territorios where id in('81000000-0000-0000-0000-000000000091','81000000-0000-0000-0000-000000000092'))
 or exists(select 1 from territorio_manzanas where territory_id in('81000000-0000-0000-0000-000000000091','81000000-0000-0000-0000-000000000092'))
 or exists(select 1 from manzana_lados where territory_id in('81000000-0000-0000-0000-000000000091','81000000-0000-0000-0000-000000000092')) then raise exception 'persistieron datos QA';end if;
end $$;
select 'PASS DEV: lote real con lados; rollback parcial; retiro conserva IDs; vaciado versionado; viewer rechazado; permisos; sin datos QA persistidos' as resultado;
