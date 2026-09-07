-- Completa el sembrado cuando el perfil del encargado se vincula después
-- de crear el grupo y habilita las lecturas mínimas del super de ese grupo.
-- Producción no se toca. Idempotente.

begin;

create or replace function public.sembrar_encargados_de_grupo()
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_insertados integer := 0;
  v_ambiguo record;
begin
  for v_ambiguo in
    select p.id as profile_id,
           p.driver_id,
           string_agg(coalesce(g.group_number::text, g.group_name), ', ' order by g.group_number nulls last, g.created_at) as grupos
    from public.profiles p
    join public.grupos_servicio g on g.driver_id = p.driver_id
    where p.driver_id is not null
      and p.role <> 'admin'
    group by p.id, p.driver_id
    having count(*) > 1
  loop
    raise notice 'Encargado con driver_id % figura en varios grupos (%); se toma el de menor número',
      v_ambiguo.driver_id, v_ambiguo.grupos;
  end loop;

  insert into public.grupo_miembros (
    group_id, profile_id, rol_en_grupo, estado, confirmado_at
  )
  select distinct on (p.id)
    g.id,
    p.id,
    case g.manager_role
      when 'auxiliar' then 'auxiliar'
      else 'superintendente'
    end,
    'confirmado',
    now()
  from public.grupos_servicio g
  join public.profiles p
    on p.driver_id = g.driver_id
   and p.role <> 'admin'
   and p.driver_id is not null
  where g.driver_id is not null
    and not exists (
      select 1
      from public.grupo_miembros m
      where m.profile_id = p.id and m.hasta is null
    )
  order by p.id, g.group_number nulls last, g.created_at;

  get diagnostics v_insertados = row_count;
  return v_insertados;
end;
$$;

revoke all on function public.sembrar_encargados_de_grupo() from public, anon, authenticated;

create or replace function public.disparar_sembrado_encargados_de_grupo()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  perform public.sembrar_encargados_de_grupo();
  return null;
end;
$$;

revoke all on function public.disparar_sembrado_encargados_de_grupo() from public, anon, authenticated;

drop trigger if exists sembrar_encargado_al_vincular_perfil on public.profiles;
create trigger sembrar_encargado_al_vincular_perfil
after insert or update of driver_id, role on public.profiles
for each statement execute function public.disparar_sembrado_encargados_de_grupo();

drop trigger if exists sembrar_encargado_al_cambiar_grupo on public.grupos_servicio;
create trigger sembrar_encargado_al_cambiar_grupo
after insert or update of driver_id, manager_role, group_number on public.grupos_servicio
for each statement execute function public.disparar_sembrado_encargados_de_grupo();

create or replace function public.es_del_grupo_que_superviso(p_profile_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.grupo_miembros miembro
    where miembro.profile_id = p_profile_id
      and miembro.hasta is null
      and miembro.estado = 'confirmado'
      and public.es_super_del_grupo(miembro.group_id)
  );
$$;

revoke all on function public.es_del_grupo_que_superviso(uuid) from public, anon;
grant execute on function public.es_del_grupo_que_superviso(uuid) to authenticated;

drop policy if exists "Super ve perfiles de su grupo" on public.profiles;
create policy "Super ve perfiles de su grupo" on public.profiles
  for select to authenticated
  using (public.es_del_grupo_que_superviso(id));

drop policy if exists "Super ve reservas de su grupo" on public.territorio_personal_reservas;
create policy "Super ve reservas de su grupo" on public.territorio_personal_reservas
  for select to authenticated
  using (
    public.es_del_grupo_que_superviso(coalesce(requested_by, assigned_to))
  );

drop policy if exists "Super ve movimientos de su grupo" on public.reserva_movimientos;
create policy "Super ve movimientos de su grupo" on public.reserva_movimientos
  for select to authenticated
  using (
    exists (
      select 1
      from public.territorio_personal_reservas reserva
      where reserva.id = reserva_movimientos.reserva_id
        and public.es_del_grupo_que_superviso(coalesce(reserva.requested_by, reserva.assigned_to))
    )
  );

create or replace function public.territorios_disponibles_para_grupo(p_group_id uuid)
returns table (id uuid, name text)
language sql
stable
security definer
set search_path = public
as $$
  select territorio.id, territorio.name
  from public.territorios territorio
  where public.es_super_del_grupo(p_group_id)
    and not exists (
      select 1
      from public.territorio_personal_reservas reserva
      where reserva.territory_id = territorio.id
        and reserva.status = 'activa'
    )
  order by
    case when territorio.name ~ '^\d+$' then territorio.name::integer end nulls last,
    territorio.name;
$$;

revoke all on function public.territorios_disponibles_para_grupo(uuid) from public, anon;
grant execute on function public.territorios_disponibles_para_grupo(uuid) to authenticated;

create unique index if not exists reservas_beneficiario_activo_unico_idx
  on public.territorio_personal_reservas (assigned_to)
  where status = 'activa' and assigned_to is not null;

create or replace function public.impedir_dos_territorios_personales()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  v_profile_id uuid;
begin
  v_profile_id := case
    when new.status = 'activa' then new.assigned_to
    when new.status = 'solicitada' then new.requested_by
    else null
  end;
  if v_profile_id is not null and exists (
    select 1
    from public.territorio_personal_reservas reserva
    where reserva.assigned_to = v_profile_id
      and reserva.status = 'activa'
      and reserva.id is distinct from new.id
  ) then
    raise exception 'Esa persona ya tiene un territorio personal activo' using errcode = '23505';
  end if;
  return new;
end;
$$;

drop trigger if exists impedir_dos_territorios_personales on public.territorio_personal_reservas;
create trigger impedir_dos_territorios_personales
before insert or update of status, assigned_to, requested_by
on public.territorio_personal_reservas
for each row execute function public.impedir_dos_territorios_personales();

select public.sembrar_encargados_de_grupo();

notify pgrst, 'reload schema';
commit;
