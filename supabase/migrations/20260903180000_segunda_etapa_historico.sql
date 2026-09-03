-- =====================================================================
-- Segunda etapa del historico del Excel
--
-- Esta migracion agrega una capa historica/source-first para terminar la
-- corrida auditada sin convertir numeros de territorio en identidades
-- actuales. La RPC solo puede ser ejecutada por service_role y falla cerrada
-- si la corrida no es exactamente la fuente auditada.
--
-- Resultado esperado para la corrida auditada:
--   400 filas materializadas como hechos/candidatos historicos
--    71 filas cerradas como sin_evidencia
--     0 pendientes y 0 conflictos
--
-- No crea salidas operativas, resultados, reservas ni vinculos a territorios
-- actuales para los casos sin evidencia.
-- =====================================================================

begin;

-- ---------------------------------------------------------------------
-- 1. Identidades tecnicas y procedencia adicional
-- ---------------------------------------------------------------------

create or replace function public.historical_source_uuid(
  p_kind text,
  p_value text
)
returns uuid
language plpgsql
immutable
parallel safe
set search_path = public
as $$
declare
  digest_text text;
begin
  digest_text := md5(coalesce(p_kind, '') || ':' || coalesce(p_value, ''));
  return (
    substr(digest_text, 1, 8) || '-' ||
    substr(digest_text, 9, 4) || '-' ||
    substr(digest_text, 13, 4) || '-' ||
    substr(digest_text, 17, 4) || '-' ||
    substr(digest_text, 21, 12)
  )::uuid;
end;
$$;

create or replace function public.historical_json_cell_text(
  p_bruto jsonb,
  p_column text
)
returns text
language sql
immutable
parallel safe
set search_path = public
as $$
  select nullif(btrim(cell->>'valor'), '')
  from jsonb_array_elements(coalesce(p_bruto->'celdas', '[]'::jsonb)) cell
  where cell->>'columna' = p_column
  order by cell->>'columna'
  limit 1
$$;

create or replace function public.historical_json_cell_url(
  p_bruto jsonb,
  p_column text
)
returns text
language sql
immutable
parallel safe
set search_path = public
as $$
  select nullif(btrim(cell->>'hipervinculo'), '')
  from jsonb_array_elements(coalesce(p_bruto->'celdas', '[]'::jsonb)) cell
  where cell->>'columna' = p_column
  order by cell->>'columna'
  limit 1
$$;

-- Solo elimina el .0 que proviene de un numero entero de Excel. Los demas
-- codigos siguen siendo lexicos y no se convierten a numeric.
create or replace function public.historical_code_key(p_value text)
returns text
language sql
immutable
parallel safe
set search_path = public
as $$
  select case
    when btrim(coalesce(p_value, '')) ~ '^[0-9]+[.]0$'
      then split_part(btrim(p_value), '.', 1)
    else nullif(lower(btrim(p_value)), '')
  end
$$;

alter table public.importacion_registros
  add column if not exists destino_tipo text;

create index if not exists importacion_registros_destino_tipo_idx
  on public.importacion_registros (importacion_id, destino_tipo)
  where destino_tipo is not null;

alter table public.territory_map_versions
  add column if not exists snapshot_at timestamptz;
alter table public.territory_map_versions
  add column if not exists effective_date_status text not null default 'unknown';
alter table public.territory_map_versions
  drop constraint if exists territory_map_versions_effective_date_status_check;
alter table public.territory_map_versions
  add constraint territory_map_versions_effective_date_status_check
  check (effective_date_status in ('confirmed', 'inferred', 'unknown'));

create unique index if not exists importacion_aplicaciones_running_unique_idx
  on public.importacion_aplicaciones (importacion_id, applicator_version)
  where status = 'running';

create unique index if not exists territory_unit_versions_source_record_unique_idx
  on public.territory_unit_versions (source_record_id)
  where source_record_id is not null;

-- ---------------------------------------------------------------------
-- 2. Puntos canonicos historicos: URL es la clave, no el texto visible
-- ---------------------------------------------------------------------

create table if not exists public.historical_point_entities (
  id uuid primary key,
  canonical_key text not null unique,
  maps_url text not null,
  canonical_name text,
  source_names jsonb not null default '[]'::jsonb,
  source_neighborhoods jsonb not null default '[]'::jsonb,
  source_importation_id uuid not null references public.importaciones (id) on delete restrict,
  created_at timestamptz not null default now()
);

create table if not exists public.historical_point_sources (
  id uuid primary key,
  historical_point_id uuid not null references public.historical_point_entities (id) on delete restrict,
  source_record_id uuid not null unique references public.importacion_registros (id) on delete restrict,
  source_importation_id uuid not null references public.importaciones (id) on delete restrict,
  source_code_text text,
  source_name text,
  source_neighborhood text,
  source_label text,
  maps_url text not null,
  source_detail jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  unique (historical_point_id, source_record_id)
);

create index if not exists historical_point_sources_point_idx
  on public.historical_point_sources (historical_point_id);
create index if not exists historical_point_sources_run_idx
  on public.historical_point_sources (source_importation_id);

-- ---------------------------------------------------------------------
-- 3. Territorios fuente: candidatos separados por source_record_id
-- ---------------------------------------------------------------------

