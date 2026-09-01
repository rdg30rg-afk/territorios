alter table public.profiles
  add column if not exists username text;

alter table public.profiles
  add column if not exists auth_email text;

update public.profiles as profile
set
  full_name = coalesce(nullif(profile.full_name, ''), users.raw_user_meta_data ->> 'full_name', split_part(users.email, '@', 1)),
  username = coalesce(nullif(profile.username, ''), users.raw_user_meta_data ->> 'username', split_part(users.email, '@', 1)),
  auth_email = coalesce(nullif(profile.auth_email, ''), users.email)
from auth.users as users
where profile.id = users.id
  and (
    profile.full_name is null
    or profile.full_name = ''
    or profile.username is null
    or profile.username = ''
    or profile.auth_email is null
    or profile.auth_email = ''
  );

insert into public.profiles (id, full_name, username, auth_email, role, access_status)
select
  users.id,
  coalesce(users.raw_user_meta_data ->> 'full_name', split_part(users.email, '@', 1)),
  coalesce(users.raw_user_meta_data ->> 'username', split_part(users.email, '@', 1)),
  users.email,
  'viewer',
  'pending'
from auth.users as users
where not exists (
  select 1
  from public.profiles as profile
  where profile.id = users.id
);
