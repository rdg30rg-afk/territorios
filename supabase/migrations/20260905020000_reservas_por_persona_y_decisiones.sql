begin;
alter table public.territorio_personal_reservas add column if not exists assigned_to uuid references public.profiles(id) on delete restrict;
comment on column public.territorio_personal_reservas.assigned_to is 'Beneficiario confirmado por un admin. No se infiere a partir de reserved_for ni del solicitante.';
create index if not exists reservas_beneficiario_idx on public.territorio_personal_reservas(assigned_to) where status='activa';

create table if not exists public.reserva_movimientos (
 id uuid primary key default gen_random_uuid(),
 reserva_id uuid not null references public.territorio_personal_reservas(id) on delete restrict,
 estado_anterior text,
 estado_nuevo text not null,
 actor_id uuid not null references public.profiles(id) on delete restrict,
 assigned_to uuid references public.profiles(id) on delete restrict,
 nota text,
 created_at timestamptz not null default now()
);
create index if not exists reserva_movimientos_reserva_fecha_idx on public.reserva_movimientos(reserva_id,created_at,id);
alter table public.reserva_movimientos enable row level security;
revoke all on public.reserva_movimientos from anon, authenticated;
grant select on public.reserva_movimientos to authenticated;
drop policy if exists ver_movimientos_propios on public.reserva_movimientos;
create policy ver_movimientos_propios on public.reserva_movimientos for select to authenticated using (
 public.es_usuario_activo() and (public.is_admin(auth.uid()) or actor_id=auth.uid() or assigned_to=auth.uid()
   or exists(select 1 from public.territorio_personal_reservas r where r.id=reserva_id and r.requested_by=auth.uid()))
);

create or replace function public.territorio_es_mio(p_territory_id uuid)
returns boolean language sql stable security definer set search_path=public as $$
 select public.es_usuario_activo() and exists(select 1 from public.territorio_personal_reservas
 where territory_id=p_territory_id and status='activa' and assigned_to=auth.uid())
$$;
drop policy if exists ver_mis_asignaciones on public.territorio_personal_reservas;
create policy ver_mis_asignaciones on public.territorio_personal_reservas for select to authenticated
 using(public.es_usuario_activo() and assigned_to=auth.uid());

create or replace function public.solicitar_territorio(p_territory_id uuid)
returns uuid language plpgsql security definer set search_path=public as $$
declare v_id uuid; v_nombre text;
begin
 if not public.es_usuario_activo() then raise exception 'Tu cuenta no tiene acceso activo' using errcode='42501'; end if;
 perform 1 from public.territorios where id=p_territory_id for update;
 if not found then raise exception 'El territorio no existe' using errcode='22023'; end if;
 select id into v_id from public.territorio_personal_reservas where territory_id=p_territory_id and requested_by=auth.uid() and status='solicitada';
 if v_id is not null then return v_id; end if;
 if public.territorio_es_mio(p_territory_id) then raise exception 'Ya tenés este territorio asignado' using errcode='22023'; end if;
 select coalesce(nullif(btrim(full_name),''),'Sin nombre') into v_nombre from public.profiles where id=auth.uid();
 insert into public.territorio_personal_reservas(territory_id,reserved_for,status,requested_by,requested_at,created_by)
 values(p_territory_id,v_nombre,'solicitada',auth.uid(),now(),auth.uid()) returning id into v_id;
 insert into public.reserva_movimientos(reserva_id,estado_nuevo,actor_id) values(v_id,'solicitada',auth.uid());
 return v_id;
end $$;

