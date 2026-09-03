-- =====================================================================
-- Versiones y linaje territorial
--
-- Un numero (10, 11, 68.5) es una etiqueta dentro de un mapa, no una
-- identidad eterna. Esta migracion es compatible con la aplicacion actual:
-- no reemplaza `territorios`; agrega el modelo temporal al que se migraran
-- gradualmente salidas, historial, grupos y cobertura.
--
-- APLICAR PRIMERO Y UNICAMENTE EN DEV: rkmioktcsgqqjshrlkmy.
-- No contiene carga del Excel ni publica una version automaticamente.
-- =====================================================================

begin;

-- ---------------------------------------------------------------------
-- 1. Una version coherente del mapa completo
-- ---------------------------------------------------------------------

create table if not exists territory_map_versions (
  id uuid primary key default gen_random_uuid(),
  label text not null,
  status text not null default 'draft'
    check (status in ('draft', 'published', 'retired')),
  valid_from date not null,
  valid_to date,
  source text,
  source_importation_id uuid references importaciones (id) on delete restrict,
  notes text,
  published_at timestamptz,
  published_by uuid references profiles (id) on delete set null,
  created_by uuid references profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  constraint territory_map_versions_valid_interval
    check (valid_to is null or valid_to > valid_from),
  constraint territory_map_versions_publication_fields
    check (
      status <> 'published'
      or (published_at is not null and published_by is not null)
    )
);

create unique index if not exists territory_map_versions_label_unique_idx
  on territory_map_versions (lower(label));

create or replace function public.prevent_published_map_overlap()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if new.status = 'published' and exists (
    select 1
    from territory_map_versions other
    where other.id <> new.id
      and other.status = 'published'
      and daterange(other.valid_from, other.valid_to, '[)')
          && daterange(new.valid_from, new.valid_to, '[)')
  ) then
    raise exception 'La vigencia de la version territorial se superpone con otra publicada';
  end if;
  return new;
end;
$$;

drop trigger if exists territory_map_versions_no_overlap on territory_map_versions;
create trigger territory_map_versions_no_overlap
  before insert or update on territory_map_versions
  for each row execute function public.prevent_published_map_overlap();

-- ---------------------------------------------------------------------
-- 2. Identidad conceptual y su representacion en cada version
-- ---------------------------------------------------------------------

create table if not exists territory_entities (
  id uuid primary key default gen_random_uuid(),
  kind text not null default 'territorial'
    check (kind in ('territorial', 'telefonica', 'asamblea', 'especial', 'sin_salida')),
  retired_at timestamptz,
  notes text,
  created_by uuid references profiles (id) on delete set null,
  created_at timestamptz not null default now()
);

create table if not exists territory_unit_versions (
  id uuid primary key default gen_random_uuid(),
  entity_id uuid not null references territory_entities (id) on delete restrict,
  map_version_id uuid not null references territory_map_versions (id) on delete restrict,
  code_text text not null check (btrim(code_text) <> ''),
  display_name text,
  description text,
  sector text,
  kind text not null default 'territorial'
    check (kind in ('territorial', 'telefonica', 'asamblea', 'especial', 'sin_salida')),
  geometry_geojson jsonb,
  geometry_status text not null default 'unknown'
    check (geometry_status in ('known', 'approximate', 'unknown')),
  parent_unit_version_id uuid references territory_unit_versions (id) on delete restrict,
  legacy_territory_id uuid references territorios (id) on delete restrict,
  status text not null default 'active'
    check (status in ('active', 'inactive', 'proposed')),
  source_importation_id uuid references importaciones (id) on delete restrict,
  source_record_id uuid references importacion_registros (id) on delete restrict,
  created_by uuid references profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  constraint territory_unit_versions_parent_no_self
    check (parent_unit_version_id is null or parent_unit_version_id <> id),
  constraint territory_unit_versions_geometry_honest
    check (
      (geometry_status = 'unknown' and geometry_geojson is null)
      or (geometry_status in ('known', 'approximate') and geometry_geojson is not null)
    ),
  unique (entity_id, map_version_id)
);

create unique index if not exists territory_unit_versions_code_per_map_idx
  on territory_unit_versions (map_version_id, lower(code_text));
create index if not exists territory_unit_versions_legacy_idx
  on territory_unit_versions (legacy_territory_id)
  where legacy_territory_id is not null;

