-- Fixture disposable para probar la semana de la congregación en la base.
-- No conecta a Supabase ni representa cuentas ni identificadores reales.

create extension if not exists pgcrypto;

create role authenticated;
create role anon;
create schema auth;

create function auth.uid()
returns uuid
language sql
stable
as $$
  select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid
$$;

grant usage on schema auth, public to authenticated, anon;

create table public.profiles (
  id uuid primary key,
  full_name text not null,
  role text not null,
  access_status text not null
);

create table public.conductores (
  id uuid primary key,
  full_name text not null,
  status text not null
);

create or replace function public.es_usuario_activo()
returns boolean
language sql
security definer
stable
set search_path = public
as $$
  select exists (
    select 1 from public.profiles where id = auth.uid() and access_status = 'active'
  )
$$;

create or replace function public.is_admin(user_id uuid)
returns boolean
language sql
security definer
stable
set search_path = public
as $$
  select exists (
    select 1 from public.profiles
    where id = user_id and role = 'admin' and access_status = 'active'
  )
$$;

grant execute on function public.es_usuario_activo() to authenticated;
grant execute on function public.is_admin(uuid) to authenticated;

insert into public.profiles (id, full_name, role, access_status) values
  ('00000000-0000-0000-0000-000000000001', 'Admin', 'admin', 'active'),
  ('00000000-0000-0000-0000-000000000002', 'Publicador', 'viewer', 'active'),
  ('00000000-0000-0000-0000-000000000003', 'Inactivo', 'admin', 'pending');

/* Los trece conductores que el seed nombra, con los nombres tal como están en
   la base de DEV. Si un nombre cambia, el seed lo avisa y este test lo ve. */
insert into public.conductores (id, full_name, status) values
  ('10000000-0000-0000-0000-000000000001', 'Pablo Ramirez', 'activo'),
  ('10000000-0000-0000-0000-000000000002', 'Miguel Perez', 'activo'),
  ('10000000-0000-0000-0000-000000000003', 'Hugo Quiroga', 'activo'),
  ('10000000-0000-0000-0000-000000000004', 'Miguel Canario', 'activo'),
  ('10000000-0000-0000-0000-000000000005', 'Francisco Criado', 'activo'),
  ('10000000-0000-0000-0000-000000000006', 'Ariel Riveros', 'activo'),
  ('10000000-0000-0000-0000-000000000007', 'Fernando Pozo', 'activo'),
  ('10000000-0000-0000-0000-000000000008', 'Gabriel Sosa', 'activo'),
  ('10000000-0000-0000-0000-000000000009', 'Mario Campillay', 'activo'),
  ('10000000-0000-0000-0000-000000000010', 'Jose Caballero', 'activo'),
  ('10000000-0000-0000-0000-000000000011', 'Duilio Riveros', 'activo'),
  ('10000000-0000-0000-0000-000000000012', 'Daniel Marquez', 'activo'),
  ('10000000-0000-0000-0000-000000000013', 'Javier Salazar', 'activo');

\ir ../../supabase/migrations/20260922000000_programa_semanal.sql

-- --------------------------------------------------------------------------
-- El seed: la semana real tiene que haber entrado entera
-- --------------------------------------------------------------------------
do $$
declare
  v_cuantos int;
begin
  select count(*) into v_cuantos from public.programa_horarios;
  if v_cuantos <> 9 then
    raise exception 'Se esperaban 9 horarios y hay %', v_cuantos;
  end if;

  select count(*) into v_cuantos from public.programa_telefono;
  if v_cuantos <> 2 then
    raise exception 'Se esperaban 2 días de teléfono y hay %', v_cuantos;
  end if;

  select count(*) into v_cuantos from public.programa_grupos;
  if v_cuantos <> 1 then
    raise exception 'Se esperaba 1 día de salidas de grupos y hay %', v_cuantos;
  end if;

  -- Quince filas de titulares: trece turnos, dos de ellos con dos personas.
  select count(*) into v_cuantos from public.programa_titulares;
  if v_cuantos <> 15 then
    raise exception 'Se esperaban 15 titulares y hay % (¿algún nombre no coincide?)', v_cuantos;
  end if;

  if exists (select 1 from public.programa_horarios where dow = 4) then
    raise exception 'El jueves no se sale y no debería tener horario';
  end if;

  if (select count(*) from public.programa_titulares where dow = 2 and turno = 'manana') <> 2 then
    raise exception 'Los martes a la mañana alternan entre dos';
  end if;

  if not exists (
    select 1 from public.programa_horarios where dow = 6 and turno = 'tarde' and hora = '17:00'
  ) then
    raise exception 'El sábado a la tarde sale a las 17:00';
  end if;
