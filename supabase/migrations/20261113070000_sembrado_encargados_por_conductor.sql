-- A3: quedar de responsable de grupo por llamarse igual.
--
-- `sembrar_encargados_de_grupo` (20260908040000) emparejaba cuentas con los
-- responsables importados también por NOMBRE, y el nombre lo edita cada uno en
-- «Mi cuenta». Alguien que se pone el nombre de un superintendente (o un
-- homónimo, padre e hijo) quedaba como responsable de ese grupo, con permiso para
-- confirmar miembros y aprobar territorios. Además, como corre cada vez que se
-- toca un perfil, volvía a sembrar a quien un administrador había sacado del
-- grupo.
--
-- Ahora:
--   * se empareja SÓLO por conductor (profiles.driver_id = responsable.driver_id),
--     un vínculo que fija un administrador;
--   * no se siembra a quien ya tuvo alguna membresía de grupo (vigente o retirada):
--     lo que decidió una persona no se deshace solo;
--   * un conductor que figura en más de un grupo sigue sin sembrarse.
-- Para revisar si ya hay responsables sembrados por nombre (sólo lectura):
--   select p.full_name, g.group_number, m.rol_en_grupo
--   from public.grupo_miembros m
--   join public.profiles p on p.id = m.profile_id
--   join public.grupos_servicio g on g.id = m.group_id
--   where m.hasta is null and m.rol_en_grupo in ('auxiliar','siervo','superintendente')
--     and not exists (select 1 from public.grupo_responsables_importados r
--                     where r.group_id = m.group_id and r.driver_id is not null and r.driver_id = p.driver_id)
--     and exists (select 1 from public.grupo_responsables_importados r
--                 where r.group_id = m.group_id and lower(btrim(r.manager_name)) = lower(btrim(p.full_name)));
-- No se quita a nadie automáticamente: lo decide una persona.
-- Aplicable dos veces.
begin;

create or replace function public.sembrar_encargados_de_grupo()
returns integer
language plpgsql
security definer
set search_path = public, pg_temp
set row_security = off
as $$
declare
  v_insertados integer := 0;
  v_ambiguo record;
begin
  for v_ambiguo in
    select perfil.id as profile_id, perfil.driver_id,
      string_agg(grupo.group_number::text, ', ' order by grupo.group_number) as grupos
    from public.profiles perfil
    join public.grupo_responsables_importados responsable
      on responsable.driver_id = perfil.driver_id
    join public.grupos_servicio grupo on grupo.id = responsable.group_id
    where perfil.driver_id is not null
    group by perfil.id, perfil.driver_id
    having count(distinct responsable.group_id) > 1
  loop
    raise notice 'Encargado con driver_id % figura en varios grupos (%); no se crea una membresía ambigua',
      v_ambiguo.driver_id, v_ambiguo.grupos;
  end loop;

  insert into public.grupo_miembros (
    group_id, profile_id, rol_en_grupo, estado, confirmado_at
  )
  select distinct on (perfil.id)
    responsable.group_id,
    perfil.id,
    responsable.manager_role,
    'confirmado',
    now()
  from public.profiles perfil
  join public.grupo_responsables_importados responsable
    on responsable.driver_id = perfil.driver_id
  where perfil.driver_id is not null
    and responsable.manager_role in ('superintendente', 'siervo', 'auxiliar')
    and not exists (
      select 1 from public.grupo_miembros miembro
      where miembro.profile_id = perfil.id
    )
    and 1 = (
      select count(distinct otra.group_id)
      from public.grupo_responsables_importados otra
      where otra.driver_id = perfil.driver_id
    )
  order by perfil.id,
    case responsable.manager_role
      when 'superintendente' then 1
      when 'siervo' then 2
      else 3
    end,
    responsable.id;

  get diagnostics v_insertados = row_count;
  return v_insertados;
end;
$$;

revoke all on function public.sembrar_encargados_de_grupo() from public, anon, authenticated;

notify pgrst, 'reload schema';
commit;
