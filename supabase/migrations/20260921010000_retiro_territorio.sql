-- T-01: retiro integral de un territorio.
-- Escrita el 21 de septiembre de 2026. No está aplicada en DEV ni en producción.
-- No borra hechos. No existe unretire. La confirmación es retirar_territorio.

begin;

alter table public.territorios
  add column if not exists retired_at timestamptz,
  add column if not exists retired_by uuid references public.profiles (id) on delete set null,
  add column if not exists retirement_note text;

comment on column public.territorios.retired_at is
  'Instante de servidor en que el territorio dejó de aceptar actividad nueva. Null significa vigente.';

create table if not exists public.territory_retirements (
  operation_id uuid primary key,
  territory_id uuid not null references public.territorios (id) on delete restrict,
  retired_at timestamptz not null,
  retired_by uuid references public.profiles (id) on delete set null,
  previous_editor_revision integer not null,
  new_editor_revision integer not null,
  note text,
  created_at timestamptz not null
);

create unique index if not exists territory_retirements_territorio_idx
  on public.territory_retirements (territory_id);

alter table public.territory_retirements enable row level security;
revoke all on table public.territory_retirements from public, anon, authenticated;

create index if not exists territorios_retirados_idx
  on public.territorios (id)
  where retired_at is not null;

-- ---------------------------------------------------------------------
-- Lecturas internas. No se otorgan a la app.
-- ---------------------------------------------------------------------

