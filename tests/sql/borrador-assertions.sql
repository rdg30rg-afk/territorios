\set ON_ERROR_STOP on
set role authenticated;
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000000001',false);
insert into editor_estado(id,estado,actualizado_at) values('qa','{}','2000-01-01');
do $$ declare sello timestamptz; nuevo timestamptz; filas integer; begin
 select actualizado_at into sello from editor_estado where id='qa';
 update editor_estado set estado='{"revision":1}',actualizado_at=sello where id='qa' and actualizado_at=sello;
 select actualizado_at into nuevo from editor_estado where id='qa';
 if nuevo<=sello then raise exception 'el sello no avanzó'; end if;
 update editor_estado set estado='{"viejo":true}' where id='qa' and actualizado_at=sello;
 get diagnostics filas=row_count;
 if filas<>0 then raise exception 'pestaña vieja sobrescribió'; end if;
 begin
  insert into editor_estado(id,estado) values('qa','{"otra":true}');
  raise exception 'segundo creador sobrescribió';
 exception when unique_violation then null; end;
 if (select actualizado_por from editor_estado where id='qa')<>auth.uid() then raise exception 'autor incorrecto';end if;
end $$;
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000000002',false);
do $$ begin
 begin
  insert into editor_estado(id,estado) values('viewer','{}');
  raise exception 'viewer escribió borrador';
 exception when insufficient_privilege then null; end;
end $$;
reset role;
select 'PASS: sello servidor monotónico; comparación optimista; creación sin upsert; autor servidor; no viewer' as resultado;