end;
$$;

-- --------------------------------------------------------------------------
-- Quién puede escribir: un publicador activo no, un admin activo sí
-- --------------------------------------------------------------------------
begin;
set local role authenticated;
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000002', true);
do $$
begin
  begin
    perform public.guardar_programa_semanal('[]'::jsonb, '[]'::jsonb, '[]'::jsonb, '[]'::jsonb);
    raise exception 'Un publicador no debería poder cambiar la semana';
  exception
    when insufficient_privilege then null;
  end;
end;
$$;
commit;

begin;
set local role authenticated;
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000003', true);
do $$
begin
  begin
    perform public.guardar_programa_semanal('[]'::jsonb, '[]'::jsonb, '[]'::jsonb, '[]'::jsonb);
    raise exception 'Una cuenta sin acceso activo no debería poder cambiar la semana';
  exception
    when insufficient_privilege then null;
  end;
end;
$$;
commit;

-- Una hora imposible se rechaza antes de tocar nada.
begin;
set local role authenticated;
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000001', true);
do $$
begin
  begin
    perform public.guardar_programa_semanal(
      '[{"dow":1,"turno":"manana","hora":"25:99"}]'::jsonb,
      '[]'::jsonb, '[]'::jsonb, '[]'::jsonb
    );
    raise exception 'Debería haber rechazado la hora';
  exception
    when invalid_parameter_value then null;
  end;
end;
$$;
commit;

do $$
begin
  if (select count(*) from public.programa_horarios) <> 9 then
    raise exception 'Un payload inválido no puede tocar la semana';
  end if;
end;
$$;

-- --------------------------------------------------------------------------
-- El admin guarda: la semana se reemplaza entera
-- --------------------------------------------------------------------------
begin;
set local role authenticated;
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000001', true);
select public.guardar_programa_semanal(
  '[{"dow":1,"turno":"manana","hora":"10:00"},{"dow":3,"turno":"tarde","hora":"18:00"}]'::jsonb,
  '[{"dow":1,"turno":"manana","orden":1,"conductor_id":"10000000-0000-0000-0000-000000000001"}]'::jsonb,
  '[{"dow":5,"hora":"19:00"}]'::jsonb,
  '[]'::jsonb
);
commit;

do $$
declare
  v_hora time;
  v_cuantos int;
begin
  select count(*) into v_cuantos from public.programa_horarios;
  if v_cuantos <> 2 then
    raise exception 'La semana se reemplaza entera: se esperaban 2 horarios y hay %', v_cuantos;
  end if;

  select hora into v_hora from public.programa_horarios where dow = 1 and turno = 'manana';
  if v_hora <> '10:00' then
    raise exception 'El horario nuevo no se guardó: %', v_hora;
  end if;

  if (select count(*) from public.programa_telefono) <> 1 then
    raise exception 'El teléfono también se reemplaza entero';
  end if;

  if (select count(*) from public.programa_grupos) <> 0 then
    raise exception 'Las salidas de grupos se reemplazan enteras';
  end if;

  if (select conductor_id from public.programa_titulares where dow = 1 and turno = 'manana')
     <> '10000000-0000-0000-0000-000000000001' then
    raise exception 'El titular no se guardó';
  end if;
end;
$$;

-- Un conductor que no existe no entra.
begin;
set local role authenticated;
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000001', true);
do $$
begin
  begin
    perform public.guardar_programa_semanal(
      '[]'::jsonb,
      '[{"dow":1,"turno":"manana","orden":1,"conductor_id":"99999999-0000-0000-0000-000000000009"}]'::jsonb,
      '[]'::jsonb, '[]'::jsonb
    );
    raise exception 'Debería haber rechazado el conductor inexistente';
  exception
    when foreign_key_violation then null;
  end;