create or replace function public.protect_published_territory_units()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  protected_version_id uuid;
begin
  protected_version_id := case when tg_op = 'DELETE' then old.map_version_id else new.map_version_id end;
  if exists (
    select 1 from territory_map_versions
    where id = protected_version_id and status = 'published'
  ) then
    raise exception 'Una unidad de una version publicada es inmutable; cree otra version';
  end if;
  return case when tg_op = 'DELETE' then old else new end;
end;
$$;

drop trigger if exists territory_unit_versions_immutable_published on territory_unit_versions;
create trigger territory_unit_versions_immutable_published
  before update or delete on territory_unit_versions
  for each row execute function public.protect_published_territory_units();

-- ---------------------------------------------------------------------
-- 3. Cambios entre versiones: 1:1, 1:N y N:1
-- ---------------------------------------------------------------------

create table if not exists territory_change_sets (
  id uuid primary key default gen_random_uuid(),
  from_map_version_id uuid not null references territory_map_versions (id) on delete restrict,
  to_map_version_id uuid not null references territory_map_versions (id) on delete restrict,
  effective_on date not null,
  notes text,
  approved_by uuid references profiles (id) on delete set null,
  approved_at timestamptz,
  created_by uuid references profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  check (from_map_version_id <> to_map_version_id),
  unique (from_map_version_id, to_map_version_id)
);

create table if not exists territory_lineage (
  id uuid primary key default gen_random_uuid(),
  change_set_id uuid not null references territory_change_sets (id) on delete restrict,
  from_unit_version_id uuid not null references territory_unit_versions (id) on delete restrict,
  to_unit_version_id uuid not null references territory_unit_versions (id) on delete restrict,
  relation_type text not null
    check (relation_type in ('continuation', 'renumber', 'split', 'merge', 'boundary_change')),
  overlap_fraction numeric(7, 6)
    check (overlap_fraction is null or (overlap_fraction > 0 and overlap_fraction <= 1)),
  confidence text not null default 'unknown'
    check (confidence in ('confirmed', 'probable', 'unknown')),
  note text,
  approved_by uuid references profiles (id) on delete set null,
  approved_at timestamptz,
  created_at timestamptz not null default now(),
  check (from_unit_version_id <> to_unit_version_id),
  unique (change_set_id, from_unit_version_id, to_unit_version_id)
);

create index if not exists territory_lineage_from_idx
  on territory_lineage (from_unit_version_id);
create index if not exists territory_lineage_to_idx
  on territory_lineage (to_unit_version_id);

create or replace function public.validate_territory_lineage_versions()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  expected_from uuid;
  expected_to uuid;
  actual_from uuid;
  actual_to uuid;
begin
  select from_map_version_id, to_map_version_id
    into expected_from, expected_to
  from territory_change_sets where id = new.change_set_id;
  select map_version_id into actual_from
  from territory_unit_versions where id = new.from_unit_version_id;
  select map_version_id into actual_to
  from territory_unit_versions where id = new.to_unit_version_id;
  if actual_from <> expected_from or actual_to <> expected_to then
    raise exception 'El linaje debe conectar unidades de las versiones declaradas por el cambio';
  end if;
  return new;
end;
$$;

drop trigger if exists territory_lineage_versions_match on territory_lineage;
create trigger territory_lineage_versions_match
  before insert or update on territory_lineage
  for each row execute function public.validate_territory_lineage_versions();

-- ---------------------------------------------------------------------
-- 4. Hechos historicos y salidas conservan la referencia de su epoca
-- ---------------------------------------------------------------------

create table if not exists salida_territorios (
  id uuid primary key default gen_random_uuid(),
  salida_id uuid not null references salidas (id) on delete cascade,
  territory_unit_version_id uuid references territory_unit_versions (id) on delete restrict,
  source_map_version_id uuid references territory_map_versions (id) on delete restrict,
  source_code_text text,
  role text not null default 'primary'
    check (role in ('primary', 'secondary', 'reference')),
  position integer not null default 0 check (position >= 0),
  resolution_status text not null default 'unresolved'
    check (resolution_status in ('unresolved', 'resolved_exact', 'resolved_human', 'special_code', 'waived')),
  confidence text not null default 'unknown'
    check (confidence in ('confirmed', 'probable', 'unknown')),
  source_record_id uuid references importacion_registros (id) on delete restrict,
  resolved_by uuid references profiles (id) on delete set null,
  resolved_at timestamptz,
  note text,
  created_at timestamptz not null default now(),
  constraint salida_territorios_has_source
    check (territory_unit_version_id is not null or nullif(btrim(source_code_text), '') is not null),
  constraint salida_territorios_resolution_is_honest
    check (
      resolution_status not in ('resolved_exact', 'resolved_human')
      or territory_unit_version_id is not null
    ),
  unique (salida_id, role, position)
);

