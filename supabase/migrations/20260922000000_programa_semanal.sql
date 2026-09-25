-- La semana de la congregación, en la base.
--
-- Hasta ahora los horarios y los titulares vivían en el código. Eso alcanza
-- para armar un programa, pero no para que la congregación cambie su semana
-- sin que alguien toque el repositorio: cuando se mueve un horario o cambia
-- quién conduce los martes, tiene que poder hacerse desde la pantalla.
--
-- Cuatro tablas chicas, una por cosa que se repite todas las semanas:
--   programa_horarios   el horario de cada día y turno (sin fila = no se sale)
--   programa_titulares  quién conduce (una fila = fijo, dos = alternan)
--   programa_telefono   los días de predicación telefónica
--   programa_grupos     los días de "Salidas de Grupos"
--
-- Se leen con el patrón de dos entregas que ya usa la app: si la tabla no
-- está, el cliente cae en la semana que tiene en el código y la pantalla
-- sigue andando. Se escriben solo por RPC, con la misma autorización que las
-- salidas: cuenta activa y administrador.
--
-- El seed es la semana real de septiembre de 2026, la que está en el programa
-- de papel y que la base de DEV confirma salida por salida. Los titulares se
-- resuelven por nombre contra `conductores`, así el mismo archivo sirve en DEV
-- y en producción sin arrastrar identificadores de una base a la otra.
--
-- Escrita el 22 de septiembre de 2026.

begin;

create table if not exists public.programa_horarios (
  dow smallint not null check (dow between 0 and 6),
  turno text not null check (turno in ('manana', 'tarde')),
  hora time not null,
  updated_by uuid references public.profiles (id) on delete set null,
  updated_at timestamptz not null default now(),
  primary key (dow, turno)
);

comment on table public.programa_horarios is
  'El horario de siempre de cada día y turno. Sin fila, ese turno no se sale.';

create table if not exists public.programa_titulares (
  dow smallint not null check (dow between 0 and 6),
  turno text not null check (turno in ('manana', 'tarde', 'telefono')),
  orden smallint not null check (orden between 1 and 3),
  conductor_id uuid not null references public.conductores (id) on delete cascade,
  primary key (dow, turno, orden)
);

comment on table public.programa_titulares is
  'Quién conduce cada turno. Una fila es siempre el mismo; dos alternan por semana ISO.';

create table if not exists public.programa_telefono (
  dow smallint primary key check (dow between 0 and 6),
  hora time not null
);

create table if not exists public.programa_grupos (
  dow smallint primary key check (dow between 0 and 6),
  hora time not null
);

comment on table public.programa_grupos is
  'Las Salidas de Grupos: cada grupo sale por su lado y no se planifican acá.';

alter table public.programa_horarios enable row level security;
alter table public.programa_titulares enable row level security;
alter table public.programa_telefono enable row level security;
alter table public.programa_grupos enable row level security;

/* Cualquier cuenta activa la lee: la semana es de la congregación entera, no
   del que administra. Escribir es otra cosa y va por la RPC. */
drop policy if exists "Los usuarios activos leen la semana" on public.programa_horarios;
create policy "Los usuarios activos leen la semana"
on public.programa_horarios for select to authenticated
using (public.es_usuario_activo());

drop policy if exists "Los usuarios activos leen los titulares" on public.programa_titulares;
create policy "Los usuarios activos leen los titulares"
on public.programa_titulares for select to authenticated
using (public.es_usuario_activo());

drop policy if exists "Los usuarios activos leen el telefono" on public.programa_telefono;
create policy "Los usuarios activos leen el telefono"
on public.programa_telefono for select to authenticated
using (public.es_usuario_activo());

drop policy if exists "Los usuarios activos leen los grupos" on public.programa_grupos;
create policy "Los usuarios activos leen los grupos"
on public.programa_grupos for select to authenticated
using (public.es_usuario_activo());

