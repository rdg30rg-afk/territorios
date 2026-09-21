begin;
-- El rol conductor por sí solo no habilita cualquier territorio.
create or replace function public.puede_informar_salida(p_salida_id uuid,p_territory_id uuid)
returns boolean language sql stable security definer set search_path=public as $$
 select public.es_usuario_activo() and exists(
   select 1 from public.salidas s join public.profiles p on p.id=auth.uid()
   where s.id=p_salida_id and s.territory_id=p_territory_id
     and s.driver_id is not null and s.driver_id=p.driver_id
 )
$$;

create or replace function public.informar_cobertura(
 p_event_id uuid,p_lado_id uuid,p_estado text,p_origen text default 'app_hermano',
 p_salida_id uuid default null,p_corrige_evento_id uuid default null,p_nota text default null,
 p_geometry_version integer default null
) returns uuid language plpgsql security definer set search_path=public as $$
declare l public.manzana_lados%rowtype; e public.cobertura_eventos%rowtype; v_territory uuid;
begin
 if not public.es_usuario_activo() then raise exception 'Tu cuenta no tiene acceso activo' using errcode='42501'; end if;
 if p_event_id is null or p_lado_id is null or p_estado is null or p_estado not in ('recorrido','no_accesible','revisitar','sin_dato') then
   raise exception 'Marca inválida' using errcode='22023';
 end if;
 if p_origen is null or p_origen not in ('app_hermano','cierre_salida','correccion') then raise exception 'Origen inválido' using errcode='22023'; end if;
 if length(coalesce(p_nota,''))>2000 then raise exception 'La nota es demasiado larga' using errcode='22023'; end if;
 -- El mismo ID es la misma intención, incluso tras perder la respuesta HTTP.
 perform pg_advisory_xact_lock(hashtextextended(p_event_id::text,20260905));
 select * into e from public.cobertura_eventos where id=p_event_id;
 if found then
   if e.informado_por=auth.uid() and e.lado_id=p_lado_id and e.estado=p_estado and e.origen=p_origen
     and e.salida_id is not distinct from p_salida_id and e.corrige_evento_id is not distinct from p_corrige_evento_id
     and e.nota is not distinct from nullif(btrim(p_nota),'')
     and exists(select 1 from public.manzana_lados where id=e.lado_id and geometry_version=p_geometry_version) then return e.id; end if;
   raise exception 'Ese identificador ya corresponde a otra marca' using errcode='23505';
 end if;
 select territory_id into v_territory from public.manzana_lados where id=p_lado_id;
 if not found then raise exception 'La cuadra no existe' using errcode='22023'; end if;
 -- Mismo orden que las decisiones de reserva y la publicación del editor.
 perform 1 from public.territorios where id=v_territory for share;
 perform pg_advisory_xact_lock(hashtextextended(p_lado_id::text,20260907));
 select * into l from public.manzana_lados where id=p_lado_id for share;
 if not found or p_geometry_version is null or l.geometry_version<>p_geometry_version
   or (p_origen<>'correccion' and (l.vigente_hasta is not null
     or not exists(select 1 from public.territorio_manzanas m where m.id=l.manzana_id and m.territory_id=l.territory_id and m.vigente_hasta is null and m.geometry_version=l.geometry_version))) then
   raise exception 'El dibujo cambió. La marca sigue pendiente y necesita revisión; no se trasladó a otra cuadra' using errcode='40001';
 end if;
 if p_origen='app_hermano' then
   if p_salida_id is not null or p_corrige_evento_id is not null or not public.territorio_es_mio(l.territory_id) then
     raise exception 'Solo podés informar tu territorio asignado' using errcode='42501';
   end if;
 elsif p_origen='cierre_salida' then
   if p_corrige_evento_id is not null or not public.puede_informar_salida(p_salida_id,l.territory_id) then
     raise exception 'Esta salida no está asignada a tu cuenta y territorio' using errcode='42501';
   end if;
 else
   if not public.is_admin(auth.uid()) then raise exception 'Solo un admin puede corregir' using errcode='42501'; end if;
   if p_corrige_evento_id is null or not exists(select 1 from public.cobertura_eventos where id=p_corrige_evento_id and lado_id=l.id) then
     raise exception 'Elegí el evento de esta cuadra que estás corrigiendo' using errcode='22023';
   end if;
   if length(btrim(coalesce(p_nota,'')))<2 then raise exception 'Explicá el motivo de la corrección' using errcode='22023'; end if;
 end if;
 insert into public.cobertura_eventos(id,lado_id,manzana_id,territory_id,estado,origen,informado_por,salida_id,corrige_evento_id,nota,informado_at)
 values(p_event_id,l.id,l.manzana_id,l.territory_id,p_estado,p_origen,auth.uid(),p_salida_id,p_corrige_evento_id,nullif(btrim(p_nota),''),
   greatest(clock_timestamp(),(select max(informado_at)+interval '1 microsecond' from public.cobertura_eventos where lado_id=l.id)));
 return p_event_id;
end $$;

-- La firma, el dibujo y los permisos se validan en la función, no en el cliente.
revoke insert,update,delete on public.cobertura_eventos from authenticated;
drop policy if exists "Informar cobertura" on public.cobertura_eventos;
drop policy if exists "Informar lo que camine" on public.cobertura_eventos;
revoke all on function public.informar_cobertura(uuid,uuid,text,text,uuid,uuid,text,integer) from public,anon;
grant execute on function public.informar_cobertura(uuid,uuid,text,text,uuid,uuid,text,integer) to authenticated;
notify pgrst,'reload schema';
commit;