create or replace function public.gestionar_reserva(p_reserva_id uuid,p_accion text,p_assigned_to uuid default null,p_nota text default null)
returns uuid language plpgsql security definer set search_path=public as $$
declare r public.territorio_personal_reservas%rowtype; v_territory uuid; v_assigned uuid; v_nombre text; v_estado text;
begin
 if not public.es_usuario_activo() then raise exception 'Tu cuenta no tiene acceso activo' using errcode='42501'; end if;
 select territory_id into v_territory from public.territorio_personal_reservas where id=p_reserva_id;
 if not found then raise exception 'La reserva no existe' using errcode='22023'; end if;
 perform 1 from public.territorios where id=v_territory for update;
 select * into r from public.territorio_personal_reservas where id=p_reserva_id for update;
 if p_accion is null or p_accion not in ('aprobar','rechazar','devolver','vincular') then raise exception 'Acción inválida' using errcode='22023'; end if;
 if not public.is_admin(auth.uid()) and not(p_accion='devolver' and coalesce(r.assigned_to=auth.uid(),false)) then
   raise exception 'No tenés permiso para decidir esta reserva' using errcode='42501';
 end if;
 if length(coalesce(p_nota,''))>2000 then raise exception 'La nota es demasiado larga' using errcode='22023'; end if;
 v_assigned:=r.assigned_to;
 if p_accion in ('aprobar','vincular') then
   v_assigned:=coalesce(p_assigned_to,r.requested_by);
   select full_name into v_nombre from public.profiles where id=v_assigned and access_status='active';
   if not found then raise exception 'Elegí una persona con cuenta activa' using errcode='22023'; end if;
   if r.status='activa' and r.assigned_to=v_assigned then return r.id; end if;
   if not ((p_accion='aprobar' and r.status='solicitada') or (p_accion='vincular' and r.status='activa' and r.assigned_to is null)) then
     raise exception 'La reserva cambió. Actualizá antes de decidir' using errcode='40001';
   end if;
   if exists(select 1 from public.territorio_personal_reservas where territory_id=r.territory_id and status='activa' and id<>r.id) then
     raise exception 'El territorio ya tiene una reserva activa' using errcode='23505';
   end if;
   v_estado:='activa';
 elsif p_accion='rechazar' then
   if r.status='rechazada' then return r.id; end if;
   if r.status<>'solicitada' then raise exception 'Solo se puede rechazar un pedido pendiente' using errcode='40001'; end if;
   if length(btrim(coalesce(p_nota,'')))<2 then raise exception 'Escribí el motivo del rechazo' using errcode='22023'; end if;
   v_estado:='rechazada';
 else
   if r.status='liberada' then return r.id; end if;
   if r.status<>'activa' then raise exception 'Solo se puede devolver un territorio asignado' using errcode='40001'; end if;
   v_estado:='liberada';
 end if;
 update public.territorio_personal_reservas set status=v_estado, assigned_to=v_assigned,
   reserved_at=case when p_accion='aprobar' then now() else reserved_at end,
   released_at=case when v_estado='liberada' then now() else released_at end,
   decided_by=case when p_accion in ('aprobar','rechazar','vincular') then auth.uid() else decided_by end,
   decided_at=case when p_accion in ('aprobar','rechazar','vincular') then now() else decided_at end,
   nota=coalesce(nullif(btrim(p_nota),''),nota)
 where id=r.id;
 -- reserved_for se conserva: texto de procedencia, no autorización ni identidad.
 insert into public.reserva_movimientos(reserva_id,estado_anterior,estado_nuevo,actor_id,assigned_to,nota)
 values(r.id,r.status,v_estado,auth.uid(),v_assigned,nullif(btrim(p_nota),''));
 return r.id;
end $$;

create or replace function public.asignar_territorio(p_territory_id uuid,p_assigned_to uuid,p_nota text default null)
returns uuid language plpgsql security definer set search_path=public as $$
declare v_id uuid; v_nombre text;
begin
 if not public.is_admin(auth.uid()) then raise exception 'Solo un admin activo puede asignar' using errcode='42501'; end if;
 if length(coalesce(p_nota,''))>2000 then raise exception 'La nota es demasiado larga' using errcode='22023'; end if;
 perform 1 from public.territorios where id=p_territory_id for update;
 if not found then raise exception 'El territorio no existe' using errcode='22023'; end if;
 select full_name into v_nombre from public.profiles where id=p_assigned_to and access_status='active';
 if not found then raise exception 'Elegí una persona con cuenta activa' using errcode='22023'; end if;
 select id into v_id from public.territorio_personal_reservas where territory_id=p_territory_id and status='activa' and assigned_to=p_assigned_to;
 if v_id is not null then return v_id; end if;
 if exists(select 1 from public.territorio_personal_reservas where territory_id=p_territory_id and status='activa') then raise exception 'El territorio ya está asignado' using errcode='23505'; end if;
 -- Si hay un pedido de esa persona, la asignación también lo resuelve.
 select id into v_id from public.territorio_personal_reservas where territory_id=p_territory_id and status='solicitada' and requested_by=p_assigned_to;
 if v_id is not null then return public.gestionar_reserva(v_id,'aprobar',p_assigned_to,p_nota); end if;
 insert into public.territorio_personal_reservas(territory_id,reserved_for,status,assigned_to,reserved_at,decided_by,decided_at,created_by,nota)
 values(p_territory_id,coalesce(v_nombre,'Sin nombre'),'activa',p_assigned_to,now(),auth.uid(),now(),auth.uid(),nullif(btrim(p_nota),'')) returning id into v_id;
 insert into public.reserva_movimientos(reserva_id,estado_nuevo,actor_id,assigned_to,nota)
 values(v_id,'activa',auth.uid(),p_assigned_to,nullif(btrim(p_nota),''));
 return v_id;
end $$;

revoke insert,update,delete on public.territorio_personal_reservas from authenticated;
revoke all on function public.solicitar_territorio(uuid), public.gestionar_reserva(uuid,text,uuid,text), public.asignar_territorio(uuid,uuid,text) from public,anon;
grant execute on function public.solicitar_territorio(uuid), public.gestionar_reserva(uuid,text,uuid,text), public.asignar_territorio(uuid,uuid,text) to authenticated;
grant execute on function public.actualizar_mi_nombre(text) to authenticated;
notify pgrst,'reload schema';
commit;
