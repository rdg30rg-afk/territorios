\set ON_ERROR_STOP on
-- A4: resolve_login_email acotado.

update public.profiles set username = 'admin.unico', auth_email = 'admin@example.test' where id = '00000000-0000-0000-0000-000000000001';
update public.profiles set username = 'Hermano.Uno', auth_email = 'uno@example.test' where id = '00000000-0000-0000-0000-000000000002';
update public.profiles set username = 'baja', auth_email = 'baja@example.test', access_status = 'inactive'
  where id = '00000000-0000-0000-0000-000000000003';

-- Función vieja: sin sesión devuelve el correo por nombre y también por correo (el problema).
create or replace function public.resolve_login_email(login_identifier text)
returns text language sql security definer set search_path = public stable as $$
  select auth_email from public.profiles
  where lower(username) = lower(login_identifier) or lower(auth_email) = lower(login_identifier) limit 1;
$$;
grant execute on function public.resolve_login_email(text) to anon, authenticated;
set role anon;
select public.assert_true(
  public.resolve_login_email('uno@example.test') = 'uno@example.test'
  and public.resolve_login_email('baja') = 'baja@example.test',
  'El fixture no reproduce la función vieja'
);
reset role;

\ir ../../../supabase/migrations/20261113060000_resolve_login_email_acotado.sql
\ir ../../../supabase/migrations/20261113060000_resolve_login_email_acotado.sql

set role anon;
-- Por nombre de usuario sigue funcionando, sin importar mayúsculas ni espacios.
select public.assert_true(
  public.resolve_login_email('  hermano.UNO ') = 'uno@example.test'
  and public.resolve_login_email('admin.unico') = 'admin@example.test',
  'El inicio de sesión por nombre de usuario dejó de funcionar'
);
-- Ya no confirma correos, ni devuelve el de una cuenta de baja, ni hay respuesta para vacíos o desconocidos.
select public.assert_true(
  public.resolve_login_email('uno@example.test') is null
  and public.resolve_login_email('baja') is null
  and public.resolve_login_email('') is null
  and public.resolve_login_email(null) is null
  and public.resolve_login_email('no.existe') is null,
  'resolve_login_email responde de más'
);
-- La tabla de consultas no se puede leer ni escribir sin sesión.
select public.assert_raises($$select * from public.login_consultas$$, '42501');
reset role;

-- Tope por nombre: 6 por minuto; después contesta lo mismo que un usuario inexistente.
delete from public.login_consultas;
set role anon;
do $$
declare
  v_i integer;
  v_ultimo text;
begin
  for v_i in 1..6 loop
    if public.resolve_login_email('admin.unico') is distinct from 'admin@example.test' then
      raise exception 'La consulta % debía responder', v_i;
    end if;
  end loop;
  v_ultimo := public.resolve_login_email('admin.unico');
  if v_ultimo is not null then
    raise exception 'La consulta 7 en el minuto debía quedar sin respuesta';
  end if;
  -- Otro nombre no se ve afectado.
  if public.resolve_login_email('hermano.uno') is null then
    raise exception 'El tope de un nombre bloqueó a otro';
  end if;
end $$;
reset role;

-- Tope global: 120 por minuto.
delete from public.login_consultas;
insert into public.login_consultas (huella) select md5(g::text) from generate_series(1, 120) g;
set role anon;
select public.assert_true(
  public.resolve_login_email('hermano.uno') is null,
  'El tope global de 120 por minuto no frenó la consulta'
);
reset role;
select public.assert_true(
  (select count(*) from public.login_consultas) = 120,
  'Pasado el tope global se siguieron guardando consultas'
);

-- Las consultas viejas se limpian solas.
update public.login_consultas set creado_at = now() - interval '2 hours';
set role anon;
select public.assert_true(public.resolve_login_email('hermano.uno') = 'uno@example.test', 'No volvió a responder tras la ventana');
reset role;
select public.assert_true((select count(*) from public.login_consultas) = 1, 'No limpió las consultas de hace más de una hora');

select 'PASS: resolve_login_email acotado' as resultado;
