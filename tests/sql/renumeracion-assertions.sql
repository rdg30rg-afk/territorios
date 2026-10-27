reset role;
-- El fixture mínimo no trae la política de lectura territorial de la app.
create policy renumeracion_test_admin_read on public.territorios for select to authenticated using(public.is_admin(auth.uid()));
alter table public.territorios add column if not exists code_text text;
create unique index if not exists territorios_name_unique_idx on public.territorios(lower(name));
insert into public.territorios(id,name,code_text) values
 ('91000000-0000-0000-0000-000000000001','12','12'),
 ('91000000-0000-0000-0000-000000000002','5','5'),
 ('91000000-0000-0000-0000-000000000003','60','60');
insert into public.territorio_manzanas(id,territory_id,label,orden,geometry_version,geometry_geojson) values
 ('92000000-0000-0000-0000-000000000001','91000000-0000-0000-0000-000000000001','A',0,1,
  '{"type":"Polygon","coordinates":[[[-68.5,-31.5],[-68.4,-31.5],[-68.5,-31.4],[-68.5,-31.5]]]}');
insert into public.manzana_lados(id,manzana_id,territory_id,geometry_version,orden,geometry_geojson) values
 ('93000000-0000-0000-0000-000000000001','92000000-0000-0000-0000-000000000001',
  '91000000-0000-0000-0000-000000000001',1,0,
  '{"type":"LineString","coordinates":[[-68.5,-31.5],[-68.4,-31.5]]}');
insert into public.cobertura_eventos(id,lado_id,manzana_id,territory_id,estado,origen,informado_por) values
 ('94000000-0000-0000-0000-000000000001','93000000-0000-0000-0000-000000000001',
  '92000000-0000-0000-0000-000000000001','91000000-0000-0000-0000-000000000001',
  'completa','app','00000000-0000-0000-0000-000000000001');
insert into public.territorio_personal_reservas(territory_id,reserved_for,requested_by)
 values('91000000-0000-0000-0000-000000000001','Reserva QA','00000000-0000-0000-0000-000000000001');
set role authenticated;
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000000001',false);
do $$
declare cambios jsonb := '[
 {"id":"91000000-0000-0000-0000-000000000001","nombre_anterior":"12","nombre_nuevo":"5"},
 {"id":"91000000-0000-0000-0000-000000000002","nombre_anterior":"5","nombre_nuevo":"12"}]';
 lote jsonb := '[{"nombre":"5","version_esperada":1,"manzanas":[{"label":"A","orden":0,"lat":-31.5,"lng":-68.5,
 "geom":{"type":"Polygon","coordinates":[[[-68.5,-31.5],[-68.4,-31.5],[-68.5,-31.4],[-68.5,-31.5]]]},
 "lados":[{"orden":0,"geom":{"type":"LineString","coordinates":[[-68.5,-31.5],[-68.4,-31.5]]}}]}]},{"nombre":"12","version_esperada":0,"manzanas":[]}]';
begin
 -- El primer nombre no queda cambiado si falla la versión del segundo.
 begin
  perform public.publicar_editor_con_renumeracion(jsonb_set(lote,'{1,version_esperada}','99'),cambios);
  raise exception 'Se aceptó versión vieja';
 exception when serialization_failure then null;end;
 if not exists(select 1 from public.territorios where id='91000000-0000-0000-0000-000000000001' and name='12') then
  raise exception 'Fallo cambió nombre';end if;
 if exists(select 1 from public.territorio_manzanas where id='92000000-0000-0000-0000-000000000001' and vigente_hasta is not null) then
  raise exception 'Fallo retiró dibujo';end if;
 -- Un destino ocupado exige incluir a su dueño en el intercambio.
 begin
  perform public.publicar_editor_con_renumeracion('[{"nombre":"60","version_esperada":1,"manzanas":[]}]',
   '[{"id":"91000000-0000-0000-0000-000000000001","nombre_anterior":"12","nombre_nuevo":"60"}]');
  raise exception 'Pisó territorio ajeno';
 exception when unique_violation then null;end;
 perform public.publicar_editor_con_renumeracion(lote,cambios);
 if not exists(select 1 from public.territorios where id='91000000-0000-0000-0000-000000000001' and name='5' and code_text='5')
   or not exists(select 1 from public.territorios where id='91000000-0000-0000-0000-000000000002' and name='12')
   or not exists(select 1 from public.territorios where id='91000000-0000-0000-0000-000000000003' and name='60') then
  raise exception 'Intercambio incorrecto';end if;
 if not exists(select 1 from public.territorio_personal_reservas where territory_id='91000000-0000-0000-0000-000000000001' and reserved_for='Reserva QA') then
  raise exception 'Se perdió reserva';end if;
 if not exists(select 1 from public.territorio_manzanas where id='92000000-0000-0000-0000-000000000001' and territory_id='91000000-0000-0000-0000-000000000001' and vigente_hasta is null) then
  raise exception 'Se perdió dibujo vigente';end if;
 if not exists(select 1 from public.manzana_lados where id='93000000-0000-0000-0000-000000000001' and vigente_hasta is null)
   or not exists(select 1 from public.cobertura_eventos where id='94000000-0000-0000-0000-000000000001' and lado_id='93000000-0000-0000-0000-000000000001') then
  raise exception 'Se perdió cobertura vigente';end if;
 -- Color sin renumerar: mismo dibujo y cobertura, sin retirar lados.
 perform public.publicar_editor_con_renumeracion(jsonb_build_array(
   jsonb_set(jsonb_set(lote->0,'{version_esperada}','2'),'{color}','"#01bc73"')),'[]');
 if not exists(select 1 from public.territorios where id='91000000-0000-0000-0000-000000000001' and polygon_geojson->>'color'='#01bc73')
   or not exists(select 1 from public.manzana_lados where id='93000000-0000-0000-0000-000000000001' and vigente_hasta is null) then
  raise exception 'Color no persistió o retiró cobertura';end if;
 begin
  perform public.publicar_editor_con_renumeracion('[{"nombre":"5","version_esperada":3,"color":"red;invalid","manzanas":[]}]','[]');
  raise exception 'Aceptó color inválido';
 exception when invalid_parameter_value then null;end;
 begin
  perform public.publicar_editor_con_renumeracion(lote,cambios);
  raise exception 'Aceptó nombres originales obsoletos';
 exception when serialization_failure then null;end;
 -- También soporta un número libre.
 perform public.publicar_editor_con_renumeracion('[{"nombre":"70","version_esperada":3,"manzanas":[]}]',
  '[{"id":"91000000-0000-0000-0000-000000000001","nombre_anterior":"5","nombre_nuevo":"70"}]');
end $$;
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000000002',false);
do $$ begin
 begin
  perform public.publicar_editor_con_renumeracion('[]','[]');
  raise exception 'Viewer renumeró';
 exception when insufficient_privilege then null;end;
end $$;
reset role;
select 'PASS renumeración: intercambio, número libre, UUID e historial, rollback, conflicto y permisos' as resultado;
