-- Queja de un encargado: «otro puede reservar un territorio aunque ya esté
-- asignado a alguien».
--
-- Qué pasaba (20260908020000):
--   * `solicitar_territorio` aceptaba el pedido de cualquiera aunque el
--     territorio ya tuviera una asignación vigente de otra persona: nacía una
--     solicitud que después nadie podía aprobar, y el pedido quedaba colgado.
--   * `gestionar_reserva` ya frenaba la aprobación con el índice único de
--     reservas activas, pero con un mensaje técnico y sin avisar de qué se
--     trataba.
--   * B6: el responsable de grupo (superintendente, siervo o auxiliar)
--     decidía con `p_assigned_to` a cualquiera: a alguien de otro grupo, o a sí
--     mismo, porque sólo se miraba el grupo de quien había pedido.
--
-- Ahora, en el servidor y con mensaje en castellano:
--   * No se puede pedir un territorio que está asignado a otra persona.
--   * No se puede aprobar ni asignar un territorio que ya tiene una asignación
--     vigente de otra persona (el administrador tampoco: primero se devuelve).
--   * Un responsable de grupo sólo aprueba o asigna a miembros de SU grupo y
--     nunca para sí mismo. Un administrador puede todo, como antes.
--
-- Las asignaciones a un grupo (grupo_territorio) no se miran acá: son otra
-- cosa y un hermano del grupo puede pedir un territorio del grupo.
-- Sólo reemplaza funciones; aplicable dos veces; no toca datos.
begin;

create or replace function public.solicitar_territorio(p_territory_id uuid)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_id uuid;
  v_nombre text;
  v_estado text;
begin
  if not public.es_usuario_activo() then
    raise exception 'Tu cuenta no tiene acceso activo' using errcode = '42501';
  end if;
  select estado into v_estado
  from public.grupo_miembros
  where profile_id = auth.uid() and hasta is null;
  if v_estado = 'pendiente' then
    raise exception 'Cuando te confirmen en el grupo vas a poder pedirlo' using errcode = '42501';
  end if;
  perform 1 from public.territorios where id = p_territory_id for update;
  if not found then
    raise exception 'El territorio no existe' using errcode = '22023';
  end if;
  select id into v_id
  from public.territorio_personal_reservas
  where territory_id = p_territory_id and requested_by = auth.uid() and status = 'solicitada';
  if v_id is not null then return v_id; end if;
  if public.territorio_es_mio(p_territory_id) then
    raise exception 'Ya tenés este territorio asignado' using errcode = '22023';
  end if;
  -- Con el territorio bloqueado, nadie lo puede asignar entre esta lectura y
  -- el insert de abajo.
  if exists (
    select 1 from public.territorio_personal_reservas
    where territory_id = p_territory_id
      and status = 'activa'
      and assigned_to is distinct from auth.uid()
  ) then
    raise exception 'Este territorio ya está asignado a otra persona. Pedile a tu encargado otro territorio.'
      using errcode = '23505';
  end if;
  select coalesce(nullif(btrim(full_name), ''), 'Sin nombre') into v_nombre
  from public.profiles where id = auth.uid();
  insert into public.territorio_personal_reservas (
    territory_id, reserved_for, status, requested_by, requested_at, created_by
  )
  values (p_territory_id, v_nombre, 'solicitada', auth.uid(), now(), auth.uid())
  returning id into v_id;
  insert into public.reserva_movimientos (reserva_id, estado_nuevo, actor_id)
  values (v_id, 'solicitada', auth.uid());
  return v_id;
end;
$$;

create or replace function public.gestionar_reserva(
  p_reserva_id uuid,
  p_accion text,
  p_assigned_to uuid default null,
  p_nota text default null
)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  r public.territorio_personal_reservas%rowtype;
  v_territory uuid;
  v_assigned uuid;
  v_nombre text;
  v_estado text;
  v_grupo uuid;
  v_puede boolean;
