-- Fixture QA existente solamente. Siempre ROLLBACK; no cambia cuentas reales.
begin;
set local statement_timeout = '15s';
set local lock_timeout = '3s';
do $$ begin
  if not exists(select 1 from public.profiles where id='5aeec4a5-8784-4ec4-84d7-df874df7c51c'
    and role='conductor' and access_status='active' and driver_id='907b45ca-193b-4de4-b90d-7895355911aa')
    then raise exception 'Fixture QA inesperado'; end if;
end $$;
select set_config('request.jwt.claim.sub','5aeec4a5-8784-4ec4-84d7-df874df7c51c',true);
set local role authenticated;
do $$ begin
  if (select count(*) from public.salida_resultado_actual where salida_id='fc95f165-180e-4e21-9110-fcaf4d196f9d')<>1
    then raise exception 'Conductor exacto no lee resultado'; end if;
end $$;
reset role;
-- Simular desvinculación solo dentro de esta transacción privada.
update public.profiles set driver_id=null where id='5aeec4a5-8784-4ec4-84d7-df874df7c51c';
set local role authenticated;
do $$ begin
  if exists(select 1 from public.salida_resultados where salida_id='fc95f165-180e-4e21-9110-fcaf4d196f9d')
    or exists(select 1 from public.salida_resultado_actual where salida_id='fc95f165-180e-4e21-9110-fcaf4d196f9d')
    then raise exception 'Conductor no vinculado puede leer'; end if;
end $$;
reset role;
update public.profiles set driver_id='907b45ca-193b-4de4-b90d-7895355911aa',access_status='inactive'
where id='5aeec4a5-8784-4ec4-84d7-df874df7c51c';
set local role authenticated;
do $$ begin
  if exists(select 1 from public.salida_resultado_actual where salida_id='fc95f165-180e-4e21-9110-fcaf4d196f9d')
    then raise exception 'Cuenta inactiva puede leer'; end if;
  raise notice 'PASS exacto=1; desvinculado=0; inactivo=0; rollback';
end $$;
rollback;
