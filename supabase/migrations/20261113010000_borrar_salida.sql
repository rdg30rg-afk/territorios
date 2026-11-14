-- «Eliminar salida» devuelve «Could not find the function public.borrar_salida»
-- porque 20260906020000 nunca se aplicó en la base del sitio.
--
-- NO se aplica 20260906020000 tal cual: hoy volvería para atrás cosas que
-- las migraciones siguientes cambiaron a propósito (salidas_rpc_autorizado
-- con los roles unificados, crear/editar_salida con el punto de encuentro,
-- el lugar sin GPS) y le quitaría a `authenticated` el permiso de ejecutar
-- salidas_rpc_autorizado, que usa la política del borrador del programa.
--
-- Esta migración crea solamente `borrar_salida`, con la autorización de hoy:
--   * general: administrador de territorios o superadmin activo;
--   * grupo: lo mismo, o el responsable (superintendente, siervo o auxiliar
--     confirmado) del grupo al que pertenece la salida.
-- No depende de otras funciones de salidas: sólo de los helpers de roles de
-- 20260908040000, así que se puede aplicar en cualquier estado de la base.
-- Aditiva e idempotente; no borra datos al aplicarse.
begin;

create or replace function public.borrar_salida(
  p_scope text,
  p_salida_id uuid
)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_old_territory_id uuid;
  v_old_group_id uuid;
  v_current public.salidas;
  v_deleted_id uuid;

  -- Misma regla que salidas_rpc_autorizado, escrita acá para no depender de
  -- la versión que tenga cada base.
  v_autorizado boolean;
begin
  if p_scope is null or p_scope not in ('general', 'grupo') then
    raise exception 'Contexto de escritura inválido' using errcode = '22023';
  end if;
  if p_salida_id is null then
    raise exception 'Falta identificar la salida' using errcode = '22023';
  end if;
  if auth.uid() is null or not public.es_usuario_activo() then
    raise exception 'Tu cuenta no tiene acceso activo' using errcode = '42501';
  end if;

  select territory_id, group_id
    into v_old_territory_id, v_old_group_id
  from public.salidas
  where id = p_salida_id;
  if not found then
    raise exception 'La salida no existe' using errcode = '22023';
  end if;

  -- Antes de tocar nada: quien no puede borrar ésta no se entera de más.
  v_autorizado := public.es_admin_territorios(auth.uid())
    or (
      p_scope = 'grupo'
      and v_old_group_id is not null
      and public.es_responsable_de_grupo(v_old_group_id, auth.uid())
    );
  if not v_autorizado then
    raise exception 'No tenés permiso para eliminar esta salida' using errcode = '42501';
  end if;

  -- Primero el territorio y el grupo (padres), después la salida: es el mismo
  -- orden que usan crear y editar, para no trabarse entre sí.
  if v_old_territory_id is not null then
    perform 1 from public.territorios where id = v_old_territory_id for update;
  end if;
  if v_old_group_id is not null then
    perform 1 from public.grupos_servicio where id = v_old_group_id for share;
  end if;

  select * into v_current
  from public.salidas
  where id = p_salida_id
  for update;
  if not found then
    raise exception 'La salida dejó de existir' using errcode = '40001';
  end if;
  if v_current.territory_id is distinct from v_old_territory_id
     or v_current.group_id is distinct from v_old_group_id then
    raise exception 'La salida cambió mientras la eliminabas. Actualizá antes de guardar'
      using errcode = '40001';
  end if;

  if v_current.origen = 'excel' or v_current.registro_id is not null then
    raise exception 'Una salida importada no se elimina; debe corregirse de forma auditable'
      using errcode = '55000';
  end if;

  begin
    delete from public.salidas
    where id = p_salida_id
    returning id into v_deleted_id;
  exception when foreign_key_violation then
    raise exception 'Esta salida ya tiene resultados informados y no se puede eliminar'
      using errcode = '23503';
  end;

  return v_deleted_id;
end;
$$;

revoke all on function public.borrar_salida(text, uuid) from public, anon;
grant execute on function public.borrar_salida(text, uuid) to authenticated;

notify pgrst, 'reload schema';
commit;
