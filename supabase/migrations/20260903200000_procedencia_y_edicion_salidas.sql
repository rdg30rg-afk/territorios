-- =====================================================================
-- Procedencia estructurada y edicion progresiva de salidas historicas
--
-- Esta migracion es aditiva. El texto fuente que estaba en salidas.notes se
-- conserva byte a byte en source_notes_raw y su objeto parseado queda en
-- source_payload. notes queda libre para observaciones humanas.
--
-- El backfill esta cerrado a la corrida auditada de DEV:
--   hash     1559266196bcba5360ddbc71d3e33bc22e61c11f12d90daa809952a170e132e2
--   parser   2.0.0-temporal
--   salidas  1.790
--
-- No asigna conductor_id, territorio_id, group_id ni meeting_point_id.
-- Esos valores se completan despues, de forma explicita y progresiva.
-- =====================================================================

begin;

-- ---------------------------------------------------------------------
-- 1. Fuente estructurada: una fila por salida importada
-- ---------------------------------------------------------------------

create table if not exists public.salida_importacion_procedencia (
  id uuid primary key,
  salida_id uuid not null unique
    references public.salidas (id) on delete restrict,
  importacion_id uuid not null
    references public.importaciones (id) on delete restrict,
  registro_id uuid not null unique
    references public.importacion_registros (id) on delete restrict,
  application_id uuid not null
    references public.importacion_aplicaciones (id) on delete restrict,
  source_sha256 text not null
    check (source_sha256 ~ '^[0-9a-f]{64}$'),
  parser_version text not null,
  source_sheet text not null,
  source_row integer not null,
  source_range text,
  -- Es el valor exacto que antes vivia en salidas.notes.
  source_notes_raw text not null,
  -- Es el mismo valor parseado, para consultar sin volver a interpretar
  -- texto en cada pantalla.
  source_payload jsonb not null
    check (jsonb_typeof(source_payload) = 'object'),
  source_conductor_text text,
  source_conductor_alias_id uuid
    references public.conductor_alias (id) on delete restrict,
  source_priorizar text,
  source_narrative jsonb not null default '{}'::jsonb
    check (jsonb_typeof(source_narrative) = 'object'),
  source_status boolean,
  source_resolution_status text,
  migrated_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);

comment on table public.salida_importacion_procedencia is
  'Procedencia inmutable de cada salida importada: texto crudo, JSON y campos extraidos.';
comment on column public.salida_importacion_procedencia.source_notes_raw is
  'Copia exacta del texto que estaba en salidas.notes antes del backfill.';
comment on column public.salida_importacion_procedencia.source_payload is
  'JSON original parseado; no reemplaza al texto crudo.';
comment on column public.salida_importacion_procedencia.source_conductor_text is
  'Texto del Excel, incluso si es -; no implica que el conductor haya sido identificado.';
comment on column public.salida_importacion_procedencia.source_conductor_alias_id is
  'Alias existente resuelto por lower(trim(alias)); no asigna conductor_id.';

create index if not exists salida_importacion_procedencia_importacion_idx
  on public.salida_importacion_procedencia (importacion_id, source_row);
create index if not exists salida_importacion_procedencia_alias_idx
  on public.salida_importacion_procedencia (source_conductor_alias_id)
  where source_conductor_alias_id is not null;

-- ---------------------------------------------------------------------
-- 2. Bitacora append-only de ediciones operativas
-- ---------------------------------------------------------------------

create table if not exists public.salida_ediciones (
  id uuid primary key default gen_random_uuid(),
  salida_id uuid not null
    references public.salidas (id) on delete restrict,
  registro_id uuid
    references public.importacion_registros (id) on delete restrict,
  edited_by uuid
    references public.profiles (id) on delete set null,
  edited_at timestamptz not null default now(),
  changed_fields jsonb not null
    check (jsonb_typeof(changed_fields) = 'array'),
  before_snapshot jsonb not null
    check (jsonb_typeof(before_snapshot) = 'object'),
  after_snapshot jsonb not null
    check (jsonb_typeof(after_snapshot) = 'object')
);

