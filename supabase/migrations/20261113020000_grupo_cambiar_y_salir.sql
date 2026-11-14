-- G1: cambiar de grupo y salir del grupo fallaban siempre.
--
-- `unirme_a_grupo` y `salir_de_mi_grupo` (20260908020000) cerraban la
-- membresía poniendo sólo `hasta`. Desde 20260908040000 la tabla exige que una
-- fila con `hasta` esté en estado «retirado» (grupo_miembros_retiro_coherente_check),
-- así que la base devolvía un error crudo de restricción y nadie podía cambiar
-- de grupo ni irse del suyo.
--
-- Ahora las dos cierran la membresía como «retirado» y con `hasta`, que es lo
-- que ya hacen confirmar_miembro (rechazar) y el alta por un administrador. El
-- disparador de auditoría registra el retiro.
--
-- Además, volver a pegar el código del grupo en el que ya estás no te saca y te
-- vuelve a poner «pendiente»: queda como estaba.
-- Sólo reemplaza funciones; aplicable dos veces; no toca datos.
begin;

create or replace function public.unirme_a_grupo(p_codigo text)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_group uuid;
  v_status text;
  v_actual uuid;
begin
  if auth.uid() is null then
    raise exception 'Tenés que entrar a tu cuenta' using errcode = '42501';
  end if;

  -- Serializa los cambios de grupo de la misma persona.
  select access_status into v_status from public.profiles where id = auth.uid() for update;
  if not found then
    raise exception 'Tu perfil todavía no está listo' using errcode = '42501';
  end if;
  if v_status = 'inactive' then
    raise exception 'Tu cuenta está inactiva' using errcode = '42501';
  end if;

  select i.group_id into v_group
  from public.grupo_invitaciones i
  where i.activo and i.codigo = upper(btrim(coalesce(p_codigo, '')));
  if v_group is null then
    raise exception 'Ese código no es de ningún grupo. Fijate si lo copiaste bien.' using errcode = '22023';
  end if;

  select group_id into v_actual
  from public.grupo_miembros
  where profile_id = auth.uid() and hasta is null;
  if v_actual = v_group then
    return v_group;
  end if;

  update public.grupo_miembros
  set estado = 'retirado', hasta = current_date
  where profile_id = auth.uid() and hasta is null;

  insert into public.grupo_miembros (group_id, profile_id, rol_en_grupo, estado)
  values (v_group, auth.uid(), 'publicador', 'pendiente');

  if v_status = 'pending' then
    update public.profiles
    set access_status = 'active', role = 'viewer'
    where id = auth.uid();
    delete from public.user_module_access where user_id = auth.uid();
  end if;

  return v_group;
end;
$$;

create or replace function public.salir_de_mi_grupo()
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if auth.uid() is null then
    raise exception 'Tenés que entrar a tu cuenta' using errcode = '42501';
  end if;
  update public.grupo_miembros
  set estado = 'retirado', hasta = current_date
  where profile_id = auth.uid() and hasta is null;
end;
$$;

revoke all on function public.unirme_a_grupo(text) from public, anon;
revoke all on function public.salir_de_mi_grupo() from public, anon;
grant execute on function public.unirme_a_grupo(text) to authenticated;
grant execute on function public.salir_de_mi_grupo() to authenticated;

notify pgrst, 'reload schema';
commit;
