-- Ya conectado como admin autenticado, datos QA dentro de rollback exterior.
do $$ declare mz public.territorio_manzanas; r jsonb; begin
 if has_table_privilege('authenticated','public.territorio_manzanas','INSERT')
 or has_table_privilege('authenticated','public.territorio_manzanas','UPDATE')
 or has_table_privilege('authenticated','public.territorio_manzanas','DELETE') then raise exception 'escritura directa todavía permitida';end if;
 mz:=public.agregar_manzana('81000000-0000-0000-0000-000000000091','B',-31.5,-68.5);
 if mz.geometry_version<>3 then raise exception 'alta no avanzó revisión';end if;
 begin
  perform public.publicar_territorios_atomico('[{"nombre":"QA-ATOMIC-A","version_esperada":2,"manzanas":[]}]');
  raise exception 'editor pisó alta posterior';
 exception when serialization_failure then null;end;
 begin
  perform public.agregar_manzana(mz.territory_id,'B',-31.5,-68.5);
  raise exception 'alta duplicada aceptada';
 exception when unique_violation then null;end;
 r:=public.retirar_manzana(mz.id);
 if (r->>'version')::int<>4 then raise exception 'retiro no avanzó revisión';end if;
 r:=public.retirar_manzana(mz.id);
 if not (r->>'ya_retirada')::boolean then raise exception 'reintento retiro no idempotente';end if;
 if not exists(select 1 from territorio_manzanas where id=mz.id and vigente_hasta is not null) then raise exception 'retiro perdió fila histórica';end if;
 begin
  perform public.publicar_territorios_atomico('[{"nombre":"QA-ATOMIC-A","version_esperada":3,"manzanas":[]}]');
  raise exception 'editor pisó retiro posterior';
 exception when serialization_failure then null;end;
end $$;
select 'PASS: altas y retiros invalidan revisión del editor; retiro repetido idempotente; etiquetas duplicadas rechazadas; no escritura directa' as coordinacion;