create index if not exists salida_territorios_unit_idx
  on salida_territorios (territory_unit_version_id);
create unique index if not exists salida_territorios_source_record_idx
  on salida_territorios (source_record_id, role, position)
  where source_record_id is not null;

alter table territorio_historial
  add column if not exists territory_unit_version_id uuid
    references territory_unit_versions (id) on delete restrict;
alter table territorio_historial
  add column if not exists source_map_version_id uuid
    references territory_map_versions (id) on delete restrict;
alter table territorio_historial add column if not exists source_code_text text;
alter table territorio_historial add column if not exists resolution_status text not null default 'unresolved'
  check (resolution_status in ('unresolved', 'resolved_exact', 'resolved_human', 'special_code', 'waived'));
alter table territorio_historial alter column territory_id drop not null;
alter table territorio_historial drop constraint if exists territorio_historial_territory_id_fkey;
alter table territorio_historial add constraint territorio_historial_territory_id_fkey
  foreign key (territory_id) references territorios (id) on delete restrict;
alter table territorio_historial drop constraint if exists territorio_historial_referencia_historica;
alter table territorio_historial add constraint territorio_historial_referencia_historica
  check (
    territory_unit_version_id is not null
    or territory_id is not null
    or nullif(btrim(source_code_text), '') is not null
  );
create index if not exists territorio_historial_unit_version_idx
  on territorio_historial (territory_unit_version_id, fecha desc nulls last);

create or replace function public.validate_historical_unit_map()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  actual_map_version_id uuid;
begin
  if new.territory_unit_version_id is null or new.source_map_version_id is null then
    return new;
  end if;
  select map_version_id into actual_map_version_id
  from territory_unit_versions
  where id = new.territory_unit_version_id;
  if actual_map_version_id is distinct from new.source_map_version_id then
    raise exception 'La unidad territorial no pertenece a la version declarada por el hecho';
  end if;
  return new;
end;
$$;

drop trigger if exists salida_territorios_unit_map_match on salida_territorios;
create trigger salida_territorios_unit_map_match
  before insert or update on salida_territorios
  for each row execute function public.validate_historical_unit_map();

drop trigger if exists territorio_historial_unit_map_match on territorio_historial;
create trigger territorio_historial_unit_map_match
  before insert or update on territorio_historial
  for each row execute function public.validate_historical_unit_map();

alter table grupo_territorio
  add column if not exists territory_unit_version_id uuid
    references territory_unit_versions (id) on delete restrict;
alter table grupo_territorio add column if not exists source_code_text text;
alter table grupo_territorio alter column territory_id drop not null;
alter table grupo_territorio drop constraint if exists grupo_territorio_territory_id_fkey;
alter table grupo_territorio add constraint grupo_territorio_territory_id_fkey
  foreign key (territory_id) references territorios (id) on delete restrict;
alter table grupo_territorio drop constraint if exists grupo_territorio_referencia;
alter table grupo_territorio add constraint grupo_territorio_referencia
  check (
    territory_unit_version_id is not null
    or territory_id is not null
    or nullif(btrim(source_code_text), '') is not null
  );
create unique index if not exists grupo_territorio_unit_vigente_unique_idx
  on grupo_territorio (group_id, territory_unit_version_id)
  where vigente_hasta is null and territory_unit_version_id is not null;

-- ---------------------------------------------------------------------
-- 5. Importacion reproducible e idempotente
-- ---------------------------------------------------------------------

alter table importaciones add column if not exists source_sha256 text;
alter table importaciones add column if not exists source_size_bytes bigint;
alter table importaciones add column if not exists parser_version text;
alter table importaciones add column if not exists source_modified_at timestamptz;
alter table importaciones add column if not exists supersedes_id uuid
  references importaciones (id) on delete restrict;
alter table importaciones drop constraint if exists importaciones_source_sha256_format;
alter table importaciones add constraint importaciones_source_sha256_format
  check (source_sha256 is null or source_sha256 ~ '^[0-9a-f]{64}$');
create unique index if not exists importaciones_source_revision_unique_idx
  on importaciones (source_sha256, parser_version)
  where source_sha256 is not null and parser_version is not null and estado <> 'revertida';

