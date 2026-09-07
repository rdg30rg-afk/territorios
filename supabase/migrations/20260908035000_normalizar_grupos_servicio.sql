-- Un grupo lógico por número; los responsables importados se preservan aparte.
-- Idempotente, transaccional y con precondición de no pérdida de referencias.

begin;

create table if not exists public.grupo_responsables_importados (
  id uuid primary key default gen_random_uuid(),
  source_group_id uuid not null unique,
  group_id uuid not null references public.grupos_servicio (id) on delete cascade,
  driver_id uuid references public.conductores (id) on delete set null,
  manager_name text not null,
  manager_role text not null
    check (manager_role in ('auxiliar', 'siervo', 'superintendente')),
  source_created_at timestamptz,
  created_at timestamptz not null default now()
);

alter table public.grupo_responsables_importados enable row level security;
revoke all on public.grupo_responsables_importados from anon, public, authenticated;
grant select on public.grupo_responsables_importados to authenticated;

drop policy if exists "Admins leen responsables importados" on public.grupo_responsables_importados;
create policy "Admins leen responsables importados"
  on public.grupo_responsables_importados
  for select to authenticated
  using (public.is_admin(auth.uid()));

-- La fila principal conserva al superintendente; si el grupo tiene siervo en
-- vez de superintendente, conserva al siervo. created_at/id rompen empates.
with ranked as (
  select
    grupo.*,
    first_value(grupo.id) over (
      partition by grupo.group_number
      order by case grupo.manager_role
        when 'superintendente' then 1
        when 'siervo' then 2
        when 'auxiliar' then 3
        else 4
      end, grupo.created_at, grupo.id
    ) as canonical_id
  from public.grupos_servicio grupo
  where grupo.group_number is not null
)
insert into public.grupo_responsables_importados (
  source_group_id, group_id, driver_id, manager_name, manager_role,
  source_created_at
)
select
  ranked.id,
  ranked.canonical_id,
  ranked.driver_id,
  coalesce(nullif(btrim(ranked.manager_name), ''), ranked.group_name),
  ranked.manager_role,
  ranked.created_at
from ranked
where ranked.manager_role in ('auxiliar', 'siervo', 'superintendente')
on conflict (source_group_id) do update
set group_id = excluded.group_id,
    driver_id = excluded.driver_id,
    manager_name = excluded.manager_name,
    manager_role = excluded.manager_role,
    source_created_at = excluded.source_created_at;

do $$
declare
  v_referencias integer;
begin
  with ranked as (
    select grupo.id,
      first_value(grupo.id) over (
        partition by grupo.group_number
        order by case grupo.manager_role
          when 'superintendente' then 1
          when 'siervo' then 2
          when 'auxiliar' then 3
          else 4
        end, grupo.created_at, grupo.id
      ) as canonical_id
    from public.grupos_servicio grupo
    where grupo.group_number is not null
  ), duplicados as (
    select id from ranked where id <> canonical_id
  )
  select count(*) into v_referencias
  from duplicados duplicado
  where exists (select 1 from public.grupo_miembros where group_id = duplicado.id)
     or exists (select 1 from public.grupo_territorio where group_id = duplicado.id)
     or exists (select 1 from public.puntos_encuentro where group_id = duplicado.id)
     or exists (select 1 from public.salidas where group_id = duplicado.id);

  if v_referencias > 0 then
    raise exception 'Hay % filas duplicadas de grupos con referencias; se aborta la normalización',
      v_referencias using errcode = '23503';
  end if;
end;
$$;

-- Las invitaciones de filas secundarias no representan códigos distintos: se
-- conserva el código de la fila canónica y se eliminan las demás.
with ranked as (
  select grupo.id,
    first_value(grupo.id) over (
      partition by grupo.group_number
      order by case grupo.manager_role
        when 'superintendente' then 1
        when 'siervo' then 2
        when 'auxiliar' then 3
        else 4
      end, grupo.created_at, grupo.id
    ) as canonical_id
  from public.grupos_servicio grupo
  where grupo.group_number is not null
)
delete from public.grupo_invitaciones invitacion
using ranked
where invitacion.group_id = ranked.id
  and ranked.id <> ranked.canonical_id;

with ranked as (
  select grupo.id,
    first_value(grupo.id) over (
      partition by grupo.group_number
      order by case grupo.manager_role
        when 'superintendente' then 1
        when 'siervo' then 2
        when 'auxiliar' then 3
        else 4
      end, grupo.created_at, grupo.id
    ) as canonical_id
  from public.grupos_servicio grupo
  where grupo.group_number is not null
)
delete from public.grupos_servicio grupo
using ranked
where grupo.id = ranked.id
  and ranked.id <> ranked.canonical_id;

create unique index if not exists grupos_servicio_numero_unico_idx
  on public.grupos_servicio (group_number)
  where group_number is not null;

insert into public.grupo_invitaciones (group_id, codigo)
select grupo.id, public.generar_codigo_grupo()
from public.grupos_servicio grupo
where not exists (
  select 1 from public.grupo_invitaciones invitacion
  where invitacion.group_id = grupo.id
);

notify pgrst, 'reload schema';
commit;
