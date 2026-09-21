-- El resultado de una salida es un hecho auditable, no un campo editable.
-- La app informa y corrige únicamente por esta función: cada intento tiene
-- un UUID estable y una corrección agrega otra fila que apunta a la anterior.

begin;

-- Revocar DELETE de resultados no basta si borrar la salida los elimina en
-- cascada. Una salida con historia se corrige/cancela, no se borra.
alter table public.salida_resultados drop constraint if exists salida_resultados_salida_id_fkey;
alter table public.salida_resultados add constraint salida_resultados_salida_id_fkey
  foreign key (salida_id) references public.salidas(id) on delete restrict;

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
set search_path = public
as $$
declare
  v_salida public.salidas%rowtype;
  v_existente public.salida_resultados%rowtype;
  v_actual public.salida_resultados%rowtype;
  v_nuevo_id uuid;
  v_observaciones text := nullif(btrim(coalesce(p_observaciones, '')), '');
  v_es_admin boolean;
  v_puede_informar boolean;
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

  -- El UUID se puede reintentar después de un timeout sin duplicar el hecho.
  -- El segundo lock serializa también dos correcciones simultáneas sobre la
  -- misma salida, para que ambas no apunten al mismo resultado anterior.
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

  v_es_admin := public.is_admin(auth.uid());
  v_puede_informar := v_es_admin or exists (
    select 1
    from public.profiles p
    where p.id = auth.uid()
      and p.access_status = 'active'
      and p.driver_id is not null
      and v_salida.driver_id is not null
      and p.driver_id = v_salida.driver_id
  );

  if not v_puede_informar then
    raise exception 'Esta salida no está asignada a tu cuenta'
      using errcode = '42501';
  end if;

  -- La vista y esta consulta usan el mismo orden: el último evento informa
  -- el estado actual, y nunca se deduce "no_realizada" por falta de datos.
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
    id,
    salida_id,
    estado,
    motivo,
    observaciones,
    ocurrio_at,
    corrige_id,
    origen,
    informado_por,
    informado_at
  )
  values (
    p_id,
    p_salida_id,
    p_estado,
    p_motivo,
    v_observaciones,
    p_ocurrio_at,
    p_corrige_id,
    'app',
    auth.uid(),
    -- now() es el inicio de la transacción, anterior a esperar el lock.
    -- La corrección debe quedar después del hecho que acaba de corregir.
    greatest(clock_timestamp(), v_actual.informado_at + interval '1 microsecond')
  )
  returning id into v_nuevo_id;

  return v_nuevo_id;
end;
$$;

-- La escritura pasa por la validación de identidad, estado y linaje de la
-- función. Las filas antiguas siguen siendo legibles y nunca actualizables.
drop policy if exists "Informar el resultado" on public.salida_resultados;
revoke insert, update, delete on public.salida_resultados from public, anon, authenticated;
revoke all on function public.informar_resultado_salida(uuid, uuid, text, text, text, timestamptz, uuid)
  from public, anon;
grant execute on function public.informar_resultado_salida(uuid, uuid, text, text, text, timestamptz, uuid)
  to authenticated;

notify pgrst, 'reload schema';
commit;
