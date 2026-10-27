-- Errores que el navegador atrapa (window.onerror y promesas sin atrapar), para
-- enterarse cuando el mapa falla en un teléfono que nadie reporta (Q6).
--
-- Sin datos personales: la tabla no tiene email, nombre ni coordenadas. Solo
-- el UUID de quien reportó (para el tope por hora), su nivel de acceso, la
-- versión de la app, la ruta SIN query ni hash, y el mensaje, la pila y el
-- user agent truncados. Además, `errores_cliente_limpiar` borra de esos textos
-- emails, tokens, coordenadas y query strings de URLs antes de guardarlos.
--
-- Lectura: solo administradores (RLS). Escritura: solo por la RPC
-- `reportar_error_cliente`, con tope de 30 reportes por usuario y por hora.
begin;

create table if not exists public.errores_cliente (
  id bigint generated always as identity primary key,
  creado_at timestamptz not null default clock_timestamp(),
  reportado_por uuid references public.profiles (id) on delete set null,
  version_app text not null default 'sin-version' check (char_length(version_app) <= 40),
  ruta text not null default '/' check (char_length(ruta) <= 200),
  rol text check (rol is null or char_length(rol) <= 30),
  mensaje text not null check (char_length(mensaje) between 1 and 500),
  pila text check (pila is null or char_length(pila) <= 2000),
  user_agent text check (user_agent is null or char_length(user_agent) <= 300)
);

-- El tope cuenta por usuario en la última hora; el panel de admin lee lo más nuevo.
create index if not exists errores_cliente_usuario_hora_idx
  on public.errores_cliente (reportado_por, creado_at desc);
create index if not exists errores_cliente_creado_idx
  on public.errores_cliente (creado_at desc);

alter table public.errores_cliente enable row level security;
revoke all on public.errores_cliente from anon, public, authenticated;
grant select on public.errores_cliente to authenticated;

drop policy if exists "Admins leen errores del cliente" on public.errores_cliente;
create policy "Admins leen errores del cliente" on public.errores_cliente
  for select to authenticated
  using (public.is_admin(auth.uid()));

-- Mismas reglas que `limpiarTexto` en src/lib/reportarErrorNucleo.ts: si se
-- cambia una, cambiar la otra. Orden: query/hash de URLs, JWT, emails, cadenas
-- largas opacas (tokens) y números con 4 o más decimales (coordenadas).
create or replace function public.errores_cliente_limpiar(p_texto text)
returns text
language sql
immutable
parallel safe
set search_path = pg_catalog
as $fn$
  select regexp_replace(
    regexp_replace(
      regexp_replace(
        regexp_replace(
          regexp_replace(
            p_texto,
            '(https?://[^[:space:]?#)"'']+)[?#][^[:space:])"'']*', '\1', 'g'),
          'eyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]*', '[token]', 'g'),
        '[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+(\.[A-Za-z0-9-]+)+', '[email]', 'g'),
      '[A-Za-z0-9_-]{40,}', '[token]', 'g'),
    '(?<![0-9.])-?[0-9]{1,3}\.[0-9]{4,}(?![0-9])', '[coord]', 'g')
$fn$;
revoke all on function public.errores_cliente_limpiar(text) from public, anon, authenticated;

-- Devuelve true si guardó el reporte y false si lo descartó (cuenta sin acceso
-- activo o tope de la hora alcanzado). Descartar no es un error: el cliente no
-- tiene nada que reintentar y no debe generar más ruido.
create or replace function public.reportar_error_cliente(
  p_mensaje text,
  p_pila text default null,
  p_ruta text default null,
  p_version_app text default null,
  p_user_agent text default null
)
returns boolean
language plpgsql
security definer
set search_path = public, pg_temp
set row_security = off
as $$
declare
  usuario uuid := auth.uid();
  limite_por_hora constant integer := 30;
  recientes integer;
  nivel text;
  pila_limpia text;
begin
  if usuario is null then
    raise exception 'Hace falta iniciar sesión para reportar un error' using errcode = '42501';
  end if;
  if not public.es_usuario_activo() then
    return false;
  end if;

  select count(*) into recientes
  from public.errores_cliente
  where reportado_por = usuario
    and creado_at > clock_timestamp() - interval '1 hour';
  if recientes >= limite_por_hora then
    return false;
  end if;

  -- El nivel sale de la base, no del cliente. `to_jsonb` evita nombrar una
  -- columna que cambió de nombre entre versiones del esquema (role / system_role).
  select left(coalesce(to_jsonb(perfil) ->> 'system_role', to_jsonb(perfil) ->> 'role'), 30)
  into nivel
  from public.profiles perfil
  where perfil.id = usuario;
  if nivel is null or nivel !~ '^[a-z_]{1,30}$' then
    nivel := null;
  end if;

  pila_limpia := nullif(btrim(public.errores_cliente_limpiar(left(coalesce(p_pila, ''), 6000))), '');

  insert into public.errores_cliente (
    reportado_por, version_app, ruta, rol, mensaje, pila, user_agent
  ) values (
    usuario,
    left(coalesce(nullif(btrim(public.errores_cliente_limpiar(left(coalesce(p_version_app, ''), 200))), ''), 'sin-version'), 40),
    -- Solo el camino: lo que viene después de ? o # puede traer datos.
    left(coalesce(nullif(btrim(public.errores_cliente_limpiar(
      regexp_replace(left(coalesce(p_ruta, ''), 1000), '[?#].*$', ''))), ''), '/'), 200),
    nivel,
    left(coalesce(nullif(btrim(public.errores_cliente_limpiar(left(coalesce(p_mensaje, ''), 2000))), ''), '(sin mensaje)'), 500),
    left(pila_limpia, 2000),
    left(nullif(btrim(public.errores_cliente_limpiar(left(coalesce(p_user_agent, ''), 1000))), ''), 300)
  );
  return true;
end;
$$;
revoke all on function public.reportar_error_cliente(text, text, text, text, text) from public, anon;
grant execute on function public.reportar_error_cliente(text, text, text, text, text) to authenticated;

notify pgrst, 'reload schema';
commit;
