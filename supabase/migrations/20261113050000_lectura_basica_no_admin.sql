-- G2: quien no es administrador no podía leer su propio grupo, el punto de su
-- grupo ni su ficha de conductor.
--
-- Las políticas de lectura de grupos_servicio, puntos_encuentro y conductores
-- piden `can_access_module(...)`, y desde 20260908040000 eso sólo es verdad para
-- un administrador de territorios. Resultado para el hermano común y para el
-- superintendente: «Mi cuenta» (vista mi_contexto, que lee con los permisos de
-- quien consulta) muestra el grupo en blanco, el punto del grupo que guardó el
-- superintendente no aparece nunca y «Cómo llegar» queda sin GPS.
--
-- Se agregan políticas de sólo lectura, mínimas, que se suman a las de los
-- administradores (las políticas permisivas se combinan con OR):
--   * grupos_servicio: el grupo vigente de cada uno (y el que supervisa).
--   * puntos_encuentro activos: los territoriales y especiales los ve cualquier
--     cuenta activa (son lugares públicos de encuentro); el punto de un grupo
--     sólo su grupo (puede ser la casa de alguien).
--   * conductores: únicamente la ficha propia (profiles.driver_id).
-- No se amplía nada para escribir. Aplicable dos veces; no toca datos.
begin;

create or replace function public.mi_conductor_id()
returns uuid
language sql
stable
security definer
set search_path = public, pg_temp
set row_security = off
as $$
  select perfil.driver_id
  from public.profiles perfil
  where perfil.id = auth.uid()
    and perfil.access_status = 'active'
$$;

revoke all on function public.mi_conductor_id() from public, anon;
grant execute on function public.mi_conductor_id() to authenticated;

revoke all on function public.grupo_vigente_de(uuid) from public, anon;
grant execute on function public.grupo_vigente_de(uuid) to authenticated;

drop policy if exists "Cada uno ve su grupo" on public.grupos_servicio;
create policy "Cada uno ve su grupo" on public.grupos_servicio
  for select to authenticated
  using (
    public.es_usuario_activo()
    and (
      id = public.grupo_vigente_de(auth.uid())
      or public.es_responsable_de_grupo(id, auth.uid())
    )
  );

drop policy if exists "Cada uno ve los puntos de encuentro que le tocan" on public.puntos_encuentro;
create policy "Cada uno ve los puntos de encuentro que le tocan" on public.puntos_encuentro
  for select to authenticated
  using (
    public.es_usuario_activo()
    and activo
    and (
      coalesce(tipo, 'territorial') <> 'grupo'
      or (group_id is not null and group_id = public.grupo_vigente_de(auth.uid()))
    )
  );

drop policy if exists "Cada uno ve su ficha de conductor" on public.conductores;
create policy "Cada uno ve su ficha de conductor" on public.conductores
  for select to authenticated
  using (id = public.mi_conductor_id());

grant select on public.grupos_servicio, public.puntos_encuentro, public.conductores to authenticated;

notify pgrst, 'reload schema';
commit;
