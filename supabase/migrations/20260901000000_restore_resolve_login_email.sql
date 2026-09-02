-- Restaura el inicio de sesion con nombre de usuario.
--
-- Diagnostico: la funcion public.resolve_login_email no existe en la base.
-- PostgREST responde PGRST202 al llamarla, asi que signIn() en
-- src/context/AuthContext.tsx siempre devuelve "Usuario no encontrado."
-- cuando el texto ingresado no contiene "@".
--
-- Hasta ahora el problema estaba tapado por un alias hardcodeado en el
-- cliente. Al quitarlo quedo expuesto el camino real.
--
-- Esta migracion es idempotente y no destructiva:
--   - create or replace no borra datos ni rompe si ya existiera.
--   - el update solo completa filas donde username es null.

create or replace function public.resolve_login_email(login_identifier text)
returns text
language sql
security definer
set search_path = public
stable
as $$
  select auth_email
  from public.profiles
  where lower(username) = lower(login_identifier)
     or lower(auth_email) = lower(login_identifier)
  limit 1;
$$;

-- La funcion es security definer: se ejecuta con permisos del propietario
-- para poder leer profiles antes de que exista una sesion. Solo devuelve el
-- email asociado a un usuario, nunca datos del perfil.
grant execute on function public.resolve_login_email(text) to anon, authenticated;

-- Relleno de usernames faltantes.
-- Sin esto, un perfil con username null nunca resuelve por nombre de usuario
-- aunque la funcion exista. Toca unicamente filas incompletas.
--
-- Se hace fila por fila a proposito: existe un indice unico sobre
-- lower(username), y dos correos distintos pueden derivar el mismo nombre
-- (juan@a.com y juan@b.com -> "juan"). En un update masivo esa colision
-- abortaria toda la migracion. Aca la fila conflictiva simplemente se
-- omite y se informa, sin frenar el resto.
do $$
declare
  perfil record;
  candidato text;
begin
  for perfil in
    select id, auth_email
    from public.profiles
    where auth_email is not null
      and username is null
  loop
    candidato := split_part(perfil.auth_email, '@', 1);

    begin
      update public.profiles
      set username = candidato
      where id = perfil.id;
    exception
      when unique_violation then
        raise notice
          'Username "%" ya existe. El perfil % queda sin username y debe entrar con su email.',
          candidato, perfil.id;
    end;
  end loop;
end;
$$;

-- Verificacion. Debe devolver el email del usuario indicado.
-- select public.resolve_login_email('TU_USUARIO_AQUI');
