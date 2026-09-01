alter table public.profiles
  add column if not exists access_status text not null default 'pending'
  check (access_status in ('pending', 'active', 'inactive'));

update public.profiles
set access_status = 'active'
where role = 'admin'
   or exists (
    select 1
    from public.user_module_access
    where user_module_access.user_id = profiles.id
  );

update public.profiles
set access_status = 'pending'
where access_status is null;

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (id, full_name, username, auth_email, role, access_status)
  values (
    new.id,
    coalesce(new.raw_user_meta_data ->> 'full_name', split_part(new.email, '@', 1)),
    coalesce(new.raw_user_meta_data ->> 'username', split_part(new.email, '@', 1)),
    new.email,
    'viewer',
    'pending'
  )
  on conflict (id) do update
  set
    full_name = coalesce(public.profiles.full_name, excluded.full_name),
    username = coalesce(public.profiles.username, excluded.username),
    auth_email = coalesce(public.profiles.auth_email, excluded.auth_email);

  return new;
end;
$$;