comment on table public.salida_ediciones is
  'Bitacora inmutable de cambios operativos de salidas historicas.';
create index if not exists salida_ediciones_salida_idx
  on public.salida_ediciones (salida_id, edited_at desc);
create index if not exists salida_ediciones_registro_idx
  on public.salida_ediciones (registro_id, edited_at desc)
  where registro_id is not null;

-- ---------------------------------------------------------------------
-- 3. Permisos: se lee, no se escribe desde la aplicacion
-- ---------------------------------------------------------------------

alter table public.salida_importacion_procedencia enable row level security;
alter table public.salida_ediciones enable row level security;

drop policy if exists "Leer procedencia de salidas" on public.salida_importacion_procedencia;
create policy "Leer procedencia de salidas"
on public.salida_importacion_procedencia
for select to authenticated
using (
  public.is_admin(auth.uid())
  or public.can_access_module('salidas')
  or public.can_access_module('salidas_grupo')
);

drop policy if exists "Leer ediciones de salidas" on public.salida_ediciones;
create policy "Leer ediciones de salidas"
on public.salida_ediciones
for select to authenticated
using (
  public.is_admin(auth.uid())
  or public.can_access_module('salidas')
  or public.can_access_module('salidas_grupo')
);

revoke all on public.salida_importacion_procedencia from anon, authenticated;
grant select on public.salida_importacion_procedencia to authenticated;
revoke all on public.salida_ediciones from anon, authenticated;
grant select on public.salida_ediciones to authenticated;

-- Ni un admin de la interfaz puede borrar o corregir una fuente o una
-- edicion. Una nueva correccion siempre es otra fila de la bitacora.
create or replace function public.protect_salida_source_history_mutation()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  raise exception 'La procedencia y la bitacora de una salida son inmutables';
end;
$$;

drop trigger if exists salida_importacion_procedencia_immutable
  on public.salida_importacion_procedencia;
create trigger salida_importacion_procedencia_immutable
before update or delete on public.salida_importacion_procedencia
for each row execute function public.protect_salida_source_history_mutation();

drop trigger if exists salida_ediciones_immutable on public.salida_ediciones;
create trigger salida_ediciones_immutable
before update or delete on public.salida_ediciones
for each row execute function public.protect_salida_source_history_mutation();

-- ---------------------------------------------------------------------
-- 4. Linaje de la salida: fecha, tipo y origen no se reinterpretan
-- ---------------------------------------------------------------------

create or replace function public.protect_imported_outing_lineage()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if (old.origen = 'excel' or old.registro_id is not null)
     and (
       new.origen is distinct from old.origen
       or new.registro_id is distinct from old.registro_id
       or new.tipo is distinct from old.tipo
       or new.scheduled_for is distinct from old.scheduled_for
       or new.created_at is distinct from old.created_at
     ) then
    raise exception
      'La fecha, el tipo y la procedencia de una salida importada son inmutables';
  end if;
  return new;
end;
$$;

drop trigger if exists salidas_protect_imported_lineage on public.salidas;
create trigger salidas_protect_imported_lineage
before update on public.salidas
for each row execute function public.protect_imported_outing_lineage();

-- ---------------------------------------------------------------------
-- 5. Snapshot de edicion, con escape para el backfill de notes
-- ---------------------------------------------------------------------

create or replace function public.salida_operational_snapshot(p_salida public.salidas)
returns jsonb
language sql
stable
set search_path = public
as $$
  select jsonb_build_object(
    'title', p_salida.title,
    'territory_id', p_salida.territory_id,
    'driver_id', p_salida.driver_id,
    'group_id', p_salida.group_id,
    'meeting_point_id', p_salida.meeting_point_id,
    'meeting_point_name', p_salida.meeting_point_name,
    'meeting_point_lat', p_salida.meeting_point_lat,
    'meeting_point_lng', p_salida.meeting_point_lng,
    'scheduled_for', p_salida.scheduled_for,
    'notes', p_salida.notes
  );
