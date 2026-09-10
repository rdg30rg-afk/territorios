-- Permite que los administradores de territorios asignen, cambien o quiten
-- el grupo de cualquier cuenta, sin convertir esa membresía en un permiso
-- administrativo. Idempotente y auditado por el trigger existente.

begin;

create or replace function public.administrar_grupo_usuario(
  p_profile_id uuid,
  p_group_id uuid default null
)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
set row_security = off
as $$
declare
  v_actual public.grupo_miembros%rowtype;
  v_miembro_id uuid;
begin
  if not public.es_admin_territorios(auth.uid()) then
    raise exception 'Sólo un administrador de territorios puede asignar grupos'
      using errcode = '42501';
  end if;

  if not exists (select 1 from public.profiles where id = p_profile_id) then
    raise exception 'El usuario no existe' using errcode = '22023';
  end if;

  if p_group_id is not null
    and not exists (select 1 from public.grupos_servicio where id = p_group_id) then
    raise exception 'El grupo no existe' using errcode = '23503';
  end if;

  perform pg_advisory_xact_lock(hashtext(p_profile_id::text));

  select * into v_actual
  from public.grupo_miembros
  where profile_id = p_profile_id and hasta is null
  for update;

  if found and v_actual.group_id = p_group_id then
    if v_actual.estado <> 'confirmado' then
      update public.grupo_miembros
      set estado = 'confirmado',
          confirmado_por = auth.uid(),
          confirmado_at = clock_timestamp()
      where id = v_actual.id;
    end if;
    return v_actual.id;
  end if;

  if found then
    update public.grupo_miembros
    set estado = 'retirado', hasta = current_date
    where id = v_actual.id;
  end if;

  if p_group_id is null then
    return null;
  end if;

  insert into public.grupo_miembros (
    group_id, profile_id, rol_en_grupo, estado,
    confirmado_por, confirmado_at
  ) values (
    p_group_id, p_profile_id, 'publicador', 'confirmado',
    auth.uid(), clock_timestamp()
  )
  returning id into v_miembro_id;

  return v_miembro_id;
end;
$$;

revoke all on function public.administrar_grupo_usuario(uuid, uuid) from public, anon;
grant execute on function public.administrar_grupo_usuario(uuid, uuid) to authenticated;

commit;
