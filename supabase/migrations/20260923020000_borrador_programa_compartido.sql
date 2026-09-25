-- Un borrador para la congregación. La versión evita que una pestaña vieja
-- reemplace sin aviso lo que otra persona acaba de armar.
begin;

create table if not exists public.programa_borrador (
  id smallint primary key default 1 check (id = 1),
  contenido jsonb not null default '{}'::jsonb check (jsonb_typeof(contenido) = 'object'),
  version bigint not null default 0 check (version >= 0),
  updated_at timestamptz not null default now(),
  updated_by uuid references public.profiles(id) on delete set null
);

insert into public.programa_borrador (id, contenido, version)
values (1, '{}'::jsonb, 0) on conflict (id) do nothing;

alter table public.programa_borrador enable row level security;
drop policy if exists "Administradores leen el borrador del programa" on public.programa_borrador;
create policy "Administradores leen el borrador del programa"
  on public.programa_borrador for select to authenticated
  using (public.salidas_rpc_autorizado('general', null));

revoke insert, update, delete on public.programa_borrador from public, anon, authenticated;

create or replace function public.guardar_borrador_programa(
  p_contenido jsonb,
  p_version bigint
)
returns bigint
language plpgsql
security definer
set search_path = public
as $$
declare
  v_version bigint;
begin
  if not public.salidas_rpc_autorizado('general', null) then
    raise exception 'No tenés permiso para editar el borrador' using errcode = '42501';
  end if;
  if p_contenido is null or jsonb_typeof(p_contenido) <> 'object'
    or pg_column_size(p_contenido) > 524288
    or p_version is null or p_version < 0 then
    raise exception 'Borrador inválido' using errcode = '22023';
  end if;

  update public.programa_borrador
  set contenido = p_contenido, version = version + 1,
    updated_at = now(), updated_by = auth.uid()
  where id = 1 and version = p_version
  returning version into v_version;

  if v_version is null then
    raise exception 'El borrador cambió en otra sesión. Recargá la versión compartida antes de seguir.'
      using errcode = '40001';
  end if;
  return v_version;
end;
$$;

revoke all on function public.guardar_borrador_programa(jsonb, bigint) from public, anon;
grant execute on function public.guardar_borrador_programa(jsonb, bigint) to authenticated;

notify pgrst, 'reload schema';
commit;