$$;

create or replace function public.audit_imported_outing_update()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  before_data jsonb;
  after_data jsonb;
  changed_data jsonb;
begin
  if not (old.origen = 'excel' or old.registro_id is not null) then
    return new;
  end if;

  -- El backfill cambia solamente notes despues de guardar la fuente exacta.
  -- No es una edicion humana y no debe llenar la bitacora operativa.
  if coalesce(current_setting('app.salida_provenance_backfill', true), 'off') = 'on' then
    return new;
  end if;

  before_data := public.salida_operational_snapshot(old);
  after_data := public.salida_operational_snapshot(new);

  select coalesce(jsonb_agg(before_item.key order by before_item.key), '[]'::jsonb)
    into changed_data
  from jsonb_each(before_data) before_item
  join jsonb_each(after_data) after_item using (key)
  where before_item.value is distinct from after_item.value;

  if jsonb_array_length(changed_data) = 0 then
    return new;
  end if;

  insert into public.salida_ediciones (
    salida_id, registro_id, edited_by, changed_fields,
    before_snapshot, after_snapshot
  ) values (
    new.id,
    new.registro_id,
    auth.uid(),
    changed_data,
    before_data,
    after_data
  );

  return new;
end;
$$;

drop trigger if exists salidas_audit_imported_update on public.salidas;
create trigger salidas_audit_imported_update
after update on public.salidas
for each row execute function public.audit_imported_outing_update();

-- ---------------------------------------------------------------------
-- 6. Parseo seguro utilizado por el preflight y la RPC
-- ---------------------------------------------------------------------

create or replace function public.historical_notes_jsonb(p_notes text)
returns jsonb
language plpgsql
immutable
set search_path = public
as $$
declare
  parsed jsonb;
begin
  if p_notes is null or btrim(p_notes) = '' then
    return null;
  end if;

  begin
    parsed := p_notes::jsonb;
  exception when others then
    return null;
  end;

  if jsonb_typeof(parsed) <> 'object' then
    return null;
  end if;
  return parsed;
end;
$$;

-- ---------------------------------------------------------------------
-- 7. Preflight exhaustivo: no muta ninguna tabla
-- ---------------------------------------------------------------------

