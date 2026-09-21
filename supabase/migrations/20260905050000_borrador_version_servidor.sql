begin;
-- La versión del borrador y su autor son datos del servidor. El PATCH del
-- editor compara el sello leído; un reloj local atrasado no puede repetirlo.
create or replace function public.sellar_borrador_editor()
returns trigger language plpgsql security definer set search_path=public as $$
begin
 if not public.is_admin(auth.uid()) then
  raise exception 'Solo un administrador activo puede guardar el borrador' using errcode='42501';
 end if;
 new.actualizado_por := auth.uid();
 if tg_op='UPDATE' then
  new.actualizado_at := greatest(clock_timestamp(),old.actualizado_at+interval '1 microsecond');
 else
  new.actualizado_at := clock_timestamp();
 end if;
 return new;
end $$;
revoke all on function public.sellar_borrador_editor() from public,anon,authenticated;
drop trigger if exists editor_sello_servidor on public.editor_estado;
create trigger editor_sello_servidor before insert or update on public.editor_estado
for each row execute function public.sellar_borrador_editor();
notify pgrst,'reload schema';
commit;