revoke insert, update, delete on public.programa_horarios from public, anon, authenticated;
revoke insert, update, delete on public.programa_titulares from public, anon, authenticated;
revoke insert, update, delete on public.programa_telefono from public, anon, authenticated;
revoke insert, update, delete on public.programa_grupos from public, anon, authenticated;

create or replace function public.guardar_programa_semanal(
  p_horarios jsonb,
  p_titulares jsonb,
  p_telefono jsonb,
  p_grupos jsonb
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_item jsonb;
  v_dow int;
  v_turno text;
  v_hora text;
begin
  if not public.es_usuario_activo() then
    raise exception 'Tu cuenta no tiene acceso activo' using errcode = '42501';
  end if;

  if not public.is_admin(auth.uid()) then
    raise exception 'Solo un administrador puede cambiar la semana' using errcode = '42501';
  end if;

  if jsonb_typeof(p_horarios) <> 'array'
     or jsonb_typeof(p_titulares) <> 'array'
     or jsonb_typeof(p_telefono) <> 'array'
     or jsonb_typeof(p_grupos) <> 'array' then
    raise exception 'La semana llega como listas' using errcode = '22023';
  end if;

  /* Se valida todo antes de escribir: si una fila viene mal, no se toca nada. */
  for v_item in select value from jsonb_array_elements(p_horarios) loop
    v_dow := (v_item->>'dow')::int;
    v_turno := v_item->>'turno';
    v_hora := v_item->>'hora';
    if v_dow is null or v_dow < 0 or v_dow > 6 then
      raise exception 'Día inválido en los horarios' using errcode = '22023';
    end if;
    if v_turno not in ('manana', 'tarde') then
      raise exception 'Turno inválido en los horarios' using errcode = '22023';
    end if;
    if v_hora is null or v_hora !~ '^([01][0-9]|2[0-3]):[0-5][0-9](:[0-5][0-9])?$' then
      raise exception 'Hora inválida en los horarios' using errcode = '22023';
    end if;
  end loop;

  for v_item in select value from jsonb_array_elements(p_telefono) loop
    v_dow := (v_item->>'dow')::int;
    v_hora := v_item->>'hora';
    if v_dow is null or v_dow < 0 or v_dow > 6 then
      raise exception 'Día inválido en el teléfono' using errcode = '22023';
    end if;
    if v_hora is null or v_hora !~ '^([01][0-9]|2[0-3]):[0-5][0-9](:[0-5][0-9])?$' then
      raise exception 'Hora inválida en el teléfono' using errcode = '22023';
    end if;
  end loop;

  for v_item in select value from jsonb_array_elements(p_grupos) loop
    v_dow := (v_item->>'dow')::int;
    v_hora := v_item->>'hora';
    if v_dow is null or v_dow < 0 or v_dow > 6 then
      raise exception 'Día inválido en las salidas de grupos' using errcode = '22023';
    end if;
    if v_hora is null or v_hora !~ '^([01][0-9]|2[0-3]):[0-5][0-9](:[0-5][0-9])?$' then
      raise exception 'Hora inválida en las salidas de grupos' using errcode = '22023';
    end if;
  end loop;

  for v_item in select value from jsonb_array_elements(p_titulares) loop
    v_dow := (v_item->>'dow')::int;
    v_turno := v_item->>'turno';
    if v_dow is null or v_dow < 0 or v_dow > 6 then
      raise exception 'Día inválido en los titulares' using errcode = '22023';
    end if;
    if v_turno not in ('manana', 'tarde', 'telefono') then
      raise exception 'Turno inválido en los titulares' using errcode = '22023';
    end if;
    if (v_item->>'orden')::int not between 1 and 3 then
      raise exception 'Un turno no puede tener más de tres titulares' using errcode = '22023';
    end if;
    if not exists (
      select 1 from public.conductores where id = (v_item->>'conductor_id')::uuid
    ) then
      raise exception 'El conductor de un titular no existe' using errcode = '23503';
    end if;
  end loop;

  /* La semana se edita entera: se reemplaza. */
  delete from public.programa_horarios where true;
  insert into public.programa_horarios (dow, turno, hora, updated_by)
  select (value->>'dow')::smallint, value->>'turno', (value->>'hora')::time, auth.uid()
  from jsonb_array_elements(p_horarios);

  delete from public.programa_titulares where true;
  insert into public.programa_titulares (dow, turno, orden, conductor_id)
  select (value->>'dow')::smallint, value->>'turno', (value->>'orden')::smallint,
         (value->>'conductor_id')::uuid
  from jsonb_array_elements(p_titulares);

  delete from public.programa_telefono where true;
  insert into public.programa_telefono (dow, hora)
  select (value->>'dow')::smallint, (value->>'hora')::time
  from jsonb_array_elements(p_telefono);

  delete from public.programa_grupos where true;
  insert into public.programa_grupos (dow, hora)
  select (value->>'dow')::smallint, (value->>'hora')::time
  from jsonb_array_elements(p_grupos);
end;
$$;

revoke all on function public.guardar_programa_semanal(jsonb, jsonb, jsonb, jsonb)
  from public, anon;
grant execute on function public.guardar_programa_semanal(jsonb, jsonb, jsonb, jsonb)
  to authenticated;

/* --------------------------------------------------------------------------
   El seed: la semana real, la del programa de papel de septiembre de 2026.
   -------------------------------------------------------------------------- */

insert into public.programa_horarios (dow, turno, hora) values
  (1, 'manana', '09:30'), (1, 'tarde', '17:00'),
  (2, 'manana', '09:30'), (2, 'tarde', '17:00'),
  (3, 'manana', '09:30'), (3, 'tarde', '17:00'),
  (5, 'manana', '09:30'), (5, 'tarde', '17:00'),
  (6, 'tarde', '17:00')
on conflict (dow, turno) do nothing;

insert into public.programa_telefono (dow, hora) values
  (1, '19:30'), (2, '19:30')
on conflict (dow) do nothing;

insert into public.programa_grupos (dow, hora) values
  (6, '10:00')
on conflict (dow) do nothing;

/* Los titulares, por nombre: el mismo archivo vale en cualquier base. */
insert into public.programa_titulares (dow, turno, orden, conductor_id)
select v.dow, v.turno, v.orden, c.id
from (values
  (1, 'manana', 1, 'Pablo Ramirez'),
  (1, 'tarde', 1, 'Miguel Perez'),
  (1, 'telefono', 1, 'Hugo Quiroga'),
  (2, 'manana', 1, 'Miguel Canario'),
  (2, 'manana', 2, 'Francisco Criado'),
  (2, 'tarde', 1, 'Ariel Riveros'),
  (2, 'tarde', 2, 'Fernando Pozo'),
  (2, 'telefono', 1, 'Hugo Quiroga'),
  (3, 'manana', 1, 'Gabriel Sosa'),
  (3, 'tarde', 1, 'Mario Campillay'),
  (5, 'manana', 1, 'Jose Caballero'),
  (5, 'tarde', 1, 'Duilio Riveros'),
  (5, 'tarde', 2, 'Daniel Marquez'),
  (6, 'tarde', 1, 'Javier Salazar'),
  (6, 'tarde', 2, 'Ariel Riveros')
) as v(dow, turno, orden, nombre)
join public.conductores c on c.full_name = v.nombre
on conflict (dow, turno, orden) do nothing;

/* Si algún nombre no coincidió, se avisa en vez de dejar la semana a medias. */
do $$
declare
  v_esperados int := 15;
  v_puestos int;
begin
  select count(*) into v_puestos from public.programa_titulares;
  if v_puestos < v_esperados then
    raise warning 'Quedaron % titulares de %: revisá los nombres contra conductores.full_name',
      v_puestos, v_esperados;
  end if;
end;
$$;

notify pgrst, 'reload schema';

commit;