create or replace function public.preflight_salida_importacion_procedencia(
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
  v_metadata_ok boolean;
  v_source_record_rows integer := 0;
  v_source_records integer := 0;
  v_source_salidas integer := 0;
  v_missing_salidas integer := 0;
  v_provenance_rows integer := 0;
  v_provenance_missing integer := 0;
  v_provenance_extra integer := 0;
  v_json_rows integer := 0;
  v_invalid_json integer := 0;
  v_missing_required integer := 0;
  v_alias_nonempty integer := 0;
  v_alias_empty integer := 0;
  v_alias_distinct integer := 0;
  v_alias_unmatched integer := 0;
  v_alias_ambiguous integer := 0;
  v_alias_mismatches integer := 0;
  v_provenance_mismatches integer := 0;
  v_legacy_json_in_notes integer := 0;
  v_notes_without_provenance integer := 0;
  v_application_completed integer := 0;
  v_ok boolean;
begin
  select i.source_sha256, i.parser_version
    into v_source_sha256, v_parser_version
  from public.importaciones i
  where i.id = p_importation_id;

  v_metadata_ok := v_source_sha256 =
      '1559266196bcba5360ddbc71d3e33bc22e61c11f12d90daa809952a170e132e2'
    and v_parser_version = '2.0.0-temporal';

  select count(*) into v_source_record_rows
  from public.importacion_registros r
  where r.importacion_id = p_importation_id and r.tipo = 'salida';

  -- 1.790 filas tienen salida materializada. Las 64 restantes son los
  -- conflictos ya cerrados en historical_resolution_closures y no deben
  -- forzarse dentro de la tabla operativa.
  select count(*) into v_source_records
  from public.importacion_registros r
  where r.importacion_id = p_importation_id
    and r.tipo = 'salida'
    and exists (
      select 1 from public.salidas s
      where s.registro_id = r.id and s.origen = 'excel'
    );

  select count(*) into v_source_salidas
  from public.importacion_registros r
  join public.salidas s on s.registro_id = r.id
  where r.importacion_id = p_importation_id
    and r.tipo = 'salida'
    and s.origen = 'excel';

  select count(*) into v_missing_salidas
  from public.importacion_registros r
  where r.importacion_id = p_importation_id
    and r.tipo = 'salida'
    and not exists (
      select 1 from public.salidas s where s.registro_id = r.id
    );

  select count(*) into v_provenance_rows
  from public.salida_importacion_procedencia p
  where p.importacion_id = p_importation_id;

  select count(*) into v_provenance_missing
  from public.salidas s
  join public.importacion_registros r on r.id = s.registro_id
  left join public.salida_importacion_procedencia p on p.salida_id = s.id
  where r.importacion_id = p_importation_id
    and r.tipo = 'salida'
    and s.origen = 'excel'
    and p.id is null;

  select count(*) into v_provenance_extra
  from public.salida_importacion_procedencia p
  where p.importacion_id = p_importation_id
    and not exists (
      select 1
      from public.salidas s
      join public.importacion_registros r on r.id = s.registro_id
      where s.id = p.salida_id
        and r.id = p.registro_id
        and r.importacion_id = p_importation_id
        and r.tipo = 'salida'
        and s.origen = 'excel'
    );

  -- Cuando aun no existe la procedencia, el payload se lee del legado. Una
  -- vez hecho el backfill, se lee de la tabla nueva y notes puede ser texto
  -- humano o NULL.
  with source_rows as (
    select
      s.id as salida_id,
      s.notes,
      public.historical_notes_jsonb(s.notes) as legacy_payload,
      p.id as provenance_id,
      p.source_payload as stored_payload
    from public.salidas s
    join public.importacion_registros r on r.id = s.registro_id
    left join public.salida_importacion_procedencia p on p.salida_id = s.id
    where r.importacion_id = p_importation_id
      and r.tipo = 'salida'
      and s.origen = 'excel'
  ), effective_rows as (
    select *, coalesce(legacy_payload, stored_payload) as payload
    from source_rows
  )
  select
    count(*) filter (where provenance_id is null and legacy_payload is not null),
    count(*) filter (
      where provenance_id is null
        and notes is not null
        and legacy_payload is null
    ),
    count(*) filter (
      where payload is not null and (
        not (payload ? 'conductor_alias')
        or not (payload ? 'priorizar')
        or not (payload ? 'narrativa')
        or not (payload ? 'estado_fuente')
        or not (payload ? 'estado_resolucion')
        or jsonb_typeof(payload->'conductor_alias') not in ('string', 'null')
        or jsonb_typeof(payload->'priorizar') not in ('string', 'null')
        or jsonb_typeof(payload->'narrativa') <> 'object'
        or jsonb_typeof(payload->'estado_fuente') not in ('boolean', 'null')
        or jsonb_typeof(payload->'estado_resolucion') not in ('string', 'null')
      )
    )
  into v_json_rows, v_invalid_json, v_missing_required
  from effective_rows;

  -- JSON valido que aun esta en notes. Al terminar debe ser cero.
  select count(*) into v_legacy_json_in_notes
  from public.salidas s
  join public.importacion_registros r on r.id = s.registro_id
  where r.importacion_id = p_importation_id
    and r.tipo = 'salida'
    and s.origen = 'excel'
    and public.historical_notes_jsonb(s.notes) is not null
    and public.historical_notes_jsonb(s.notes) ? 'conductor_alias'
    and public.historical_notes_jsonb(s.notes) ? 'priorizar'
    and public.historical_notes_jsonb(s.notes) ? 'narrativa'
    and public.historical_notes_jsonb(s.notes) ? 'estado_fuente'
    and public.historical_notes_jsonb(s.notes) ? 'estado_resolucion';

  select count(*) into v_notes_without_provenance
  from public.salidas s
  join public.importacion_registros r on r.id = s.registro_id
  left join public.salida_importacion_procedencia p on p.salida_id = s.id
  where r.importacion_id = p_importation_id
    and r.tipo = 'salida'
    and s.origen = 'excel'
    and s.notes is null
    and p.id is null;

  with source_rows as (
    select coalesce(
      public.historical_notes_jsonb(s.notes), p.source_payload
    ) as payload
    from public.salidas s
    join public.importacion_registros r on r.id = s.registro_id
    left join public.salida_importacion_procedencia p on p.salida_id = s.id
    where r.importacion_id = p_importation_id
      and r.tipo = 'salida'
      and s.origen = 'excel'
  ), alias_rows as (
    select
      payload->>'conductor_alias' as source_alias,
      alias_match.alias_id,
      alias_match.match_count
    from source_rows
    left join lateral (
      select
        (array_agg(a.id order by a.id))[1] as alias_id,
        count(*)::integer as match_count
      from public.conductor_alias a
      where lower(btrim(a.alias)) = lower(btrim(source_rows.payload->>'conductor_alias'))
    ) alias_match on true
  )
  select
    count(*) filter (
      where nullif(btrim(source_alias), '') is not null
        and btrim(source_alias) <> '-'
    ),
    count(*) filter (
      where nullif(btrim(source_alias), '') is null
        or btrim(source_alias) = '-'
    ),
    count(distinct lower(btrim(source_alias))) filter (
      where nullif(btrim(source_alias), '') is not null
        and btrim(source_alias) <> '-'
    ),
    count(*) filter (
      where nullif(btrim(source_alias), '') is not null
        and btrim(source_alias) <> '-'
        and match_count = 0
    ),
    count(*) filter (
      where nullif(btrim(source_alias), '') is not null
        and btrim(source_alias) <> '-'
        and match_count > 1
    )
  into
    v_alias_nonempty, v_alias_empty, v_alias_distinct,
    v_alias_unmatched, v_alias_ambiguous
  from alias_rows;

  -- La procedencia almacenada debe seguir describiendo la fuente y la
  -- coincidencia de alias debe ser exacta, sin fold de acentos ni fuzzy match.
  select count(*) into v_alias_mismatches
  from public.salida_importacion_procedencia p
  join public.salidas s on s.id = p.salida_id
  join public.importacion_registros r on r.id = p.registro_id
  cross join lateral (
    select coalesce(
      public.historical_notes_jsonb(s.notes), p.source_payload
    ) as payload
  ) source_data
  left join lateral (
    select
      (array_agg(a.id order by a.id))[1] as alias_id,
      count(*)::integer as match_count
    from public.conductor_alias a
    where lower(btrim(a.alias)) = lower(btrim(source_data.payload->>'conductor_alias'))
  ) alias_match on true
  where p.importacion_id = p_importation_id
    and r.importacion_id = p_importation_id
    and (
      p.source_conductor_text is distinct from source_data.payload->>'conductor_alias'
      or p.source_priorizar is distinct from source_data.payload->>'priorizar'
      or p.source_narrative is distinct from source_data.payload->'narrativa'
      or p.source_status is distinct from case
        when jsonb_typeof(source_data.payload->'estado_fuente') = 'boolean'
          then (source_data.payload->>'estado_fuente')::boolean
        else null
      end
      or p.source_resolution_status is distinct from source_data.payload->>'estado_resolucion'
      or p.source_conductor_alias_id is distinct from case
        when nullif(btrim(source_data.payload->>'conductor_alias'), '') is null
          or btrim(source_data.payload->>'conductor_alias') = '-'
          then null
        when alias_match.match_count = 1 then alias_match.alias_id
        else null
      end
    );

  -- source_notes_raw se compara con la columna actual solo mientras notes
  -- siga conteniendo el legado. Despues del backfill el raw almacenado es la
  -- autoridad y notes puede ser NULL o una observacion humana.
  select count(*) into v_provenance_mismatches
  from public.salida_importacion_procedencia p
  join public.salidas s on s.id = p.salida_id
  join public.importacion_registros r on r.id = p.registro_id
  where p.importacion_id = p_importation_id
    and r.importacion_id = p_importation_id
    and (
      p.source_notes_raw is null
      or public.historical_notes_jsonb(p.source_notes_raw) is distinct from p.source_payload
      or p.source_sheet is distinct from r.pestania
      or p.source_row is distinct from r.fila
      or p.source_range is distinct from r.rango
      or (s.notes is not null and p.source_notes_raw is distinct from s.notes)
    );

  select count(*) into v_application_completed
  from public.importacion_aplicaciones a
  where a.importacion_id = p_importation_id
    and a.applicator_version = '2.1.0-salida-procedencia'
    and a.status = 'completed';

  v_ok := v_metadata_ok
    and v_source_record_rows = 1854
    and v_source_records = 1790
    and v_source_salidas = 1790
    and v_missing_salidas = 64
    and v_provenance_extra = 0
    and v_invalid_json = 0
    and v_missing_required = 0
    and v_alias_unmatched = 0
    and v_alias_ambiguous = 0
    and v_alias_mismatches = 0
    and v_provenance_mismatches = 0
    and v_notes_without_provenance = 0
    and (
      (
        v_provenance_rows = 0
        and v_provenance_missing = 1790
        and v_json_rows = 1790
        and v_legacy_json_in_notes = 1790
        and v_application_completed = 0
      )
      or (
        v_provenance_rows = 1790
        and v_provenance_missing = 0
        and v_json_rows = 0
        and v_legacy_json_in_notes = 0
        and v_application_completed = 1
      )
    );

  return jsonb_build_object(
    'ok', coalesce(v_ok, false),
    'metadata_ok', coalesce(v_metadata_ok, false),
    'source_sha256', v_source_sha256,
    'parser_version', v_parser_version,
    'expected_source_rows', 1790,
    'source_record_rows', v_source_record_rows,
    'source_records', v_source_records,
    'source_salidas', v_source_salidas,
    'missing_salidas', v_missing_salidas,
    'provenance_rows', v_provenance_rows,
    'provenance_missing', v_provenance_missing,
    'provenance_extra', v_provenance_extra,
    'legacy_json_rows', v_json_rows,
    'invalid_json', v_invalid_json,
    'missing_required_fields', v_missing_required,
    'alias_nonempty_rows', v_alias_nonempty,
    'alias_empty_rows', v_alias_empty,
    'alias_distinct_source_texts', v_alias_distinct,
    'alias_unmatched_rows', v_alias_unmatched,
    'alias_ambiguous_rows', v_alias_ambiguous,
    'alias_mismatches', v_alias_mismatches,
    'provenance_mismatches', v_provenance_mismatches,
    'legacy_json_in_notes', v_legacy_json_in_notes,
    'notes_without_provenance', v_notes_without_provenance,
    'application_completed', v_application_completed,
    'already_backfilled', (
      v_provenance_rows = 1790
      and v_legacy_json_in_notes = 0
      and v_application_completed = 1
    )
  );
end;
$$;

revoke all on function public.preflight_salida_importacion_procedencia(uuid)
  from public, anon, authenticated;
grant execute on function public.preflight_salida_importacion_procedencia(uuid)
  to service_role;

-- ---------------------------------------------------------------------
-- 8. Backfill transaccional e idempotente
-- ---------------------------------------------------------------------

create or replace function public.backfill_salida_importacion_procedencia(
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
  v_preflight jsonb;
  v_application_id uuid;
  v_completed_application_id uuid;
  v_inserted integer := 0;
  v_cleared integer := 0;
  v_counts jsonb;
  v_error text;
begin
  -- Serializa dos invocaciones simultaneas para la misma corrida.
  select i.source_sha256, i.parser_version
    into v_source_sha256, v_parser_version
  from public.importaciones i
  where i.id = p_importation_id
  for update;

  if v_source_sha256 is null then
    raise exception 'La corrida indicada no existe en DEV';
  end if;
  if v_source_sha256 is distinct from
       '1559266196bcba5360ddbc71d3e33bc22e61c11f12d90daa809952a170e132e2'
     or v_parser_version is distinct from '2.0.0-temporal' then
    raise exception 'La corrida no coincide con la fuente historica auditada';
  end if;

  select a.id into v_completed_application_id
  from public.importacion_aplicaciones a
  where a.importacion_id = p_importation_id
    and a.applicator_version = '2.1.0-salida-procedencia'
    and a.status = 'completed'
  order by a.finished_at desc, a.id desc
  limit 1;

  if v_completed_application_id is not null then
    return jsonb_build_object(
      'status', 'already_completed',
      'application_id', v_completed_application_id,
      'applicator_version', '2.1.0-salida-procedencia',
      'preflight', public.preflight_salida_importacion_procedencia(p_importation_id)
    );
  end if;

  if exists (
    select 1 from public.importacion_aplicaciones a
    where a.importacion_id = p_importation_id
      and a.applicator_version = '2.1.0-salida-procedencia'
      and a.status = 'running'
  ) then
    raise exception 'Ya hay un backfill de procedencia en curso para esta corrida';
  end if;

  v_preflight := public.preflight_salida_importacion_procedencia(p_importation_id);
  if coalesce((v_preflight->>'ok')::boolean, false) is not true then
    raise exception 'Preflight de procedencia rechazado: %', v_preflight::text;
  end if;

  insert into public.importacion_aplicaciones (
    importacion_id, source_sha256, parser_version, applicator_version,
    status, counts, created_by
  ) values (
    p_importation_id,
    v_source_sha256,
    v_parser_version,
    '2.1.0-salida-procedencia',
    'running',
    v_preflight,
    auth.uid()
  ) returning id into v_application_id;

  begin
    perform set_config('app.salida_provenance_backfill', 'on', true);

    -- Bloquea las filas de origen y de destino antes de materializar. La
    -- unicidad por registro_id/salida_id evita duplicados incluso si una
    -- corrida se reintenta despues de una respuesta perdida.
    perform 1
    from public.salidas s
    join public.importacion_registros r on r.id = s.registro_id
    where r.importacion_id = p_importation_id
      and r.tipo = 'salida'
      and s.origen = 'excel'
    for update;

    insert into public.salida_importacion_procedencia (
      id, salida_id, importacion_id, registro_id, application_id,
      source_sha256, parser_version, source_sheet, source_row, source_range,
      source_notes_raw, source_payload, source_conductor_text,
      source_conductor_alias_id, source_priorizar, source_narrative,
      source_status, source_resolution_status
    )
    select
      public.historical_source_uuid('salida_importacion_procedencia', s.id::text),
      s.id,
      p_importation_id,
      r.id,
      v_application_id,
      v_source_sha256,
      v_parser_version,
      r.pestania,
      r.fila,
      r.rango,
      s.notes,
      payload.data,
      payload.data->>'conductor_alias',
      case
        when nullif(btrim(payload.data->>'conductor_alias'), '') is null
          or btrim(payload.data->>'conductor_alias') = '-'
          then null
        when alias_match.match_count = 1 then alias_match.alias_id
        else null
      end,
      payload.data->>'priorizar',
      payload.data->'narrativa',
      (payload.data->>'estado_fuente')::boolean,
      payload.data->>'estado_resolucion'
    from public.salidas s
    join public.importacion_registros r on r.id = s.registro_id
    cross join lateral (
      select public.historical_notes_jsonb(s.notes) as data
    ) payload
    left join lateral (
      select
        (array_agg(a.id order by a.id))[1] as alias_id,
        count(*)::integer as match_count
      from public.conductor_alias a
      where lower(btrim(a.alias)) = lower(btrim(payload.data->>'conductor_alias'))
    ) alias_match on true
    where r.importacion_id = p_importation_id
      and r.tipo = 'salida'
      and s.origen = 'excel';

    get diagnostics v_inserted = row_count;
    if v_inserted <> 1790 then
      raise exception 'Se esperaban 1.790 procedencias y se insertaron %', v_inserted;
    end if;

    update public.salidas s
    set notes = null
    from public.salida_importacion_procedencia p
    where p.application_id = v_application_id
      and p.salida_id = s.id
      and s.notes is not null
      and s.notes = p.source_notes_raw;

    get diagnostics v_cleared = row_count;
    if v_cleared <> 1790 then
      raise exception 'Se esperaban 1.790 notes legados y se limpiaron %', v_cleared;
    end if;

    select count(*) into v_inserted
    from public.salida_importacion_procedencia p
    where p.application_id = v_application_id;
    if v_inserted <> 1790 then
      raise exception 'La reconciliacion de procedencia devolvio % filas', v_inserted;
    end if;

    v_counts := v_preflight || jsonb_build_object(
      'provenance_rows_inserted', v_inserted,
      'legacy_notes_cleared', v_cleared,
      'legacy_json_in_notes_after', 0,
      'alias_nonempty_rows', 1781,
      'alias_empty_rows', 9
    );

    update public.importacion_aplicaciones
    set status = 'completed', counts = v_counts, finished_at = now()
    where id = v_application_id;

    return jsonb_build_object(
      'status', 'completed',
      'application_id', v_application_id,
      'applicator_version', '2.1.0-salida-procedencia',
      'counts', v_counts
    );
  exception when others then
    get stacked diagnostics v_error = message_text;
    update public.importacion_aplicaciones
    set status = 'failed', error_message = left(v_error, 1000), finished_at = now()
    where id = v_application_id;
    return jsonb_build_object(
      'status', 'failed',
      'application_id', v_application_id,
      'applicator_version', '2.1.0-salida-procedencia',
      'error', v_error
    );
  end;
end;
$$;

revoke all on function public.backfill_salida_importacion_procedencia(uuid)
  from public, anon, authenticated;
grant execute on function public.backfill_salida_importacion_procedencia(uuid)
  to service_role;

-- ---------------------------------------------------------------------
-- 9. Validacion final para el cliente DEV
-- ---------------------------------------------------------------------

create or replace function public.validate_salida_importacion_procedencia(
  p_importation_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  result jsonb;
  completed_count integer;
  application_id uuid;
begin
  result := public.preflight_salida_importacion_procedencia(p_importation_id);
  select count(*) into completed_count
  from public.importacion_aplicaciones a
  where a.importacion_id = p_importation_id
    and a.applicator_version = '2.1.0-salida-procedencia'
    and a.status = 'completed';

  select a.id into application_id
  from public.importacion_aplicaciones a
  where a.importacion_id = p_importation_id
    and a.applicator_version = '2.1.0-salida-procedencia'
    and a.status = 'completed'
  order by a.finished_at desc, a.id desc
  limit 1;

  return result || jsonb_build_object(
    'application_completed', completed_count,
    'application_id', application_id,
    'ok', coalesce((result->>'ok')::boolean, false) and completed_count = 1
  );
end;
$$;

revoke all on function public.validate_salida_importacion_procedencia(uuid)
  from public, anon, authenticated;
grant execute on function public.validate_salida_importacion_procedencia(uuid)
  to service_role;

comment on column public.salidas.notes is
  'Observaciones humanas. La procedencia de importaciones vive en salida_importacion_procedencia.';

commit;
