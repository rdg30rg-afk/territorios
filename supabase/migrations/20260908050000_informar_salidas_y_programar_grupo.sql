-- Capacidades móviles: un conductor o responsable confirmado puede informar
-- una salida, y el responsable puede elegir un conductor al programar la de
-- su grupo. Aditiva, idempotente y transaccional.

begin;

create or replace function public.puede_informar_salida(
  p_salida_id uuid,
  p_territory_id uuid
)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
set row_security = off
as $$
  select public.puede_informar_salidas(auth.uid()) and exists (
    select 1
    from public.salidas salida
    where salida.id = p_salida_id
      and salida.territory_id = p_territory_id
  )
$$;

create or replace function public.conductores_disponibles_para_salida_grupo(
  p_group_id uuid
)
returns table (id uuid, full_name text)
language sql
stable
security definer
set search_path = public, pg_temp
set row_security = off
as $$
  select conductor.id, conductor.full_name
  from public.conductores conductor
  where public.es_responsable_de_grupo(p_group_id, auth.uid())
    and conductor.status = 'activo'
  order by conductor.full_name, conductor.id
$$;

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

  select * into v_salida
  from public.salidas
  where id = p_salida_id
  for share;

  if not found then
    raise exception 'La salida no existe' using errcode = '22023';
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
  elsif p_corrige_id is not null then
    raise exception 'No hay un resultado actual para corregir'
      using errcode = '22023';
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

drop policy if exists conductor_lee_resultado_de_su_salida on public.salida_resultados;
drop policy if exists informador_lee_resultados_de_salidas on public.salida_resultados;
create policy informador_lee_resultados_de_salidas
on public.salida_resultados for select to authenticated
using (public.puede_informar_salidas(auth.uid()));

revoke all on function public.puede_informar_salida(uuid, uuid) from public, anon;
revoke all on function public.conductores_disponibles_para_salida_grupo(uuid) from public, anon;
revoke all on function public.informar_resultado_salida(uuid, uuid, text, text, text, timestamptz, uuid)
  from public, anon;
grant execute on function public.puede_informar_salida(uuid, uuid) to authenticated;
grant execute on function public.conductores_disponibles_para_salida_grupo(uuid) to authenticated;
grant execute on function public.informar_resultado_salida(uuid, uuid, text, text, text, timestamptz, uuid)
  to authenticated;

notify pgrst, 'reload schema';
commit;
