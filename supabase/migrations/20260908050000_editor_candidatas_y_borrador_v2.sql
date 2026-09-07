-- Fuente autenticada de manzanas candidatas y borrador con compare-and-swap.
-- Aditiva: el editor HTML y las RPC de publicación v1 siguen funcionando.

begin;

create table if not exists public.manzana_candidatas (
  id uuid primary key default gen_random_uuid(),
  source_key text not null,
  dataset_version text not null,
  geometry_geojson jsonb not null,
  bbox_min_lng numeric(10, 6) not null,
  bbox_min_lat numeric(9, 6) not null,
  bbox_max_lng numeric(10, 6) not null,
  bbox_max_lat numeric(9, 6) not null,
  centro_lat numeric(9, 6) not null,
  centro_lng numeric(10, 6) not null,
  diagnostics jsonb not null default '{}'::jsonb,
  activa boolean not null default true,
  creada_at timestamptz not null default now(),
  check (btrim(source_key) <> '' and btrim(dataset_version) <> ''),
  check (jsonb_typeof(geometry_geojson) = 'object'
    and geometry_geojson ->> 'type' = 'Polygon'
    and jsonb_typeof(geometry_geojson -> 'coordinates') = 'array'),
  check (bbox_min_lng between -180 and 180 and bbox_max_lng between -180 and 180
    and bbox_min_lat between -90 and 90 and bbox_max_lat between -90 and 90
    and bbox_min_lng <= bbox_max_lng and bbox_min_lat <= bbox_max_lat),
  check (centro_lng between -180 and 180 and centro_lat between -90 and 90),
  unique (dataset_version, source_key)
);

create index if not exists manzana_candidatas_activas_bbox_idx
  on public.manzana_candidatas (activa, bbox_min_lng, bbox_max_lng, bbox_min_lat, bbox_max_lat);
create index if not exists manzana_candidatas_dataset_idx
  on public.manzana_candidatas (dataset_version, source_key);

alter table public.manzana_candidatas enable row level security;
drop policy if exists "Admins leen candidatas del editor" on public.manzana_candidatas;
create policy "Admins leen candidatas del editor"
on public.manzana_candidatas for select to authenticated
using (public.es_admin_territorios(auth.uid()));

revoke all on table public.manzana_candidatas from public, anon, authenticated;
grant select on table public.manzana_candidatas to authenticated;

comment on table public.manzana_candidatas is
  'Geometrías base versionadas del taller. No contiene asignaciones ni datos personales.';

alter table public.editor_estado
  add column if not exists revision bigint not null default 0;

create table if not exists public.editor_estado_historial (
  id bigint generated always as identity primary key,
  borrador_id text not null,
  revision bigint not null,
  accion text not null check (accion in ('guardar', 'descartar')),
  estado jsonb not null,
  actor_id uuid references public.profiles(id) on delete set null,
  creado_at timestamptz not null default now(),
  unique (borrador_id, revision)
);

alter table public.editor_estado_historial enable row level security;
drop policy if exists "Admins leen historial del editor" on public.editor_estado_historial;
create policy "Admins leen historial del editor"
on public.editor_estado_historial for select to authenticated
using (public.es_admin_territorios(auth.uid()));
revoke all on table public.editor_estado_historial from public, anon, authenticated;
grant select on table public.editor_estado_historial to authenticated;

create or replace function public.leer_borrador_editor()
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
set row_security = off
as $$
declare
  v_fila public.editor_estado%rowtype;
begin
  if not public.es_admin_territorios(auth.uid()) then
    raise exception 'Solo un administrador territorial activo puede leer el borrador'
      using errcode = '42501';
  end if;

  select * into v_fila from public.editor_estado where id = 'manzanas';
  if not found then
    return jsonb_build_object(
      'id', 'manzanas', 'revision', 0, 'estado', null,
      'actualizado_por', null, 'actualizado_at', null
    );
  end if;

  return jsonb_build_object(
    'id', v_fila.id,
    'revision', v_fila.revision,
    'estado', v_fila.estado,
    'actualizado_por', v_fila.actualizado_por,
    'actualizado_at', v_fila.actualizado_at
  );