end;
$$;
commit;

do $$
begin
  if (select count(*) from public.programa_titulares) <> 1 then
    raise exception 'Un titular inválido no puede tocar la semana';
  end if;
end;
$$;

-- El guardado del período usa la misma frontera de permisos y admite
-- teléfono sin inventar un territorio o un punto de encuentro.
create table public.salidas (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  territory_id uuid,
  driver_id uuid,
  group_id uuid,
  meeting_point_name text,
  scheduled_for timestamptz not null,
  tipo text,
  territorio_codigo text
);

create function public.salidas_rpc_autorizado(p_scope text, p_group_id uuid)
returns boolean language sql stable security definer as $$
  select p_scope = 'general' and public.is_admin(auth.uid())
$$;

create function public.crear_salidas_lote(p_scope text, p_salidas jsonb)
returns setof public.salidas language plpgsql security definer as $$
declare v_item jsonb;
begin
  for v_item in select value from jsonb_array_elements(p_salidas) loop
    if exists (
      select 1 from jsonb_object_keys(v_item) as campo
      where campo not in ('title', 'territory_id', 'driver_id', 'group_id',
        'meeting_point_id', 'meeting_point_name', 'meeting_point_lat',
        'meeting_point_lng', 'scheduled_for', 'notes')
    ) then
      raise exception 'El lote contiene un campo no permitido' using errcode = '22023';
    end if;
    if v_item->>'territory_id' is null then
      raise exception 'La salida común necesita territorio' using errcode = '22023';
    end if;
    return query insert into public.salidas (title, territory_id, driver_id, meeting_point_name, scheduled_for)
      values (v_item->>'title', (v_item->>'territory_id')::uuid,
        (v_item->>'driver_id')::uuid, v_item->>'meeting_point_name',
        (v_item->>'scheduled_for')::timestamptz)
      returning *;
  end loop;
end;
$$;

\ir ../../supabase/migrations/20260923010000_programa_excepciones_y_guardado.sql

begin;
set local role authenticated;
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000002', true);
do $$
begin
  begin
    perform public.guardar_programa_periodo('[]', '[{"fecha":"2026-11-06","motivo":"Asamblea regional"}]', '[]');
    raise exception 'Un publicador no puede guardar excepciones';
  exception when insufficient_privilege then null;
  end;
end;
$$;
commit;

begin;
set local role authenticated;
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000001', true);
select public.guardar_programa_periodo(
  '[{"tipo":"telefonica","title":"PREDICACION TELEFONICA","driver_id":"10000000-0000-0000-0000-000000000003","scheduled_for":"2026-11-03T22:30:00Z"}]',
  '[{"fecha":"2026-11-06","motivo":"Asamblea regional"}]',
  '[{"fecha":"2026-11-05","turno":"manana","sin_salida":true}]'
);
commit;

do $$
begin
  if not exists (select 1 from public.salidas where tipo = 'telefonica' and territory_id is null
    and meeting_point_name = 'Cada uno desde su casa') then
    raise exception 'El teléfono no se guardó correctamente';
  end if;
  if not exists (select 1 from public.programa_dias where fecha = '2026-11-06' and motivo = 'Asamblea regional') then
    raise exception 'La asamblea no persistió';
  end if;
  if not exists (select 1 from public.programa_filas_sin_salida where fecha = '2026-11-05' and turno = 'manana') then
    raise exception 'La fila sin salida no persistió';
  end if;
end;
$$;

-- Si una salida común falla, la telefónica del mismo lote tampoco queda.
begin;
set local role authenticated;
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000001', true);
do $$
begin
  begin
    perform public.guardar_programa_periodo(
      '[{"tipo":"telefonica","title":"PREDICACION TELEFONICA","driver_id":"10000000-0000-0000-0000-000000000003","scheduled_for":"2026-11-04T22:30:00Z"},{"tipo":"territorial","title":"Sin territorio","scheduled_for":"2026-11-04T12:30:00Z"}]',
      '[]', '[]');
    raise exception 'El lote inválido debería fallar';
  exception when invalid_parameter_value then null;
  end;
