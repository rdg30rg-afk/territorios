set role authenticated;
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000000001',false);
do $$ declare r jsonb; begin
 r:=public.revisar_publicacion_editor(array['QA-A','QA-B']);
 if jsonb_array_length(r)<>2 then raise exception 'revisión incompleta';end if;
 begin
  perform public.publicar_territorios_atomico('[{"nombre":"QA-A","version_esperada":1,"manzanas":[]},{"nombre":"QA-B","version_esperada":1,"manzanas":[{"lat":"valor inválido"}]}]');
  raise exception 'debería fallar segundo publicador';
 exception when invalid_text_representation then null;
 end;
 if exists(select 1 from territorio_manzanas where territory_id in('81000000-0000-0000-0000-000000000001','81000000-0000-0000-0000-000000000002') and geometry_version<>1) then raise exception 'se publicó media mudanza';end if;
 if exists(select 1 from territorio_manzanas where territory_id='81000000-0000-0000-0000-000000000001' and vigente_hasta is not null) then raise exception 'fallo dejó retiro parcial';end if;
 perform public.publicar_territorios_atomico('[{"nombre":"QA-A","version_esperada":1,"manzanas":[{"label":"A","lat":-31.5,"lng":-68.5,"geom":{"type":"Polygon","coordinates":[[[-68.5,-31.5],[-68.4,-31.5],[-68.5,-31.4],[-68.5,-31.5]]]},"lados":[]}]},{"nombre":"QA-B","version_esperada":1,"manzanas":[]}]');
 if not exists(select 1 from territorio_manzanas where id='82000000-0000-0000-0000-000000000001' and vigente_hasta is not null) then raise exception 'se borró dibujo sin cobertura';end if;
 begin
  perform public.publicar_territorios_atomico('[{"nombre":"QA-A","version_esperada":1,"manzanas":[]}]');
  raise exception 'se aceptó versión vieja';
 exception when serialization_failure then null;end;
 begin
  perform public.publicar_territorios_atomico('[{"nombre":"QA-B","version_esperada":1,"manzanas":[]}]');
  raise exception 'territorio vaciado no avanzó versión';
 exception when serialization_failure then null;end;
end $$;
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000000002',false);
do $$ begin
 begin
  perform public.publicar_territorios_atomico('[{"nombre":"QA-A","version_esperada":2,"manzanas":[]}]');
  raise exception 'viewer publicó';
 exception when insufficient_privilege then null;end;
end $$;
reset role;
select 'PASS publicador real: rollback al fallar segundo, éxito conjunto, retiro sin borrar historia, versión vieja rechazada, no viewer' as resultado;