create or replace function public.territorio_esta_retirado(p_territory_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
set row_security = off
as $$
  select exists (
    select 1
    from public.territorios
    where id = p_territory_id
      and retired_at is not null
  );
$$;

create or replace function public.grupo_territorio_apunta_a_retirado(
  p_territory_id uuid,
  p_unit_id uuid
)
returns boolean
language sql
stable
security definer
set search_path = public
set row_security = off
as $$
  select public.territorio_esta_retirado(p_territory_id)
    or exists (
      select 1
      from public.territory_unit_versions unidad
      where unidad.id = p_unit_id
        and public.territorio_esta_retirado(unidad.legacy_territory_id)
    );
$$;

create or replace function public.retiro_territorio_bloqueos(p_territory_id uuid)
returns jsonb
language sql
volatile
security definer
set search_path = public
set row_security = off
as $$
  select coalesce(jsonb_agg(item order by item->>'tipo', item->>'id'), '[]'::jsonb)
  from (
    select jsonb_build_object(
      'tipo', 'reserva_activa',
      'id', reserva.id,
      'estado', reserva.status
    ) as item
    from public.territorio_personal_reservas reserva
    where reserva.territory_id = p_territory_id
      and reserva.status = 'activa'
    union all
    select jsonb_build_object(
      'tipo', 'reserva_solicitada',
      'id', reserva.id,
      'estado', reserva.status
    )
    from public.territorio_personal_reservas reserva
    where reserva.territory_id = p_territory_id
      and reserva.status = 'solicitada'
    union all
    select jsonb_build_object(
      'tipo', 'salida_futura',
      'id', salida.id,
      'estado', coalesce(actual.estado, 'sin_resultado'),
      'fecha', salida.scheduled_for
    )
    from public.salidas salida
    left join lateral (
      select resultado.estado
      from public.salida_resultados resultado
      where resultado.salida_id = salida.id
      order by resultado.informado_at desc, resultado.id
      limit 1
    ) actual on true
    where salida.territory_id = p_territory_id
      and salida.scheduled_for > clock_timestamp()
      and (actual.estado is null or actual.estado = 'sin_dato')
    union all
    select jsonb_build_object(
      'tipo', 'grupo_vigente',
      'id', asignacion.id,
      'estado', 'vigente'
    )
    from public.grupo_territorio asignacion
    where asignacion.vigente_hasta is null
      and (
        asignacion.territory_id = p_territory_id
        or asignacion.territory_unit_version_id in (
          select unidad.id
          from public.territory_unit_versions unidad
          where unidad.legacy_territory_id = p_territory_id
        )
      )
  ) bloqueos;
$$;

create or replace function public.preflight_retirar_territorio(p_territory_id uuid)
returns jsonb
language plpgsql
volatile
security definer
set search_path = public
set row_security = off
as $$
declare
  v_revision integer;
  v_retired_at timestamptz;
  v_blockers jsonb;
begin
  if auth.uid() is null or not public.is_admin(auth.uid()) then
    raise exception 'Solo un administrador activo puede revisar un retiro'
      using errcode = '42501';
  end if;
  if p_territory_id is null then
    raise exception 'Falta identificar el territorio' using errcode = '22023';
  end if;

  select editor_revision, retired_at
    into v_revision, v_retired_at
  from public.territorios
  where id = p_territory_id;

  if not found then
    raise exception 'El territorio no existe' using errcode = '22023';
  end if;

  v_blockers := public.retiro_territorio_bloqueos(p_territory_id);

  return jsonb_build_object(
    'territory_id', p_territory_id,
    'already_retired', v_retired_at is not null,
    'can_retire', v_retired_at is null and jsonb_array_length(v_blockers) = 0,
    'observed_editor_revision', v_revision,
    'observed_at', clock_timestamp(),
    'counts', jsonb_build_object(
      'reserva_activa', (
        select count(*) from jsonb_array_elements(v_blockers) item
        where item->>'tipo' = 'reserva_activa'
      ),
      'reserva_solicitada', (
        select count(*) from jsonb_array_elements(v_blockers) item
        where item->>'tipo' = 'reserva_solicitada'
      ),
      'salida_futura', (
        select count(*) from jsonb_array_elements(v_blockers) item
        where item->>'tipo' = 'salida_futura'
      ),
      'grupo_vigente', (
        select count(*) from jsonb_array_elements(v_blockers) item
        where item->>'tipo' = 'grupo_vigente'
      )
    ),
    'blockers', v_blockers
  );
end;
$$;

create or replace function public.retirar_territorio(
  p_territory_id uuid,
  p_expected_editor_revision integer,
  p_operation_id uuid,
  p_note text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
set row_security = off
as $$
declare
  v_row public.territorios%rowtype;
  v_actor uuid := auth.uid();
  v_note text := nullif(btrim(coalesce(p_note, '')), '');
  v_existing public.territory_retirements%rowtype;
  v_blockers jsonb;
  v_retired_at timestamptz;
  v_previous integer;
  v_next integer;
  v_manzanas integer;
  v_lados integer;
begin
  if v_actor is null or not public.is_admin(v_actor) then
    raise exception 'Solo un administrador activo puede retirar un territorio'
      using errcode = '42501';
  end if;
  if p_territory_id is null or p_operation_id is null or p_expected_editor_revision is null then
    raise exception 'Faltan el territorio, la operación o la revisión esperada'
      using errcode = '22023';
  end if;
  if length(coalesce(p_note, '')) > 2000 then
    raise exception 'La nota de retiro es demasiado larga' using errcode = '22023';
  end if;

  select * into v_row
  from public.territorios
  where id = p_territory_id
  for update;

  if not found then
    raise exception 'El territorio no existe' using errcode = '22023';
  end if;

  select * into v_existing
  from public.territory_retirements
  where operation_id = p_operation_id;

  if found then
    if v_existing.territory_id = p_territory_id
       and v_existing.retired_by is not distinct from v_actor
       and v_existing.previous_editor_revision = p_expected_editor_revision
       and v_existing.note is not distinct from v_note then
      return jsonb_build_object(
        'status', 'replayed',
        'operation_id', v_existing.operation_id,
        'existing_operation_id', v_existing.operation_id,
        'replayed', true,
        'territory_id', v_existing.territory_id,
        'retired_at', v_existing.retired_at,
        'previous_editor_revision', v_existing.previous_editor_revision,
        'new_editor_revision', v_existing.new_editor_revision
      );
    end if;
    raise exception 'Esa operación ya retiró otro territorio o con otros datos'
      using errcode = '23505';
  end if;

  if v_row.retired_at is not null then
    select * into v_existing
    from public.territory_retirements
    where territory_id = p_territory_id;
    return jsonb_build_object(
      'status', 'already_retired',
      'operation_id', p_operation_id,
      'existing_operation_id', v_existing.operation_id,
      'replayed', false,
      'territory_id', p_territory_id,
      'retired_at', v_row.retired_at,
      'previous_editor_revision', v_existing.previous_editor_revision,
      'new_editor_revision', v_existing.new_editor_revision
    );
  end if;

  if v_row.editor_revision is distinct from p_expected_editor_revision then
    raise exception 'La revisión del territorio cambió. Actualizá antes de retirar'
      using errcode = '40001';
  end if;

  v_blockers := public.retiro_territorio_bloqueos(p_territory_id);
  if jsonb_array_length(v_blockers) > 0 then
    return jsonb_build_object(
      'status', 'blocked',
      'operation_id', p_operation_id,
      'replayed', false,
      'territory_id', p_territory_id,
      'blockers', v_blockers
    );
  end if;

  v_previous := v_row.editor_revision;
  select greatest(v_previous, coalesce(max(manzana.geometry_version), 0), 0) + 1
    into v_next
  from public.territorio_manzanas manzana
  where manzana.territory_id = p_territory_id;

  v_retired_at := clock_timestamp();
  perform set_config('territorios.retiro_en_curso', '1', true);

  update public.territorios
  set retired_at = v_retired_at,
      retired_by = v_actor,
      retirement_note = v_note,
      editor_revision = v_next,
      updated_at = v_retired_at
  where id = p_territory_id;

  update public.territorio_manzanas
  set vigente_hasta = v_retired_at,
      updated_at = v_retired_at
  where territory_id = p_territory_id
    and vigente_hasta is null;
  get diagnostics v_manzanas = row_count;

  update public.manzana_lados
  set vigente_hasta = v_retired_at
  where territory_id = p_territory_id
    and vigente_hasta is null;
  get diagnostics v_lados = row_count;

  insert into public.territory_retirements (
    operation_id, territory_id, retired_at, retired_by,
    previous_editor_revision, new_editor_revision, note, created_at
  ) values (
    p_operation_id, p_territory_id, v_retired_at, v_actor,
    v_previous, v_next, v_note, v_retired_at
  );

  return jsonb_build_object(
    'status', 'retired',
    'operation_id', p_operation_id,
    'existing_operation_id', p_operation_id,
    'replayed', false,
    'territory_id', p_territory_id,
    'retired_at', v_retired_at,
    'previous_editor_revision', v_previous,
    'new_editor_revision', v_next,
    'manzanas_cerradas', v_manzanas,
    'lados_cerrados', v_lados
  );
end;
$$;

-- ---------------------------------------------------------------------
-- El retiro no se reabre y la actividad nueva falla cerrado.
-- Cerrar geometría abierta sólo puede hacerlo la RPC, con la bandera
-- de transacción, y sin tocar la forma ni las medidas.
-- ---------------------------------------------------------------------

create or replace function public.territorios_proteger_retiro()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if old.retired_at is not null and new is distinct from old then
    raise exception 'El retiro es irreversible' using errcode = '55000';
  end if;
  if old.retired_at is null
     and new.retired_at is not null
     and current_setting('territorios.retiro_en_curso', true) is distinct from '1' then
    raise exception 'El retiro solo se confirma con retirar_territorio'
      using errcode = '55000';
  end if;
  return new;
end;
$$;

drop trigger if exists territorios_proteger_retiro on public.territorios;
create trigger territorios_proteger_retiro
  before update on public.territorios
  for each row execute function public.territorios_proteger_retiro();

create or replace function public.manzanas_rechazar_territorio_retirado()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if not public.territorio_esta_retirado(new.territory_id) then
    return new;
  end if;
  if tg_op = 'UPDATE'
     and current_setting('territorios.retiro_en_curso', true) = '1'
     and old.vigente_hasta is null
     and new.vigente_hasta is not null
     and new.territory_id is not distinct from old.territory_id
     and new.label is not distinct from old.label
     and new.lat is not distinct from old.lat
     and new.lng is not distinct from old.lng
     and new.geometry_geojson is not distinct from old.geometry_geojson
     and new.geometry_version is not distinct from old.geometry_version
     and new.area_m2 is not distinct from old.area_m2
     and new.orden is not distinct from old.orden
     and new.subterritorio_id is not distinct from old.subterritorio_id
     and new.vigente_desde is not distinct from old.vigente_desde then
    return new;
  end if;
  raise exception 'El territorio está retirado' using errcode = '55000';
end;
$$;

drop trigger if exists manzanas_rechazar_territorio_retirado on public.territorio_manzanas;
create trigger manzanas_rechazar_territorio_retirado
  before insert or update on public.territorio_manzanas
  for each row execute function public.manzanas_rechazar_territorio_retirado();

create or replace function public.lados_rechazar_territorio_retirado()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if not public.territorio_esta_retirado(new.territory_id) then
    return new;
  end if;
  if tg_op = 'UPDATE'
     and current_setting('territorios.retiro_en_curso', true) = '1'
     and old.vigente_hasta is null
     and new.vigente_hasta is not null
     and new.manzana_id is not distinct from old.manzana_id
     and new.territory_id is not distinct from old.territory_id
     and new.orden is not distinct from old.orden
     and new.geometry_geojson is not distinct from old.geometry_geojson
     and new.largo_m is not distinct from old.largo_m
     and new.rumbo_grados is not distinct from old.rumbo_grados
     and new.medio_lat is not distinct from old.medio_lat
     and new.medio_lng is not distinct from old.medio_lng
     and new.geometry_version is not distinct from old.geometry_version
     and new.vigente_desde is not distinct from old.vigente_desde then
    return new;
  end if;
  raise exception 'El territorio está retirado' using errcode = '55000';
end;
$$;

drop trigger if exists lados_rechazar_territorio_retirado on public.manzana_lados;
create trigger lados_rechazar_territorio_retirado
  before insert or update on public.manzana_lados
  for each row execute function public.lados_rechazar_territorio_retirado();

create or replace function public.reservas_rechazar_territorio_retirado()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if not public.territorio_esta_retirado(new.territory_id) then
    return new;
  end if;
  if tg_op = 'INSERT' then
    raise exception 'El territorio está retirado' using errcode = '55000';
  end if;
  if new.status in ('solicitada', 'activa')
     and (
       old.status is distinct from new.status
       or old.assigned_to is distinct from new.assigned_to
     ) then
    raise exception 'El territorio está retirado' using errcode = '55000';
  end if;
  return new;
end;
$$;

drop trigger if exists reservas_rechazar_territorio_retirado on public.territorio_personal_reservas;
create trigger reservas_rechazar_territorio_retirado
  before insert or update on public.territorio_personal_reservas
  for each row execute function public.reservas_rechazar_territorio_retirado();

create or replace function public.salidas_rechazar_territorio_retirado()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if tg_op = 'INSERT' and public.territorio_esta_retirado(new.territory_id) then
    raise exception 'El territorio está retirado' using errcode = '55000';
  end if;
  if tg_op = 'UPDATE'
     and public.territorio_esta_retirado(new.territory_id)
     and (
       new.scheduled_for > clock_timestamp()
       or new.territory_id is distinct from old.territory_id
     ) then
    raise exception 'El territorio está retirado' using errcode = '55000';
  end if;
  return new;
end;
$$;

drop trigger if exists salidas_rechazar_territorio_retirado on public.salidas;
create trigger salidas_rechazar_territorio_retirado
  before insert or update on public.salidas
  for each row execute function public.salidas_rechazar_territorio_retirado();

create or replace function public.cobertura_rechazar_territorio_retirado()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if public.territorio_esta_retirado(new.territory_id)
     and not (new.origen = 'correccion' and public.is_admin(auth.uid())) then
    raise exception 'El territorio está retirado' using errcode = '55000';
  end if;
  return new;
end;
$$;

drop trigger if exists cobertura_rechazar_territorio_retirado on public.cobertura_eventos;
create trigger cobertura_rechazar_territorio_retirado
  before insert on public.cobertura_eventos
  for each row execute function public.cobertura_rechazar_territorio_retirado();

create or replace function public.resultados_rechazar_territorio_retirado()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  v_territory_id uuid;
begin
  if new.corrige_id is not null then
    return new;
  end if;
  select territory_id into v_territory_id
  from public.salidas
  where id = new.salida_id;
  if public.territorio_esta_retirado(v_territory_id) then
    raise exception 'El territorio está retirado' using errcode = '55000';
  end if;
  return new;
end;
$$;

drop trigger if exists resultados_rechazar_territorio_retirado on public.salida_resultados;
create trigger resultados_rechazar_territorio_retirado
  before insert on public.salida_resultados
  for each row execute function public.resultados_rechazar_territorio_retirado();

create or replace function public.grupos_rechazar_territorio_retirado()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if not public.grupo_territorio_apunta_a_retirado(new.territory_id, new.territory_unit_version_id) then
    return new;
  end if;
  if tg_op = 'INSERT' then
    raise exception 'El territorio está retirado' using errcode = '55000';
  end if;
  if new.vigente_hasta is null
     or new.territory_id is distinct from old.territory_id
     or new.territory_unit_version_id is distinct from old.territory_unit_version_id
     or new.group_id is distinct from old.group_id then
    raise exception 'El territorio está retirado' using errcode = '55000';
  end if;
  return new;
end;
$$;

drop trigger if exists grupos_rechazar_territorio_retirado on public.grupo_territorio;
create trigger grupos_rechazar_territorio_retirado
  before insert or update on public.grupo_territorio
  for each row execute function public.grupos_rechazar_territorio_retirado();

create or replace function public.unidades_rechazar_legado_retirado()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if new.legacy_territory_id is null
     or not public.territorio_esta_retirado(new.legacy_territory_id) then
    return new;
  end if;
  if tg_op = 'INSERT' then
    raise exception 'El territorio está retirado' using errcode = '55000';
  end if;
  if old.legacy_territory_id is distinct from new.legacy_territory_id
     or (new.status = 'active' and old.status is distinct from 'active') then
    raise exception 'El territorio está retirado' using errcode = '55000';
  end if;
  return new;
end;
$$;

drop trigger if exists unidades_rechazar_legado_retirado on public.territory_unit_versions;
create trigger unidades_rechazar_legado_retirado
  before insert or update on public.territory_unit_versions
  for each row execute function public.unidades_rechazar_legado_retirado();

-- La vista publicada deja de mostrar un legado ya retirado.
-- Una unidad sin legado sigue visible.
create or replace view public.territorios_actuales as
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
from public.territory_unit_versions u
join public.territory_map_versions v on v.id = u.map_version_id
where v.status = 'published'
  and v.valid_from <= current_date
  and (v.valid_to is null or current_date < v.valid_to)
  and u.status = 'active'
  and not exists (
    select 1
    from public.territorios legado
    where legado.id = u.legacy_territory_id
      and legado.retired_at is not null
  );

-- ---------------------------------------------------------------------
-- Resultado de salida: el territorio se bloquea antes que la fila.
-- Un resultado inicial sobre un territorio retirado se rechaza.
-- Una corrección admin, con corrige_id, puede seguir.
-- ---------------------------------------------------------------------

create or replace function public.informar_resultado_salida(
  p_id uuid,
  p_salida_id uuid,
  p_estado text,
  p_motivo text default null,
  p_observaciones text default null,
  p_ocurrio_at timestamptz default null,
  p_corrige_id uuid default null
)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
set row_security = off
as $$
declare
  v_territory_id uuid;
  v_salida public.salidas%rowtype;
  v_existente public.salida_resultados%rowtype;
  v_actual public.salida_resultados%rowtype;
  v_nuevo_id uuid;
  v_observaciones text := nullif(btrim(coalesce(p_observaciones, '')), '');
  v_es_admin boolean;
begin
  if not public.es_usuario_activo() then
    raise exception 'Tu cuenta no tiene acceso activo' using errcode = '42501';
  end if;

  if p_id is null or p_salida_id is null then
    raise exception 'Falta identificar el intento o la salida' using errcode = '22023';
  end if;

  if p_estado is null or p_estado not in
    ('realizada', 'parcial', 'no_realizada', 'cancelada', 'sin_dato') then
    raise exception 'Estado de salida inválido' using errcode = '22023';
  end if;

  if p_motivo is not null and p_motivo not in
    ('acceso', 'edificio', 'consorcio', 'clima', 'feriado',
     'sin_conductor', 'sin_publicadores', 'otro') then
    raise exception 'Motivo de salida inválido' using errcode = '22023';
  end if;

  if length(coalesce(p_observaciones, '')) > 2000 then
    raise exception 'Las observaciones son demasiado largas' using errcode = '22023';
  end if;

  perform pg_advisory_xact_lock(hashtextextended(p_id::text, 20260905));
  perform pg_advisory_xact_lock(hashtextextended(p_salida_id::text, 20260906));

  select * into v_existente
  from public.salida_resultados
  where id = p_id;

  if found then
    if v_existente.informado_por = auth.uid()
      and v_existente.salida_id = p_salida_id
      and v_existente.estado = p_estado
      and v_existente.motivo is not distinct from p_motivo
      and v_existente.observaciones is not distinct from v_observaciones
      and v_existente.ocurrio_at is not distinct from p_ocurrio_at
      and v_existente.corrige_id is not distinct from p_corrige_id then
      return v_existente.id;
    end if;
    raise exception 'Ese identificador ya corresponde a otro resultado'
      using errcode = '23505';
  end if;

  select territory_id into v_territory_id
  from public.salidas
  where id = p_salida_id;

  if not found then
    raise exception 'La salida no existe' using errcode = '22023';
  end if;

  perform 1
  from public.territorios
  where id = v_territory_id
  for share;

  select * into v_salida
  from public.salidas
  where id = p_salida_id
  for share;

  if not found then
    raise exception 'La salida no existe' using errcode = '22023';
  end if;

  if v_salida.territory_id is distinct from v_territory_id then
    raise exception 'La salida cambió de territorio. Actualizá antes de informar'
      using errcode = '40001';
  end if;

  v_es_admin := public.es_admin_territorios(auth.uid());
  if not public.puede_informar_salidas(auth.uid()) then
    raise exception 'Tu cuenta no puede informar salidas' using errcode = '42501';
  end if;

  select * into v_actual
  from public.salida_resultados
  where salida_id = p_salida_id
  order by informado_at desc, id
  limit 1;

  if found then
    if not v_es_admin then
      raise exception 'Sólo un administrador puede corregir un resultado'
        using errcode = '42501';
    end if;
    if p_corrige_id is null or p_corrige_id <> v_actual.id then
      raise exception 'La corrección debe apuntar al resultado actual'
        using errcode = '22023';
    end if;
    if length(coalesce(v_observaciones, '')) < 2 then
      raise exception 'Explicá el motivo de la corrección en las observaciones'
        using errcode = '22023';
    end if;
  else
    if p_corrige_id is not null then
      raise exception 'No hay un resultado actual para corregir'
        using errcode = '22023';
    end if;
    if public.territorio_esta_retirado(v_salida.territory_id) then
      raise exception 'El territorio está retirado: no se puede informar un resultado nuevo'
        using errcode = '55000';
    end if;
  end if;

  insert into public.salida_resultados (
    id, salida_id, estado, motivo, observaciones, ocurrio_at,
    corrige_id, origen, informado_por, informado_at
  ) values (
    p_id, p_salida_id, p_estado, p_motivo, v_observaciones, p_ocurrio_at,
    p_corrige_id, 'app', auth.uid(),
    greatest(clock_timestamp(), v_actual.informado_at + interval '1 microsecond')
  )
  returning id into v_nuevo_id;

  return v_nuevo_id;
end;
$$;

revoke all on function public.territorio_esta_retirado(uuid) from public, anon, authenticated;
revoke all on function public.grupo_territorio_apunta_a_retirado(uuid, uuid) from public, anon, authenticated;
revoke all on function public.retiro_territorio_bloqueos(uuid) from public, anon, authenticated;
revoke all on function public.preflight_retirar_territorio(uuid) from public, anon;
revoke all on function public.retirar_territorio(uuid, integer, uuid, text) from public, anon;
revoke all on function public.informar_resultado_salida(uuid, uuid, text, text, text, timestamptz, uuid)
  from public, anon;

grant execute on function public.preflight_retirar_territorio(uuid) to authenticated;
grant execute on function public.retirar_territorio(uuid, integer, uuid, text) to authenticated;
grant execute on function public.informar_resultado_salida(uuid, uuid, text, text, text, timestamptz, uuid)
  to authenticated;

notify pgrst, 'reload schema';
commit;
