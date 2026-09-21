set role authenticated;
do $$ begin
 if has_table_privilege(current_user,'public.territorios','DELETE') then raise exception 'borrado directo habilitado';end if;
 begin
  delete from public.territorios where false;
  raise exception 'DELETE no fue denegado';
 exception when insufficient_privilege then null;end;
end $$;
reset role;
select 'PASS: DELETE de territorio denegado incluso sin filas objetivo' as resultado;
