begin;
-- Mismo lock de territorio que publicar_territorios_atomico. No modifica
-- geometrías ni el algoritmo de lados: agrega puntos o retira dibujos.
create or replace function public.agregar_manzana(
 p_territorio_id uuid, p_label text, p_lat numeric, p_lng numeric
) returns public.territorio_manzanas
language plpgsql security definer set search_path=public as $$
declare resultado public.territorio_manzanas; revision integer;
begin
 if not public.is_admin(auth.uid()) then raise exception 'Solo un administrador activo puede agregar manzanas' using errcode='42501';end if;
 if p_label is null or btrim(p_label)='' or length(p_label)>30
 or p_lat is null or p_lng is null or not(p_lat between -90 and 90) or not(p_lng between -180 and 180) then
  raise exception 'Etiqueta o coordenadas inválidas' using errcode='22023';end if;
 perform 1 from territorios where id=p_territorio_id for update;
 if not found then raise exception 'Territorio inexistente' using errcode='22023';end if;
 if exists(select 1 from territorio_manzanas where territory_id=p_territorio_id and vigente_hasta is null and lower(label)=lower(btrim(p_label))) then
  raise exception 'Esa etiqueta ya existe; actualizá el mapa antes de agregar' using errcode='23505';end if;
 select greatest(t.editor_revision,coalesce((select max(geometry_version) from territorio_manzanas where territory_id=t.id),0))+1
 into revision from territorios t where id=p_territorio_id;
 insert into territorio_manzanas(territory_id,label,lat,lng,geometry_version,vigente_desde)
 values(p_territorio_id,btrim(p_label),p_lat,p_lng,revision,clock_timestamp()) returning * into resultado;
 update territorios set editor_revision=revision,updated_at=clock_timestamp() where id=p_territorio_id;
 return resultado;
end $$;

create or replace function public.retirar_manzana(p_manzana_id uuid)
returns jsonb language plpgsql security definer set search_path=public as $$
declare territorio uuid; instante timestamptz; cantidad integer; revision integer;
begin
 if not public.is_admin(auth.uid()) then raise exception 'Solo un administrador activo puede retirar manzanas' using errcode='42501';end if;
 select territory_id into territorio from territorio_manzanas where id=p_manzana_id;
 if territorio is null then raise exception 'Manzana inexistente' using errcode='22023';end if;
 perform 1 from territorios where id=territorio for update;
 -- Revalidar después del lock: otra publicación puede haberla retirado.
 if not exists(select 1 from territorio_manzanas where id=p_manzana_id and vigente_hasta is null) then
  return jsonb_build_object('manzana_id',p_manzana_id,'lados_retirados',0,'ya_retirada',true);end if;
 instante:=clock_timestamp();
 update manzana_lados set vigente_hasta=instante where manzana_id=p_manzana_id and vigente_hasta is null;
 get diagnostics cantidad=row_count;
 update territorio_manzanas set vigente_hasta=instante,updated_at=instante where id=p_manzana_id;
 select greatest(t.editor_revision,coalesce((select max(geometry_version) from territorio_manzanas where territory_id=t.id),0))+1
 into revision from territorios t where id=territorio;
 update territorios set editor_revision=revision,updated_at=instante where id=territorio;
 return jsonb_build_object('manzana_id',p_manzana_id,'lados_retirados',cantidad,'version',revision);
end $$;
revoke all on function public.agregar_manzana(uuid,text,numeric,numeric),public.retirar_manzana(uuid) from public,anon;
grant execute on function public.agregar_manzana(uuid,text,numeric,numeric),public.retirar_manzana(uuid) to authenticated;
-- La UI ya no escribe directamente: no puede saltarse el lock/revisión.
revoke insert,update,delete on public.territorio_manzanas,public.manzana_lados from authenticated,anon;
notify pgrst,'reload schema';
commit;
