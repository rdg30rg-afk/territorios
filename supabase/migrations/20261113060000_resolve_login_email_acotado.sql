-- A4: `resolve_login_email` está abierto sin sesión y devolvía el email de
-- cualquier cuenta: bastaba probar nombres de usuario (que por defecto son la
-- parte del correo antes de la arroba) o correos para armar una lista.
--
-- No se puede cerrar del todo con SQL: el inicio de sesión por nombre de
-- usuario necesita traducirlo a email ANTES de tener sesión. Lo que sí se
-- acota acá:
--   * sólo responde por nombre de usuario exacto (el cliente nunca la llama con
--     un correo; con un correo respondía «sí, esa cuenta existe»);
--   * no devuelve el email de una cuenta inactiva;
--   * tope de consultas: 6 por minuto por nombre y 120 por minuto en total.
--     Pasado el tope contesta null, igual que un usuario que no existe, así
--     que el tope no es una señal para el que prueba.
--   * se guarda sólo un hash del nombre consultado, 1 hora.
-- Cierre definitivo (fuera de esta migración): hacer el inicio de sesión por
-- nombre de usuario en una función de borde que no devuelva el email al navegador.
-- Aplicable dos veces; no borra datos de la app.
begin;

create table if not exists public.login_consultas (
  id bigint generated always as identity primary key,
  huella text not null,
  creado_at timestamptz not null default clock_timestamp()
);
create index if not exists login_consultas_huella_idx on public.login_consultas (huella, creado_at desc);
create index if not exists login_consultas_creado_idx on public.login_consultas (creado_at desc);
alter table public.login_consultas enable row level security;
revoke all on public.login_consultas from anon, authenticated, public;

create or replace function public.resolve_login_email(login_identifier text)
returns text
language plpgsql
volatile
security definer
set search_path = public, pg_temp
set row_security = off
as $$
declare
  v_nombre text := lower(btrim(coalesce(login_identifier, '')));
  v_huella text;
  v_email text;
begin
  if v_nombre = '' or length(v_nombre) > 100 or position('@' in v_nombre) > 0 then
    return null;
  end if;
  v_huella := md5(v_nombre);

  delete from public.login_consultas where creado_at < clock_timestamp() - interval '1 hour';

  if (select count(*) from public.login_consultas
      where creado_at > clock_timestamp() - interval '1 minute') >= 120
     or (select count(*) from public.login_consultas
         where huella = v_huella and creado_at > clock_timestamp() - interval '1 minute') >= 6 then
    return null;
  end if;
  insert into public.login_consultas (huella) values (v_huella);

  select perfil.auth_email into v_email
  from public.profiles perfil
  where lower(perfil.username) = v_nombre
    and perfil.access_status <> 'inactive'
  limit 1;
  return v_email;
end;
$$;

revoke all on function public.resolve_login_email(text) from public;
grant execute on function public.resolve_login_email(text) to anon, authenticated;

notify pgrst, 'reload schema';
commit;
