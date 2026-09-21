\set ON_ERROR_STOP on
begin;
insert into auth.users(id,email,raw_user_meta_data)
values('90000000-0000-0000-0000-000000000008','qa-editor-rollback@example.invalid','{"full_name":"QA editor transaccional"}');
update public.profiles set role='admin',access_status='active' where id='90000000-0000-0000-0000-000000000008';
set local role authenticated;
select set_config('request.jwt.claim.sub','90000000-0000-0000-0000-000000000008',true);
insert into public.editor_estado(id,estado,actualizado_at)
values('qa-editor-rollback-20260905','{"qa":1}','2000-01-01');
do $$ declare sello timestamptz; filas integer; begin
 select actualizado_at into sello from public.editor_estado where id='qa-editor-rollback-20260905';
 update public.editor_estado set estado='{"qa":2}',actualizado_at=sello where id='qa-editor-rollback-20260905' and actualizado_at=sello;
 if (select actualizado_at from public.editor_estado where id='qa-editor-rollback-20260905')<=sello then raise exception 'sello no avanzó';end if;
 update public.editor_estado set estado='{"qa":"viejo"}' where id='qa-editor-rollback-20260905' and actualizado_at=sello;
 get diagnostics filas=row_count;
 if filas<>0 then raise exception 'pestaña vieja pisó borrador';end if;
 if (select actualizado_por from public.editor_estado where id='qa-editor-rollback-20260905')<>auth.uid() then raise exception 'autor no asignado por servidor';end if;
 begin
  insert into public.editor_estado(id,estado) values('qa-editor-rollback-20260905','{}');
  raise exception 'se permitió segunda creación';
 exception when unique_violation then null;end;
end $$;
reset role;
update public.profiles set role='viewer' where id='90000000-0000-0000-0000-000000000008';
set local role authenticated;
do $$ begin
 if exists(select 1 from public.editor_estado) then raise exception 'viewer lee borradores';end if;
 begin
  insert into public.editor_estado(id,estado) values('qa-editor-viewer-20260905','{}');
  raise exception 'viewer escribe borrador';
 exception when insufficient_privilege then null;end;
end $$;
reset role;
rollback;
do $$ begin
 if exists(select 1 from auth.users where id='90000000-0000-0000-0000-000000000008')
 or exists(select 1 from public.editor_estado where id in ('qa-editor-rollback-20260905','qa-editor-viewer-20260905')) then raise exception 'quedaron datos QA';end if;
end $$;
select 'PASS: sello y autor servidor; pestaña vieja rechazada; sin upsert; viewer no lee/escribe; rollback sin datos QA' as resultado;