create table if not exists public.historical_territory_candidates (
  id uuid primary key,
  source_record_id uuid not null unique references public.importacion_registros (id) on delete restrict,
  source_importation_id uuid not null references public.importaciones (id) on delete restrict,
  source_code_text text not null check (btrim(source_code_text) <> ''),
  source_name text,
  source_neighborhood text,
  source_label text,
  maps_url text,
  candidate_status text not null
    check (candidate_status in ('source_candidate', 'ambiguous', 'special_code')),
  map_version_id uuid references public.territory_map_versions (id) on delete restrict,
  territory_entity_id uuid references public.territory_entities (id) on delete restrict,
  territory_unit_version_id uuid references public.territory_unit_versions (id) on delete restrict,
  source_detail jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  constraint historical_territory_candidate_ambiguity_check check (
    candidate_status <> 'ambiguous' or territory_unit_version_id is null
  )
);

create index if not exists historical_territory_candidates_run_idx
  on public.historical_territory_candidates (source_importation_id);
create index if not exists historical_territory_candidates_code_idx
  on public.historical_territory_candidates (source_importation_id, (lower(source_code_text)));

-- ---------------------------------------------------------------------
-- 4. Grupos y personales como fotografia historica, no estado operativo
-- ---------------------------------------------------------------------

create table if not exists public.historical_group_entities (
  id uuid primary key,
  source_record_id uuid not null unique references public.importacion_registros (id) on delete restrict,
  source_importation_id uuid not null references public.importaciones (id) on delete restrict,
  group_name text not null,
  group_number integer,
  supervisor_name text,
  auxiliary_name text,
  source_territory_codes jsonb not null default '[]'::jsonb,
  resolution_status text not null
    check (resolution_status in ('source_snapshot', 'sin_evidencia')),
  source_detail jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create table if not exists public.historical_group_territory_sources (
  id uuid primary key,
  historical_group_id uuid not null references public.historical_group_entities (id) on delete restrict,
  source_record_id uuid not null references public.importacion_registros (id) on delete restrict,
  source_code_text text not null,
  position integer not null check (position >= 0),
  map_version_id uuid references public.territory_map_versions (id) on delete restrict,
  territory_unit_version_id uuid references public.territory_unit_versions (id) on delete restrict,
  resolution_status text not null
    check (resolution_status in ('source_snapshot', 'unresolved', 'sin_evidencia')),
  source_detail jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  unique (historical_group_id, position)
);

create index if not exists historical_group_territory_sources_run_idx
  on public.historical_group_territory_sources (source_record_id);

create table if not exists public.historical_personal_assignments (
  id uuid primary key,
  source_record_id uuid not null unique references public.importacion_registros (id) on delete restrict,
  source_importation_id uuid not null references public.importaciones (id) on delete restrict,
  person_name text not null,
  source_code_text text,
  source_status text,
  active_source boolean,
  periods jsonb not null default '[]'::jsonb,
  map_version_id uuid references public.territory_map_versions (id) on delete restrict,
  territory_unit_version_id uuid references public.territory_unit_versions (id) on delete restrict,
  resolution_status text not null
    check (resolution_status in ('source_snapshot', 'sin_evidencia')),
  source_detail jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists historical_personal_assignments_run_idx
  on public.historical_personal_assignments (source_importation_id);

-- ---------------------------------------------------------------------
-- 5. Cierres auditables sin evidencia
-- ---------------------------------------------------------------------

create table if not exists public.historical_resolution_closures (
  id uuid primary key,
  source_record_id uuid not null unique references public.importacion_registros (id) on delete restrict,
  source_importation_id uuid not null references public.importaciones (id) on delete restrict,
  application_id uuid not null references public.importacion_aplicaciones (id) on delete restrict,
  source_type text not null,
  reason_code text not null check (
    reason_code in (
      'formula_error', 'date_uncertain', 'date_only',
      'boolean_narrative_contradiction', 'duplicate_source_code',
      'source_status_confirmation', 'partial_date', 'unattached_comment'
    )
  ),
  resolution_status text not null default 'sin_evidencia'
    check (resolution_status = 'sin_evidencia'),
  source_sheet text not null,
  source_row integer not null,
  source_range text,
  original_reason text,
  raw_snapshot jsonb not null,
  normalized_snapshot jsonb,
  closed_at timestamptz not null default now(),
  closed_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now()
);

create index if not exists historical_resolution_closures_run_idx
  on public.historical_resolution_closures (source_importation_id, reason_code);

-- ---------------------------------------------------------------------
-- 6. RLS de solo lectura para administradores
-- ---------------------------------------------------------------------

alter table public.historical_point_entities enable row level security;
alter table public.historical_point_sources enable row level security;
alter table public.historical_territory_candidates enable row level security;
alter table public.historical_group_entities enable row level security;
alter table public.historical_group_territory_sources enable row level security;
alter table public.historical_personal_assignments enable row level security;
alter table public.historical_resolution_closures enable row level security;

drop policy if exists "Admins leen puntos historicos" on public.historical_point_entities;
create policy "Admins leen puntos historicos"
on public.historical_point_entities for select to authenticated
using (public.is_admin(auth.uid()));

drop policy if exists "Admins leen fuentes de puntos historicos" on public.historical_point_sources;
create policy "Admins leen fuentes de puntos historicos"
on public.historical_point_sources for select to authenticated
using (public.is_admin(auth.uid()));

drop policy if exists "Admins leen candidatos territoriales historicos" on public.historical_territory_candidates;
create policy "Admins leen candidatos territoriales historicos"
on public.historical_territory_candidates for select to authenticated
using (public.is_admin(auth.uid()));

drop policy if exists "Admins leen grupos historicos" on public.historical_group_entities;
create policy "Admins leen grupos historicos"
on public.historical_group_entities for select to authenticated
using (public.is_admin(auth.uid()));

drop policy if exists "Admins leen referencias de grupos historicos" on public.historical_group_territory_sources;
create policy "Admins leen referencias de grupos historicos"
on public.historical_group_territory_sources for select to authenticated
using (public.is_admin(auth.uid()));

drop policy if exists "Admins leen personales historicos" on public.historical_personal_assignments;
create policy "Admins leen personales historicos"
on public.historical_personal_assignments for select to authenticated
using (public.is_admin(auth.uid()));

drop policy if exists "Admins leen cierres historicos" on public.historical_resolution_closures;
create policy "Admins leen cierres historicos"
on public.historical_resolution_closures for select to authenticated
using (public.is_admin(auth.uid()));

grant select on public.historical_point_entities to authenticated;
grant select on public.historical_point_sources to authenticated;
grant select on public.historical_territory_candidates to authenticated;
grant select on public.historical_group_entities to authenticated;
grant select on public.historical_group_territory_sources to authenticated;
grant select on public.historical_personal_assignments to authenticated;
grant select on public.historical_resolution_closures to authenticated;

-- ---------------------------------------------------------------------
-- 7. Aplicacion transaccional e idempotente de la segunda etapa
-- ---------------------------------------------------------------------

create or replace function public.apply_historical_second_stage(
  p_importation_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_source_sha256 text;
  v_parser_version text;
  v_corrida_at timestamptz;
  v_snapshot_at timestamptz;
  v_snapshot_date date;
  v_total integer;
  v_remaining integer;
  v_deterministic integer;
  v_closure integer;
  v_points_sources integer;
  v_points_canonical integer;
  v_territory_sources integer;
  v_territory_units integer;
  v_group_rows integer;
  v_group_refs integer;
  v_personal_rows integer;
  v_applied integer;
  v_discarded integer;
  v_pending integer;
  v_conflicts integer;
  v_without_destination integer;
  v_map_version_id uuid;
  v_application_id uuid;
  v_counts jsonb;
  v_error text;
  v_completed jsonb;
begin
  if p_importation_id is null then
    raise exception 'La importacion es obligatoria';
  end if;

  select source_sha256, parser_version, corrida_at,
         coalesce(source_modified_at, corrida_at)
    into v_source_sha256, v_parser_version, v_corrida_at, v_snapshot_at
  from public.importaciones
  where id = p_importation_id
  for update;

  if not found then
    raise exception 'No existe la importacion indicada';
  end if;

  if v_source_sha256 is distinct from
      '1559266196bcba5360ddbc71d3e33bc22e61c11f12d90daa809952a170e132e2'
     or v_parser_version is distinct from '2.0.0-temporal' then
    raise exception 'La importacion no coincide con el Excel/parser auditados';
  end if;

  select counts into v_completed
  from public.importacion_aplicaciones
  where importacion_id = p_importation_id
    and applicator_version = '2.0.0-historical-second-stage'
    and status = 'completed'
  order by finished_at desc nulls last, id desc
  limit 1;

  if v_completed is not null then
    return jsonb_build_object(
      'status', 'already_completed',
      'applicator_version', '2.0.0-historical-second-stage',
      'counts', v_completed
    );
  end if;

  if exists (
    select 1
    from public.importacion_aplicaciones
    where importacion_id = p_importation_id
      and applicator_version = '2.0.0-historical-second-stage'
      and status = 'running'
  ) then
    raise exception 'Ya hay una segunda etapa en ejecucion para esta importacion';
  end if;

  insert into public.importacion_aplicaciones (
    importacion_id, source_sha256, parser_version, applicator_version,
    status, counts, started_at
  ) values (
    p_importation_id, v_source_sha256, v_parser_version,
    '2.0.0-historical-second-stage', 'running', '{}'::jsonb, now()
  )
  returning id into v_application_id;

  begin
    v_snapshot_date := v_snapshot_at::date;

    select count(*) into v_total
    from public.importacion_registros
    where importacion_id = p_importation_id;
    if v_total <> 3346 then
      raise exception 'Staging inesperado: % registros, se esperaban 3346', v_total;
    end if;

    select count(*) into v_remaining
    from public.importacion_registros
    where importacion_id = p_importation_id
      and estado in ('pendiente', 'conflicto');
    if v_remaining <> 471 then
      raise exception 'Remanente inesperado: % filas, se esperaban 471', v_remaining;
    end if;

    -- Es una fotografia de origen, no una version publicada. valid_from es
    -- solo el ancla tecnica requerida por el esquema; effective_date_status
    -- impide usarla para resolver hechos historicos.
    v_map_version_id := public.historical_source_uuid(
      'territory_map_snapshot', p_importation_id::text
    );
    insert into public.territory_map_versions (
      id, label, status, valid_from, source, source_importation_id,
      notes, snapshot_at, effective_date_status
    ) values (
      v_map_version_id,
      'Snapshot fuente Excel ' || p_importation_id::text,
      'draft',
      v_snapshot_date,
      'excel_source_snapshot',
      p_importation_id,
      'Fotografia de codigos del Excel. No es una vigencia territorial publicada y no se usa para resolver salidas por fecha.',
      v_snapshot_at,
      'unknown'
    )
    on conflict (id) do nothing;

    -- Todos los 200 territorios quedan preservados como candidatos fuente.
    -- Los dos 68.5 se mantienen separados y marcados ambiguos.
    with source_rows as (
      select
        r.id,
        coalesce(nullif(r.normalizado->>'codigo_bruto', ''),
                 public.historical_json_cell_text(r.bruto, 'B')) as code_text,
        coalesce(nullif(r.normalizado->>'punto_encuentro_bruto', ''),
                 public.historical_json_cell_text(r.bruto, 'C')) as source_name,
        coalesce(nullif(r.normalizado->>'barrio_bruto', ''),
                 public.historical_json_cell_text(r.bruto, 'D')) as source_neighborhood,
        coalesce(nullif(r.normalizado->>'ubicacion_etiqueta', ''),
                 public.historical_json_cell_text(r.bruto, 'E')) as source_label,
        public.historical_json_cell_url(r.bruto, 'E') as maps_url,
        r.bruto,
        r.pestania,
        r.fila,
        r.rango
      from public.importacion_registros r
      where r.importacion_id = p_importation_id
        and r.tipo = 'territorio'
    ), ranked as (
      select source_rows.*,
             count(*) over (
               partition by public.historical_code_key(source_rows.code_text)
             ) as code_count
      from source_rows
      where source_rows.code_text is not null
    )
    insert into public.historical_territory_candidates (
      id, source_record_id, source_importation_id, source_code_text,
      source_name, source_neighborhood, source_label, maps_url,
      candidate_status, map_version_id, source_detail
    )
    select
      public.historical_source_uuid('territory_candidate', id::text),
      id,
      p_importation_id,
      code_text,
      source_name,
      source_neighborhood,
      source_label,
      maps_url,
      case
        when upper(btrim(code_text)) = 'TEL' then 'special_code'
        when code_count > 1 then 'ambiguous'
        else 'source_candidate'
      end,
      v_map_version_id,
      jsonb_build_object(
        'pestania', pestania,
        'fila', fila,
        'rango', rango,
        'source_name', source_name,
        'source_neighborhood', source_neighborhood,
        'source_label', source_label,
        'maps_url', maps_url
      )
    from ranked
    on conflict (source_record_id) do nothing;

    insert into public.territory_entities (id, kind, notes)
    select
      public.historical_source_uuid('territory_entity', c.source_record_id::text),
      case
        when upper(btrim(c.source_code_text)) = 'TEL' then 'telefonica'
        when upper(btrim(c.source_code_text)) in ('AC', 'AR') then 'asamblea'
        when upper(btrim(c.source_code_text)) in ('ZO', 'VC', 'SR', 'SS', 'SG') then 'especial'
        else 'territorial'
      end,
      'Identidad candidata derivada de una fila de Territorios del Excel; no es identidad actual.'
    from public.historical_territory_candidates c
    where c.source_importation_id = p_importation_id
    on conflict (id) do nothing;

    update public.historical_territory_candidates c
    set territory_entity_id = public.historical_source_uuid(
      'territory_entity', c.source_record_id::text
    )
    where c.source_importation_id = p_importation_id;

    -- Solo los codigos unicos de la fotografia reciben una unidad propuesta.
    -- No se publica ni se enlaza legacy_territory_id.
    insert into public.territory_unit_versions (
      id, entity_id, map_version_id, code_text, display_name,
      description, sector, kind, geometry_geojson, geometry_status,
      parent_unit_version_id, legacy_territory_id, status,
      source_importation_id, source_record_id
    )
    select
      public.historical_source_uuid('territory_unit_version', c.source_record_id::text),
      c.territory_entity_id,
      v_map_version_id,
      c.source_code_text,
      coalesce(c.source_name, c.source_code_text),
      c.source_label,
      c.source_neighborhood,
      case
        when upper(btrim(c.source_code_text)) = 'TEL' then 'telefonica'
        when upper(btrim(c.source_code_text)) in ('AC', 'AR') then 'asamblea'
        when upper(btrim(c.source_code_text)) in ('ZO', 'VC', 'SR', 'SS', 'SG') then 'especial'
        else 'territorial'
      end,
      null,
      'unknown',
      null,
      null,
      'proposed',
      p_importation_id,
      c.source_record_id
    from public.historical_territory_candidates c
    where c.source_importation_id = p_importation_id
      and c.candidate_status <> 'ambiguous'
    on conflict (id) do nothing;

    update public.historical_territory_candidates c
    set territory_unit_version_id = public.historical_source_uuid(
      'territory_unit_version', c.source_record_id::text
    )
    where c.source_importation_id = p_importation_id
      and c.candidate_status <> 'ambiguous';

    -- Puntos: 191 filas fuente, 145 entidades por URL canonica.
    with point_rows as (
      select
        r.id,
        lower(btrim(coalesce(nullif(r.normalizado->>'url', ''),
                              public.historical_json_cell_url(r.bruto, 'E')))) as canonical_key,
        btrim(coalesce(nullif(r.normalizado->>'url', ''),
                       public.historical_json_cell_url(r.bruto, 'E'))) as maps_url,
        public.historical_json_cell_text(r.bruto, 'C') as source_name,
        public.historical_json_cell_text(r.bruto, 'D') as source_neighborhood,
        coalesce(nullif(r.normalizado->>'etiqueta', ''),
                 public.historical_json_cell_text(r.bruto, 'E')) as source_label
      from public.importacion_registros r
      where r.importacion_id = p_importation_id
        and r.tipo = 'punto_encuentro'
    )
    insert into public.historical_point_entities (
      id, canonical_key, maps_url, canonical_name,
      source_names, source_neighborhoods, source_importation_id
    )
    select
      public.historical_source_uuid('historical_point', canonical_key),
      canonical_key,
      min(maps_url),
      min(nullif(source_name, '')),
      coalesce(
        jsonb_agg(to_jsonb(source_name) order by source_name)
          filter (where source_name is not null),
        '[]'::jsonb
      ),
      coalesce(
        jsonb_agg(to_jsonb(source_neighborhood) order by source_neighborhood)
          filter (where source_neighborhood is not null),
        '[]'::jsonb
      ),
      p_importation_id
    from point_rows
    where canonical_key is not null and maps_url is not null
    group by canonical_key
    on conflict (canonical_key) do nothing;

    with point_rows as (
      select
        r.id,
        r.bruto,
        r.pestania,
        r.fila,
        r.rango,
        coalesce(nullif(r.normalizado->>'url', ''),
                 public.historical_json_cell_url(r.bruto, 'E')) as maps_url,
        public.historical_json_cell_text(r.bruto, 'C') as source_name,
        public.historical_json_cell_text(r.bruto, 'D') as source_neighborhood,
        coalesce(nullif(r.normalizado->>'etiqueta', ''),
                 public.historical_json_cell_text(r.bruto, 'E')) as source_label,
        r.normalizado->>'territorio_bruto' as source_code_text
      from public.importacion_registros r
      where r.importacion_id = p_importation_id
        and r.tipo = 'punto_encuentro'
    )
    insert into public.historical_point_sources (
      id, historical_point_id, source_record_id, source_importation_id,
      source_code_text, source_name, source_neighborhood, source_label,
      maps_url, source_detail
    )
    select
      public.historical_source_uuid('historical_point_source', p.id::text),
      e.id,
      p.id,
      p_importation_id,
      p.source_code_text,
      p.source_name,
      p.source_neighborhood,
      p.source_label,
      btrim(p.maps_url),
      jsonb_build_object(
        'pestania', p.pestania,
        'fila', p.fila,
        'rango', p.rango,
        'source_name', p.source_name,
        'source_neighborhood', p.source_neighborhood,
        'source_label', p.source_label,
        'maps_url', p.maps_url
      )
    from point_rows p
    join public.historical_point_entities e
      on e.canonical_key = lower(btrim(p.maps_url))
    where p.maps_url is not null
    on conflict (source_record_id) do nothing;

    -- Grupos: se conserva supervisor y auxiliar en una estructura que el
    -- modelo operativo actual no puede representar en dos roles.
    insert into public.historical_group_entities (
      id, source_record_id, source_importation_id, group_name, group_number,
      supervisor_name, auxiliary_name, source_territory_codes,
      resolution_status, source_detail
    )
    select
      public.historical_source_uuid('historical_group', r.id::text),
      r.id,
      p_importation_id,
      coalesce(nullif(r.normalizado->>'nombre', ''),
               public.historical_json_cell_text(r.bruto, 'A')),
      substring(
        coalesce(nullif(r.normalizado->>'nombre', ''),
                 public.historical_json_cell_text(r.bruto, 'A'))
        from '([0-9]+)'
      )::integer,
      coalesce(nullif(r.normalizado->>'supervisor', ''),
               public.historical_json_cell_text(r.bruto, 'B')),
      coalesce(nullif(r.normalizado->>'auxiliar', ''),
               public.historical_json_cell_text(r.bruto, 'C')),
      coalesce(r.normalizado->'territorios_solicitados', '[]'::jsonb),
      'source_snapshot',
      jsonb_build_object(
        'pestania', r.pestania,
        'fila', r.fila,
        'rango', r.rango,
        'bruto', r.bruto
      )
    from public.importacion_registros r
    where r.importacion_id = p_importation_id
      and r.tipo = 'grupo'
    on conflict (source_record_id) do nothing;

    with group_rows as (
      select
        g.id as historical_group_id,
        g.source_record_id,
        values.code_text,
        (values.ordinality - 1)::integer as position
      from public.historical_group_entities g
      join public.importacion_registros r on r.id = g.source_record_id
      cross join lateral jsonb_array_elements_text(
        coalesce(r.normalizado->'territorios_solicitados', '[]'::jsonb)
      ) with ordinality as values(code_text, ordinality)
      where g.source_importation_id = p_importation_id
    )
    insert into public.historical_group_territory_sources (
      id, historical_group_id, source_record_id, source_code_text, position,
      map_version_id, territory_unit_version_id, resolution_status, source_detail
    )
    select
      public.historical_source_uuid(
        'historical_group_territory', group_rows.source_record_id::text || ':' || group_rows.position::text
      ),
      group_rows.historical_group_id,
      group_rows.source_record_id,
      group_rows.code_text,
      group_rows.position,
      c.map_version_id,
      c.territory_unit_version_id,
      case when c.territory_unit_version_id is not null
        then 'source_snapshot' else 'unresolved' end,
      jsonb_build_object('source_code_text', group_rows.code_text)
    from group_rows
    left join public.historical_territory_candidates c
      on c.source_importation_id = p_importation_id
     and public.historical_code_key(c.source_code_text) =
         public.historical_code_key(group_rows.code_text)
     and c.candidate_status <> 'ambiguous'
    on conflict (historical_group_id, position) do nothing;

    -- Personales: se guardan los nueve estados fuente y todos los periodos,
    -- incluido "Agosto?". Nunca se escribe territorio_personal_reservas.
    with personal_rows as (
      select
        r.*,
        coalesce(nullif(r.normalizado->>'persona', ''),
                 public.historical_json_cell_text(r.bruto, 'A')) as person_name,
        coalesce(nullif(r.normalizado->>'territorio_bruto', ''),
                 public.historical_json_cell_text(r.bruto, 'B')) as source_code_text,
        coalesce(nullif(r.normalizado->>'activo_bruto', ''),
                 public.historical_json_cell_text(r.bruto, 'D')) as source_status,
        coalesce(
          r.normalizado->'periodos',
          coalesce(
            (
              select jsonb_agg(cell->'valor' order by cell->>'columna')
                filter (where cell->>'valor' is not null)
              from jsonb_array_elements(coalesce(r.bruto->'celdas', '[]'::jsonb)) cell
              where cell->>'columna' in ('F', 'G', 'H', 'I', 'J', 'K')
            ),
            '[]'::jsonb
          )
        ) as periods
      from public.importacion_registros r
      where r.importacion_id = p_importation_id
        and r.tipo = 'territorio_personal'
    )
    insert into public.historical_personal_assignments (
      id, source_record_id, source_importation_id, person_name,
      source_code_text, source_status, active_source, periods,
      map_version_id, territory_unit_version_id, resolution_status, source_detail
    )
    select
      public.historical_source_uuid('historical_personal', p.id::text),
      p.id,
      p_importation_id,
      p.person_name,
      p.source_code_text,
      p.source_status,
      case
        when public.historical_code_key(lower(p.source_status)) in ('si', 'sí') then true
        when public.historical_code_key(lower(p.source_status)) = 'no' then false
        else null
      end,
      p.periods,
      c.map_version_id,
      c.territory_unit_version_id,
      case when p.estado = 'conflicto' then 'sin_evidencia'
           else 'source_snapshot' end,
      jsonb_build_object(
        'pestania', p.pestania,
        'fila', p.fila,
        'rango', p.rango,
        'bruto', p.bruto,
        'normalizado', p.normalizado
      )
    from personal_rows p
    left join public.historical_territory_candidates c
      on p.estado <> 'conflicto'
     and c.source_importation_id = p_importation_id
     and public.historical_code_key(c.source_code_text) =
         public.historical_code_key(p.source_code_text)
     and c.candidate_status <> 'ambiguous'
    on conflict (source_record_id) do nothing;

    -- Cierres: 64 salidas + 2 territorios ambiguos + 3 Confirmar + historia
    -- parcial + comentario suelto = 71. El bruto nunca se pierde.
    with closure_rows as (
      select
        r.id,
        r.tipo,
        case
          when r.tipo = 'salida'
            and r.normalizado->>'fecha' is not null
            and nullif(r.normalizado->>'hora', '') is null then 'date_only'
          when r.tipo = 'salida' and coalesce(r.motivo, '') ilike '%fórmula%' then 'formula_error'
          when r.tipo = 'salida' and coalesce(r.motivo, '') ilike '%narrativa%' then 'boolean_narrative_contradiction'
          when r.tipo = 'salida' and coalesce(r.motivo, '') ilike '%fecha%' then 'date_uncertain'
          when r.tipo = 'territorio' then 'duplicate_source_code'
          when r.tipo = 'territorio_personal' then 'source_status_confirmation'
          when r.tipo = 'historial_territorio' then 'partial_date'
          when r.tipo = 'otro' then 'unattached_comment'
          else 'date_uncertain'
        end as reason_code,
        r.pestania,
        r.fila,
        r.rango,
        r.motivo,
        r.bruto,
        r.normalizado
      from public.importacion_registros r
      where r.importacion_id = p_importation_id
        and (
          (
            r.tipo = 'salida'
            and (
              r.estado = 'conflicto'
              or (
                r.normalizado->>'fecha' is not null
                and nullif(r.normalizado->>'hora', '') is null
              )
            )
          )
          or (
            r.tipo = 'territorio'
            and r.estado = 'conflicto'
            and coalesce(r.motivo, '') ilike '%código de territorio duplicado%'
          )
          or (
            r.tipo = 'territorio_personal'
            and r.estado = 'conflicto'
            and coalesce(r.motivo, '') ilike '%requiere confirmación%'
          )
          or (r.tipo = 'historial_territorio' and r.estado = 'conflicto')
          or (r.tipo = 'otro' and r.estado = 'conflicto')
        )
    )
    insert into public.historical_resolution_closures (
      id, source_record_id, source_importation_id, application_id,
      source_type, reason_code, source_sheet, source_row, source_range,
      original_reason, raw_snapshot, normalized_snapshot
    )
    select
      public.historical_source_uuid('historical_closure', id::text),
      id,
      p_importation_id,
      v_application_id,
      tipo,
      reason_code,
      pestania,
      fila,
      rango,
      motivo,
      bruto,
      normalizado
    from closure_rows
    on conflict (source_record_id) do nothing;

    select count(*) into v_deterministic
    from public.importacion_registros r
    where r.importacion_id = p_importation_id
      and r.estado in ('pendiente', 'conflicto')
      and (
        r.tipo = 'punto_encuentro'
        or (r.tipo = 'territorio' and not (
          coalesce(r.motivo, '') ilike '%código de territorio duplicado%'
        ))
        or r.tipo = 'grupo'
        or (r.tipo = 'territorio_personal' and not (
          coalesce(r.motivo, '') ilike '%requiere confirmación%'
        ))
      );
    if v_deterministic <> 400 then
      raise exception 'Deterministas inesperados: %, se esperaban 400', v_deterministic;
    end if;

    select count(*) into v_closure
    from public.historical_resolution_closures
    where source_importation_id = p_importation_id
      and resolution_status = 'sin_evidencia';
    if v_closure <> 71 then
      raise exception 'Cierres sin evidencia inesperados: %, se esperaban 71', v_closure;
    end if;

    -- Repara la referencia generica de las 2.875 filas ya aplicadas si una
    -- corrida anterior dejo destino_id vacio, sin tocar el destino.
    update public.importacion_registros r
    set destino_id = s.alias_id,
        destino_tipo = 'conductor_alias'
    from public.conductor_alias_sources s
    where r.id = s.source_record_id
      and r.importacion_id = p_importation_id
      and r.estado = 'aplicado'
      and r.destino_id is null;

    update public.importacion_registros r
    set destino_id = h.id,
        destino_tipo = 'territorio_historial'
    from public.territorio_historial h
    where r.id = h.registro_id
      and r.importacion_id = p_importation_id
      and r.estado = 'aplicado'
      and r.destino_id is null;

    update public.importacion_registros r
    set destino_id = s.id,
        destino_tipo = 'salida'
    from public.salidas s
    where r.id = s.registro_id
      and r.importacion_id = p_importation_id
      and r.estado = 'aplicado'
      and r.destino_id is null;

    -- 191 puntos.
    update public.importacion_registros r
    set estado = 'aplicado',
        resolution_status = 'resolved',
        quality_status = 'warning',
        destino_tabla = 'historical_point_sources',
        destino_tipo = 'historical_point_source',
        destino_id = p.id,
        revisado_at = now()
    from public.historical_point_sources p
    where r.id = p.source_record_id
      and r.importacion_id = p_importation_id
      and r.estado in ('pendiente', 'conflicto');

    -- 198 candidatos de territorio: 197 codigos pendientes y TEL como
    -- codigo especial. Los dos 68.5 quedan solo como candidatos ambiguos y
    -- se cierran abajo.
    update public.importacion_registros r
    set estado = 'aplicado',
        resolution_status = 'resolved',
        quality_status = 'warning',
        destino_tabla = 'historical_territory_candidates',
        destino_tipo = 'historical_territory_candidate',
        destino_id = c.id,
        revisado_at = now()
    from public.historical_territory_candidates c
    where r.id = c.source_record_id
      and r.importacion_id = p_importation_id
      and c.candidate_status <> 'ambiguous'
      and r.estado in ('pendiente', 'conflicto');

    update public.importacion_registros r
    set estado = 'aplicado',
        resolution_status = 'resolved',
        quality_status = 'warning',
        destino_tabla = 'historical_group_entities',
        destino_tipo = 'historical_group',
        destino_id = g.id,
        revisado_at = now()
    from public.historical_group_entities g
    where r.id = g.source_record_id
      and r.importacion_id = p_importation_id
      and r.estado in ('pendiente', 'conflicto');

    -- Solo los seis estados personales no conflictivos son candidatos. Los
    -- nueve registros de la fuente igual quedan en historical_personal_assignments.
    update public.importacion_registros r
    set estado = 'aplicado',
        resolution_status = 'resolved',
        quality_status = 'warning',
        destino_tabla = 'historical_personal_assignments',
        destino_tipo = 'historical_personal',
        destino_id = p.id,
        revisado_at = now()
    from public.historical_personal_assignments p
    where r.id = p.source_record_id
      and r.importacion_id = p_importation_id
      and p.resolution_status = 'source_snapshot'
      and r.estado in ('pendiente', 'conflicto');

    -- Los 71 cierres salen del flujo operativo, pero siguen siendo filas de
    -- staging auditables y con su bruto completo.
    update public.importacion_registros r
    set estado = 'descartado',
        resolution_status = 'waived',
        quality_status = 'blocked',
        destino_tabla = 'historical_resolution_closures',
        destino_tipo = 'historical_closure',
        destino_id = c.id,
        revisado_at = now()
    from public.historical_resolution_closures c
    where r.id = c.source_record_id
      and r.importacion_id = p_importation_id
      and c.resolution_status = 'sin_evidencia';

    -- La fuente anterior tambien debe conservar destino verificable.
    select count(*) into v_without_destination
    from public.importacion_registros
    where importacion_id = p_importation_id
      and destino_id is null;
    if v_without_destination <> 0 then
      raise exception 'Quedaron % filas sin destino historico o cierre', v_without_destination;
    end if;

    select count(*) into v_pending
    from public.importacion_registros
    where importacion_id = p_importation_id and estado = 'pendiente';
    select count(*) into v_conflicts
    from public.importacion_registros
    where importacion_id = p_importation_id and estado = 'conflicto';
    if v_pending <> 0 or v_conflicts <> 0 then
      raise exception 'La reconciliacion no cerro: pendientes %, conflictos %', v_pending, v_conflicts;
    end if;

    select count(*) into v_applied
    from public.importacion_registros
    where importacion_id = p_importation_id and estado = 'aplicado';
    select count(*) into v_discarded
    from public.importacion_registros
    where importacion_id = p_importation_id and estado = 'descartado';

    select count(*) into v_points_sources
    from public.historical_point_sources
    where source_importation_id = p_importation_id;
    select count(distinct historical_point_id) into v_points_canonical
    from public.historical_point_sources
    where source_importation_id = p_importation_id;
    select count(*) into v_territory_sources
    from public.historical_territory_candidates
    where source_importation_id = p_importation_id;
    select count(*) into v_territory_units
    from public.historical_territory_candidates
    where source_importation_id = p_importation_id
      and territory_unit_version_id is not null;
    select count(*) into v_group_rows
    from public.historical_group_entities
    where source_importation_id = p_importation_id;
    select count(*) into v_group_refs
    from public.historical_group_territory_sources g
    join public.historical_group_entities e on e.id = g.historical_group_id
    where e.source_importation_id = p_importation_id;
    select count(*) into v_personal_rows
    from public.historical_personal_assignments
    where source_importation_id = p_importation_id;

    if v_applied <> 3275 or v_discarded <> 71
       or v_points_sources <> 191 or v_points_canonical <> 145
       or v_territory_sources <> 200 or v_territory_units <> 198
       or v_group_rows <> 5 or v_group_refs <> 10
       or v_personal_rows <> 9 then
      raise exception
        'Conteos finales inesperados: applied %, discarded %, points %/% territories %/% groups %/% personal %',
        v_applied, v_discarded, v_points_sources, v_points_canonical,
        v_territory_sources, v_territory_units, v_group_rows, v_group_refs,
        v_personal_rows;
    end if;

    update public.importaciones
    set estado = 'aplicada'
    where id = p_importation_id;

    v_counts := jsonb_build_object(
      'staging_total', v_total,
      'deterministic_records', 400,
      'sin_evidencia', v_closure,
      'staging_aplicado', v_applied,
      'staging_descartado', v_discarded,
      'pending', v_pending,
      'conflicts', v_conflicts,
      'points_source_rows', v_points_sources,
      'points_canonical', v_points_canonical,
      'territory_source_rows', v_territory_sources,
      'territory_unit_candidates', v_territory_units,
      'group_rows', v_group_rows,
      'group_territory_refs', v_group_refs,
      'personal_rows', v_personal_rows,
      'map_version_id', v_map_version_id
    );

    update public.importacion_aplicaciones
    set status = 'completed',
        counts = v_counts,
        finished_at = now()
    where id = v_application_id;

    return jsonb_build_object(
      'status', 'completed',
      'application_id', v_application_id,
      'applicator_version', '2.0.0-historical-second-stage',
      'counts', v_counts
    );
  exception when others then
    get stacked diagnostics v_error = message_text;
    update public.importacion_aplicaciones
    set status = 'failed',
        error_message = left(v_error, 1000),
        finished_at = now()
    where id = v_application_id;
    return jsonb_build_object(
      'status', 'failed',
      'application_id', v_application_id,
      'error', v_error
    );
  end;
end;
$$;

revoke all on function public.apply_historical_second_stage(uuid)
  from public, anon, authenticated;
grant execute on function public.apply_historical_second_stage(uuid)
  to service_role;

-- ---------------------------------------------------------------------
-- 8. Validacion de conteos sin traer 3.346 filas al cliente
-- ---------------------------------------------------------------------

create or replace function public.validate_historical_second_stage(
  p_importation_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_total integer;
  v_applied integer;
  v_discarded integer;
  v_pending integer;
  v_conflicts integer;
  v_without_destination integer;
  v_points_sources integer;
  v_points_canonical integer;
  v_territory_sources integer;
  v_territory_units integer;
  v_group_rows integer;
  v_group_refs integer;
  v_personal_rows integer;
  v_closures integer;
  v_ok boolean;
begin
  select count(*) into v_total from public.importacion_registros where importacion_id = p_importation_id;
  select count(*) into v_applied from public.importacion_registros where importacion_id = p_importation_id and estado = 'aplicado';
  select count(*) into v_discarded from public.importacion_registros where importacion_id = p_importation_id and estado = 'descartado';
  select count(*) into v_pending from public.importacion_registros where importacion_id = p_importation_id and estado = 'pendiente';
  select count(*) into v_conflicts from public.importacion_registros where importacion_id = p_importation_id and estado = 'conflicto';
  select count(*) into v_without_destination from public.importacion_registros where importacion_id = p_importation_id and destino_id is null;
  select count(*) into v_points_sources from public.historical_point_sources where source_importation_id = p_importation_id;
  select count(distinct historical_point_id) into v_points_canonical from public.historical_point_sources where source_importation_id = p_importation_id;
  select count(*) into v_territory_sources from public.historical_territory_candidates where source_importation_id = p_importation_id;
  select count(*) into v_territory_units from public.historical_territory_candidates where source_importation_id = p_importation_id and territory_unit_version_id is not null;
  select count(*) into v_group_rows from public.historical_group_entities where source_importation_id = p_importation_id;
  select count(*) into v_group_refs
  from public.historical_group_territory_sources g
  join public.historical_group_entities e on e.id = g.historical_group_id
  where e.source_importation_id = p_importation_id;
  select count(*) into v_personal_rows from public.historical_personal_assignments where source_importation_id = p_importation_id;
  select count(*) into v_closures from public.historical_resolution_closures where source_importation_id = p_importation_id and resolution_status = 'sin_evidencia';

  v_ok := v_total = 3346
    and v_applied = 3275
    and v_discarded = 71
    and v_pending = 0
    and v_conflicts = 0
    and v_without_destination = 0
    and v_points_sources = 191
    and v_points_canonical = 145
    and v_territory_sources = 200
    and v_territory_units = 198
    and v_group_rows = 5
    and v_group_refs = 10
    and v_personal_rows = 9
    and v_closures = 71;

  return jsonb_build_object(
    'ok', v_ok,
    'staging_total', v_total,
    'staging_aplicado', v_applied,
    'staging_descartado', v_discarded,
    'pending', v_pending,
    'conflicts', v_conflicts,
    'without_destination', v_without_destination,
    'points_source_rows', v_points_sources,
    'points_canonical', v_points_canonical,
    'territory_source_rows', v_territory_sources,
    'territory_unit_candidates', v_territory_units,
    'group_rows', v_group_rows,
    'group_territory_refs', v_group_refs,
    'personal_rows', v_personal_rows,
    'sin_evidencia', v_closures
  );
end;
$$;

revoke all on function public.validate_historical_second_stage(uuid)
  from public, anon, authenticated;
grant execute on function public.validate_historical_second_stage(uuid)
  to service_role;

commit;