begin
  if not public.es_usuario_activo() then
    raise exception 'Tu cuenta no tiene acceso activo' using errcode = '42501';
  end if;
  select territory_id into v_territory from public.territorio_personal_reservas where id = p_reserva_id;
  if not found then
    raise exception 'La reserva no existe' using errcode = '22023';
  end if;
  perform 1 from public.territorios where id = v_territory for update;
  select * into r from public.territorio_personal_reservas where id = p_reserva_id for update;
  if p_accion is null or p_accion not in ('aprobar', 'rechazar', 'devolver', 'vincular') then
    raise exception 'Acción inválida' using errcode = '22023';
  end if;

  v_grupo := public.grupo_vigente_de(coalesce(r.requested_by, r.assigned_to));
  v_puede := public.is_admin(auth.uid())
    or (p_accion = 'devolver' and coalesce(r.assigned_to = auth.uid(), false))
    or (
      p_accion in ('aprobar', 'rechazar', 'vincular')
      and v_grupo is not null
      and public.es_super_del_grupo(v_grupo)
    );
  if not v_puede then
    raise exception 'No tenés permiso para decidir esta reserva' using errcode = '42501';
  end if;

  if p_accion in ('aprobar', 'vincular') and not public.is_admin(auth.uid()) then
    -- B6: el responsable del grupo no se aprueba a sí mismo ni a gente de otro grupo.
    if coalesce(p_assigned_to, r.requested_by) = auth.uid() then
      raise exception 'No podés aprobarte un territorio a vos mismo. Pedile a un administrador.'
        using errcode = '42501';
    end if;
    if public.grupo_vigente_de(coalesce(p_assigned_to, r.requested_by)) is distinct from v_grupo then
      raise exception 'Esa persona no es de tu grupo' using errcode = '42501';
    end if;
    if exists (
      select 1 from public.grupo_miembros m
      where m.profile_id = coalesce(p_assigned_to, r.requested_by)
        and m.group_id = v_grupo
        and m.hasta is null
        and m.estado = 'pendiente'
    ) then
      raise exception 'Primero confirmalo en el grupo' using errcode = '42501';
    end if;
  end if;

  if length(coalesce(p_nota, '')) > 2000 then
    raise exception 'La nota es demasiado larga' using errcode = '22023';
  end if;
  v_assigned := r.assigned_to;
  if p_accion in ('aprobar', 'vincular') then
    v_assigned := coalesce(p_assigned_to, r.requested_by);
    select full_name into v_nombre from public.profiles where id = v_assigned and access_status = 'active';
    if not found then
      raise exception 'Elegí una persona con cuenta activa' using errcode = '22023';
    end if;
    if r.status = 'activa' and r.assigned_to = v_assigned then return r.id; end if;
    if not (
      (p_accion = 'aprobar' and r.status = 'solicitada')
      or (p_accion = 'vincular' and r.status = 'activa' and r.assigned_to is null)
    ) then
      raise exception 'La reserva cambió. Actualizá antes de decidir' using errcode = '40001';
    end if;
    if exists (
      select 1 from public.territorio_personal_reservas
      where territory_id = r.territory_id and status = 'activa' and id <> r.id
    ) then
      raise exception 'Este territorio ya está asignado a otra persona. Para pasarlo, primero devolvelo.'
        using errcode = '23505';
    end if;
    v_estado := 'activa';
  elsif p_accion = 'rechazar' then
    if r.status = 'rechazada' then return r.id; end if;
    if r.status <> 'solicitada' then
      raise exception 'Solo se puede rechazar un pedido pendiente' using errcode = '40001';
    end if;
    if length(btrim(coalesce(p_nota, ''))) < 2 then
      raise exception 'Escribí el motivo del rechazo' using errcode = '22023';
    end if;
    v_estado := 'rechazada';
  else
    if r.status = 'liberada' then return r.id; end if;
    if r.status <> 'activa' then
      raise exception 'Solo se puede devolver un territorio asignado' using errcode = '40001';
    end if;
    v_estado := 'liberada';
  end if;

  update public.territorio_personal_reservas
  set status = v_estado,
      assigned_to = v_assigned,
      reserved_at = case when p_accion = 'aprobar' then now() else reserved_at end,
      released_at = case when v_estado = 'liberada' then now() else released_at end,
      decided_by = case when p_accion in ('aprobar', 'rechazar', 'vincular') then auth.uid() else decided_by end,
      decided_at = case when p_accion in ('aprobar', 'rechazar', 'vincular') then now() else decided_at end,
      nota = coalesce(nullif(btrim(p_nota), ''), nota)
  where id = r.id;
  insert into public.reserva_movimientos (reserva_id, estado_anterior, estado_nuevo, actor_id, assigned_to, nota)
  values (r.id, r.status, v_estado, auth.uid(), v_assigned, nullif(btrim(p_nota), ''));
  return r.id;