alter table importacion_registros add column if not exists source_key text;
alter table importacion_registros add column if not exists record_role text;
alter table importacion_registros add column if not exists resolution_status text not null default 'open'
  check (resolution_status in ('open', 'resolved', 'waived'));
alter table importacion_registros add column if not exists quality_status text not null default 'warning'
  check (quality_status in ('clean', 'warning', 'blocked'));
alter table importacion_registros drop constraint if exists importacion_registros_source_key_format;
alter table importacion_registros add constraint importacion_registros_source_key_format
  check (source_key is null or source_key ~ '^[0-9a-f]{64}$');
create unique index if not exists importacion_registros_source_key_unique_idx
  on importacion_registros (source_key) where source_key is not null;

create table if not exists importacion_decisiones (
  id uuid primary key default gen_random_uuid(),
  registro_id uuid not null references importacion_registros (id) on delete restrict,
  decision_type text not null
    check (decision_type in ('resolve', 'waive', 'exclude', 'correct')),
  field_name text,
  proposed_value jsonb,
  decided_value jsonb,
  reason text not null check (btrim(reason) <> ''),
  corrects_decision_id uuid references importacion_decisiones (id) on delete restrict,
  decided_by uuid not null references profiles (id) on delete restrict,
  decided_at timestamptz not null default now()
);

create index if not exists importacion_decisiones_registro_idx
  on importacion_decisiones (registro_id, decided_at desc);

-- Una decisión y el estado visible del staging cambian en la misma
-- transacción. Si ya había una decisión, la nueva queda enlazada como
-- corrección: nunca se pisa ni se borra la auditoría anterior.
create or replace function public.record_import_decision(
  p_registro_id uuid,
  p_decision_type text,
  p_field_name text,
  p_decided_value jsonb,
  p_reason text
)
returns uuid
language plpgsql
security invoker
set search_path = public
as $$
declare
  previous_decision_id uuid;
  created_decision_id uuid;
  stored_decision_type text;
  proposed jsonb;
begin
  if not public.is_admin(auth.uid()) then
    raise exception 'Solo un administrador puede decidir una importacion';
  end if;
  if p_decision_type not in ('resolve', 'waive', 'exclude') then
    raise exception 'Tipo de decision invalido';
  end if;
  if p_reason is null or btrim(p_reason) = '' then
    raise exception 'La decision requiere un motivo';
  end if;

  perform 1 from importacion_registros where id = p_registro_id for update;
  if not found then
    raise exception 'No existe el registro de importacion';
  end if;

  select id into previous_decision_id
  from importacion_decisiones
  where registro_id = p_registro_id
  order by decided_at desc, id desc
  limit 1;

  select case
    when p_field_name is null then normalizado
    else normalizado -> p_field_name
  end
  into proposed
  from importacion_registros
  where id = p_registro_id;

  stored_decision_type := case
    when previous_decision_id is null then p_decision_type
    else 'correct'
  end;

  insert into importacion_decisiones (
    registro_id,
    decision_type,
    field_name,
    proposed_value,
    decided_value,
    reason,
    corrects_decision_id,
    decided_by
  ) values (
    p_registro_id,
    stored_decision_type,
    p_field_name,
    proposed,
    p_decided_value,
    btrim(p_reason),
    previous_decision_id,
    auth.uid()
  )
  returning id into created_decision_id;

  update importacion_registros
  set
    estado = case when p_decision_type = 'exclude' then 'descartado' else 'pendiente' end,
    resolution_status = case when p_decision_type = 'exclude' then 'waived' else 'resolved' end,
    quality_status = 'warning',
    revisado_por = auth.uid(),
    revisado_at = now()
  where id = p_registro_id;

  return created_decision_id;
end;
$$;

-- La misma fila de origen no puede materializarse dos veces en destinos.
create unique index if not exists salidas_registro_id_unique_idx
  on salidas (registro_id) where registro_id is not null;
create unique index if not exists salida_resultados_registro_id_unique_idx
  on salida_resultados (registro_id) where registro_id is not null;
create unique index if not exists territorio_historial_registro_id_unique_idx
  on territorio_historial (registro_id) where registro_id is not null;

-- ---------------------------------------------------------------------
-- 6. Vista del mapa publicado vigente (no reinterpreta hechos historicos)
-- ---------------------------------------------------------------------