end;
$$;

create or replace function public.guardar_borrador_editor(
  p_revision bigint,
  p_estado jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
set row_security = off
as $$
declare
  v_fila public.editor_estado%rowtype;
  v_revision bigint;
begin
  if not public.es_admin_territorios(auth.uid()) then
    raise exception 'Solo un administrador territorial activo puede guardar el borrador'
      using errcode = '42501';
  end if;
  if p_revision is null or p_revision < 0
    or jsonb_typeof(p_estado) is distinct from 'object'
    or pg_column_size(p_estado) > 5242880 then
    raise exception 'Borrador inválido' using errcode = '22023';
  end if;

  select * into v_fila
  from public.editor_estado
  where id = 'manzanas'
  for update;

  if not found then
    if p_revision <> 0 then
      raise exception 'El borrador cambió desde que lo abriste'
        using errcode = '40001';
    end if;
    v_revision := 1;
    insert into public.editor_estado (id, estado, revision)
    values ('manzanas', p_estado, v_revision)
    returning * into v_fila;
  else
    if v_fila.revision <> p_revision then
      raise exception 'El borrador cambió desde que lo abriste'
        using errcode = '40001';
    end if;
    v_revision := v_fila.revision + 1;
    update public.editor_estado
    set estado = p_estado, revision = v_revision
    where id = 'manzanas'
    returning * into v_fila;
  end if;

  insert into public.editor_estado_historial
    (borrador_id, revision, accion, estado, actor_id, creado_at)
  values
    ('manzanas', v_fila.revision, 'guardar', v_fila.estado, auth.uid(), v_fila.actualizado_at);

  return jsonb_build_object(
    'id', v_fila.id,
    'revision', v_fila.revision,
    'estado', v_fila.estado,
    'actualizado_por', v_fila.actualizado_por,
    'actualizado_at', v_fila.actualizado_at
  );
end;
$$;

create or replace function public.descartar_borrador_editor(p_revision bigint)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
set row_security = off
as $$
declare
  v_fila public.editor_estado%rowtype;
begin
  if not public.es_admin_territorios(auth.uid()) then
    raise exception 'Solo un administrador territorial activo puede descartar el borrador'
      using errcode = '42501';
  end if;

  select * into v_fila
  from public.editor_estado
  where id = 'manzanas'
  for update;
  if not found or p_revision is null or v_fila.revision <> p_revision then
    raise exception 'El borrador cambió desde que lo abriste'
      using errcode = '40001';
  end if;

  update public.editor_estado
  set estado = jsonb_build_object(
        'schema_version', 2,
        'descartado', true,
        'descartado_desde_revision', v_fila.revision
      ),
      revision = v_fila.revision + 1
  where id = 'manzanas'
  returning * into v_fila;

  insert into public.editor_estado_historial
    (borrador_id, revision, accion, estado, actor_id, creado_at)
  values
    ('manzanas', v_fila.revision, 'descartar', v_fila.estado, auth.uid(), v_fila.actualizado_at);

  return jsonb_build_object(
    'id', v_fila.id,
    'revision', v_fila.revision,
    'estado', null,
    'actualizado_por', v_fila.actualizado_por,
    'actualizado_at', v_fila.actualizado_at
  );
end;
$$;

revoke all on function public.leer_borrador_editor() from public, anon;
revoke all on function public.guardar_borrador_editor(bigint, jsonb) from public, anon;
revoke all on function public.descartar_borrador_editor(bigint) from public, anon;
grant execute on function public.leer_borrador_editor() to authenticated;
grant execute on function public.guardar_borrador_editor(bigint, jsonb) to authenticated;
grant execute on function public.descartar_borrador_editor(bigint) to authenticated;

notify pgrst, 'reload schema';
commit;