end;
$$;

create or replace function public.asignar_territorio(
  p_territory_id uuid,
  p_assigned_to uuid,
  p_nota text default null
)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_id uuid;
  v_nombre text;
  v_grupo uuid;
begin
  v_grupo := public.grupo_vigente_de(p_assigned_to);
  if not public.is_admin(auth.uid()) and not (
    v_grupo is not null and public.es_super_del_grupo(v_grupo)
  ) then
    raise exception 'Solo un admin o el superintendente de su grupo puede asignar' using errcode = '42501';
  end if;
  if not public.is_admin(auth.uid()) then
    -- B6: el responsable del grupo no se asigna un territorio a sí mismo.
    if p_assigned_to = auth.uid() then
      raise exception 'No podés asignarte un territorio a vos mismo. Pedile a un administrador.'
        using errcode = '42501';
    end if;
    if exists (
      select 1 from public.grupo_miembros
      where profile_id = p_assigned_to and group_id = v_grupo and hasta is null and estado = 'pendiente'
    ) then
      raise exception 'Primero confirmalo en el grupo' using errcode = '42501';
    end if;
  end if;
  if length(coalesce(p_nota, '')) > 2000 then
    raise exception 'La nota es demasiado larga' using errcode = '22023';
  end if;
  perform 1 from public.territorios where id = p_territory_id for update;
  if not found then
    raise exception 'El territorio no existe' using errcode = '22023';
  end if;
  select full_name into v_nombre from public.profiles where id = p_assigned_to and access_status = 'active';
  if not found then
    raise exception 'Elegí una persona con cuenta activa' using errcode = '22023';
  end if;
  select id into v_id
  from public.territorio_personal_reservas
  where territory_id = p_territory_id and status = 'activa' and assigned_to = p_assigned_to;
  if v_id is not null then return v_id; end if;
  if exists (
    select 1 from public.territorio_personal_reservas
    where territory_id = p_territory_id and status = 'activa'
  ) then
    raise exception 'Este territorio ya está asignado a otra persona. Para pasarlo, primero devolvelo.'
      using errcode = '23505';
  end if;
  select id into v_id
  from public.territorio_personal_reservas
  where territory_id = p_territory_id and status = 'solicitada' and requested_by = p_assigned_to;
  if v_id is not null then
    return public.gestionar_reserva(v_id, 'aprobar', p_assigned_to, p_nota);
  end if;
  insert into public.territorio_personal_reservas (
    territory_id, reserved_for, status, assigned_to, reserved_at, decided_by, decided_at, created_by, nota
  )
  values (
    p_territory_id, coalesce(v_nombre, 'Sin nombre'), 'activa', p_assigned_to,
    now(), auth.uid(), now(), auth.uid(), nullif(btrim(p_nota), '')
  )
  returning id into v_id;
  insert into public.reserva_movimientos (reserva_id, estado_nuevo, actor_id, assigned_to, nota)
  values (v_id, 'activa', auth.uid(), p_assigned_to, nullif(btrim(p_nota), ''));
  return v_id;
end;
$$;

revoke all on function public.solicitar_territorio(uuid) from public, anon;
revoke all on function public.gestionar_reserva(uuid, text, uuid, text) from public, anon;
revoke all on function public.asignar_territorio(uuid, uuid, text) from public, anon;
grant execute on function public.solicitar_territorio(uuid) to authenticated;
grant execute on function public.gestionar_reserva(uuid, text, uuid, text) to authenticated;
grant execute on function public.asignar_territorio(uuid, uuid, text) to authenticated;

notify pgrst, 'reload schema';
commit;