end;
$$;
commit;

do $$
begin
  if (select count(*) from public.salidas) <> 1 then
    raise exception 'Un fallo parcial no puede dejar una salida telefónica';
  end if;
end;
$$;

begin;
set local role authenticated;
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000001', true);
select public.guardar_programa_periodo('[]',
  '[{"fecha":"2026-11-06","motivo":null}]',
  '[{"fecha":"2026-11-05","turno":"manana","sin_salida":false}]');
commit;

do $$
begin
  if exists (select 1 from public.programa_dias where fecha = '2026-11-06')
    or exists (select 1 from public.programa_filas_sin_salida where fecha = '2026-11-05') then
    raise exception 'Quitar una excepción debe persistir';
  end if;
end;
$$;

\ir ../../supabase/migrations/20260923020000_borrador_programa_compartido.sql

\ir ../../supabase/migrations/20260923030000_orden_programa_en_agenda.sql

begin;
set local role authenticated;
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000001', true);
select public.guardar_programa_periodo(
  '[{"tipo":"territorial","title":"Tarde primero","territory_id":"20000000-0000-0000-0000-000000000001","driver_id":"10000000-0000-0000-0000-000000000001","meeting_point_name":"Punto A","scheduled_for":"2026-11-09T20:00:00Z","programa_orden":1},{"tipo":"territorial","title":"Mañana después","territory_id":"20000000-0000-0000-0000-000000000002","driver_id":"10000000-0000-0000-0000-000000000002","meeting_point_name":"Punto B","scheduled_for":"2026-11-09T12:30:00Z","programa_orden":2}]',
  '[]', '[]'
);
commit;

do $$
begin
  if (select programa_orden from public.salidas where title = 'Tarde primero') <> 1
    or (select programa_orden from public.salidas where title = 'Mañana después') <> 2 then
    raise exception 'El orden manual no quedó asociado a los ids creados';
  end if;
  if (select programa_orden from public.salidas where tipo = 'telefonica') is not null then
    raise exception 'Una salida anterior no debe recibir posición retroactiva';
  end if;
end;
$$;

begin;
set local role authenticated;
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000001', true);
do $$
begin
  begin
    perform public.guardar_programa_periodo(
      '[{"tipo":"telefonica","title":"PREDICACION TELEFONICA","driver_id":"10000000-0000-0000-0000-000000000003","scheduled_for":"2026-11-10T22:30:00Z","programa_orden":501}]',
      '[]', '[]');
    raise exception 'Una posición fuera de rango debería fallar';
  exception when invalid_parameter_value then null;
  end;
end;
$$;
commit;

begin;
set local role authenticated;
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000002', true);
do $$
begin
  begin
    perform public.guardar_borrador_programa('{"filas":{}}', 0);
    raise exception 'Un publicador no puede escribir el borrador';
  exception when insufficient_privilege then null;
  end;
end;
$$;
commit;

begin;
set local role authenticated;
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000001', true);
select public.guardar_borrador_programa(
  '{"filas":{"2026-11-05-manana-extra-a":{"tildada":true}},"extras":{"2026-11-05":[{"id":"a","turno":"manana"},{"id":"b","turno":"manana"}]},"orden":{"2026-11-05":["2026-11-05-manana-extra-b","2026-11-05-manana-extra-a"]}}', 0
);
do $$
begin
  begin
    perform public.guardar_borrador_programa('{"filas":{}}', 0);
    raise exception 'Una versión vieja no puede pisar el borrador';
  exception when serialization_failure then null;
  end;
end;
$$;
commit;

do $$
begin
  if (select version from public.programa_borrador where id = 1) <> 1
    or (select contenido #>> '{extras,2026-11-05,1,id}' from public.programa_borrador where id = 1) <> 'b'
    or (select contenido #>> '{orden,2026-11-05,0}' from public.programa_borrador where id = 1) <> '2026-11-05-manana-extra-b' then
    raise exception 'El borrador perdió una fila extra o su orden';
  end if;
end;
$$;
