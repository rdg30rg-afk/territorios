alter table public.user_module_access
  drop constraint if exists user_module_access_module_key_check;

alter table public.user_module_access
  add constraint user_module_access_module_key_check
  check (module_key in ('mapas', 'conductores', 'grupos', 'salidas', 'salidas_grupo'));

drop policy if exists "Users with conductores can read drivers" on public.conductores;
create policy "Users with conductores can read drivers"
on public.conductores
for select
to authenticated
using (
  public.can_access_module('conductores') or
  public.can_access_module('salidas') or
  public.can_access_module('salidas_grupo')
);

drop policy if exists "Users with grupos can read groups" on public.grupos_servicio;
create policy "Users with grupos can read groups"
on public.grupos_servicio
for select
to authenticated
using (
  public.can_access_module('grupos') or
  public.can_access_module('salidas') or
  public.can_access_module('salidas_grupo')
);

drop policy if exists "Users with salidas can read outings" on public.salidas;
create policy "Users with salidas can read outings"
on public.salidas
for select
to authenticated
using (
  public.can_access_module('salidas') or
  public.can_access_module('salidas_grupo')
);

drop policy if exists "Group service users can create outings" on public.salidas;
create policy "Group service users can create outings"
on public.salidas
for insert
to authenticated
with check (
  public.is_admin(auth.uid()) or
  (
    public.can_access_module('salidas_grupo') and
    exists (
      select 1
      from public.profiles p
      join public.grupos_servicio g on g.driver_id = p.driver_id
      where p.id = auth.uid()
        and g.id = salidas.group_id
        and g.manager_role in ('superintendente', 'auxiliar')
    )
  )
);

drop policy if exists "Group service users can update their group outings" on public.salidas;
create policy "Group service users can update their group outings"
on public.salidas
for update
to authenticated
using (
  public.is_admin(auth.uid()) or
  (
    public.can_access_module('salidas_grupo') and
    exists (
      select 1
      from public.profiles p
      join public.grupos_servicio g on g.driver_id = p.driver_id
      where p.id = auth.uid()
        and g.id = salidas.group_id
        and g.manager_role in ('superintendente', 'auxiliar')
    )
  )
)
with check (
  public.is_admin(auth.uid()) or
  (
    public.can_access_module('salidas_grupo') and
    exists (
      select 1
      from public.profiles p
      join public.grupos_servicio g on g.driver_id = p.driver_id
      where p.id = auth.uid()
        and g.id = salidas.group_id
        and g.manager_role in ('superintendente', 'auxiliar')
    )
  )
);

drop policy if exists "Group service users can delete their group outings" on public.salidas;
create policy "Group service users can delete their group outings"
on public.salidas
for delete
to authenticated
using (
  public.is_admin(auth.uid()) or
  (
    public.can_access_module('salidas_grupo') and
    exists (
      select 1
      from public.profiles p
      join public.grupos_servicio g on g.driver_id = p.driver_id
      where p.id = auth.uid()
        and g.id = salidas.group_id
        and g.manager_role in ('superintendente', 'auxiliar')
    )
  )
);