create or replace view territorios_actuales as
select
  u.id as territory_unit_version_id,
  u.entity_id,
  u.map_version_id,
  v.label as map_version_label,
  v.valid_from,
  v.valid_to,
  u.code_text,
  coalesce(u.display_name, u.code_text) as display_name,
  u.description,
  u.sector,
  u.kind,
  u.geometry_geojson,
  u.geometry_status,
  u.parent_unit_version_id,
  u.legacy_territory_id
from territory_unit_versions u
join territory_map_versions v on v.id = u.map_version_id
where v.status = 'published'
  and v.valid_from <= current_date
  and (v.valid_to is null or current_date < v.valid_to)
  and u.status = 'active';

-- ---------------------------------------------------------------------
-- 7. RLS y permisos
-- ---------------------------------------------------------------------

alter table territory_map_versions enable row level security;
alter table territory_entities enable row level security;
alter table territory_unit_versions enable row level security;
alter table territory_change_sets enable row level security;
alter table territory_lineage enable row level security;
alter table salida_territorios enable row level security;
alter table importacion_decisiones enable row level security;

create policy "Leer versiones territoriales" on territory_map_versions
for select to authenticated using (
  public.can_access_module('mapas') or public.can_access_module('salidas')
  or public.can_access_module('territorio_personal') or public.is_admin(auth.uid())
);
create policy "Admins manejan versiones territoriales" on territory_map_versions
for all to authenticated using (public.is_admin(auth.uid())) with check (public.is_admin(auth.uid()));

create policy "Leer identidades territoriales" on territory_entities
for select to authenticated using (
  public.can_access_module('mapas') or public.can_access_module('salidas')
  or public.can_access_module('territorio_personal') or public.is_admin(auth.uid())
);
create policy "Admins manejan identidades territoriales" on territory_entities
for all to authenticated using (public.is_admin(auth.uid())) with check (public.is_admin(auth.uid()));

create policy "Leer unidades territoriales" on territory_unit_versions
for select to authenticated using (
  public.can_access_module('mapas') or public.can_access_module('salidas')
  or public.can_access_module('territorio_personal') or public.is_admin(auth.uid())
);
create policy "Admins manejan unidades territoriales" on territory_unit_versions
for all to authenticated using (public.is_admin(auth.uid())) with check (public.is_admin(auth.uid()));

create policy "Leer cambios territoriales" on territory_change_sets
for select to authenticated using (
  public.can_access_module('mapas') or public.can_access_module('salidas') or public.is_admin(auth.uid())
);
create policy "Admins manejan cambios territoriales" on territory_change_sets
for all to authenticated using (public.is_admin(auth.uid())) with check (public.is_admin(auth.uid()));

create policy "Leer linaje territorial" on territory_lineage
for select to authenticated using (
  public.can_access_module('mapas') or public.can_access_module('salidas') or public.is_admin(auth.uid())
);
create policy "Admins registran linaje territorial" on territory_lineage
for insert to authenticated with check (public.is_admin(auth.uid()));

create policy "Leer territorios de salidas" on salida_territorios
for select to authenticated using (
  public.can_access_module('salidas') or public.can_access_module('salidas_grupo') or public.is_admin(auth.uid())
);
create policy "Admins manejan territorios de salidas" on salida_territorios
for all to authenticated using (public.is_admin(auth.uid())) with check (public.is_admin(auth.uid()));

create policy "Admins leen decisiones de importacion" on importacion_decisiones
for select to authenticated using (public.is_admin(auth.uid()));
create policy "Admins registran decisiones de importacion" on importacion_decisiones
for insert to authenticated with check (
  public.is_admin(auth.uid()) and decided_by = auth.uid()
);

revoke update, delete on public.importacion_decisiones from authenticated;
revoke update, delete on public.territory_lineage from authenticated;
grant select, insert, update, delete on public.territory_map_versions to authenticated;
grant select, insert, update, delete on public.territory_entities to authenticated;
grant select, insert, update, delete on public.territory_unit_versions to authenticated;
grant select, insert, update, delete on public.territory_change_sets to authenticated;
grant select, insert on public.territory_lineage to authenticated;
grant select, insert, update, delete on public.salida_territorios to authenticated;
grant select, insert on public.importacion_decisiones to authenticated;
grant select on public.territorios_actuales to authenticated;
grant execute on function public.record_import_decision(uuid, text, text, jsonb, text)
  to authenticated;

do $$
begin
  if current_setting('server_version_num')::int >= 150000 then
    execute 'alter view territorios_actuales set (security_invoker = on)';
  end if;
end
$$;

commit;
