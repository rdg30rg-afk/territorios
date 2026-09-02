-- Evita que cualquier cliente con la anon key llene pending_users.
-- Las altas nuevas crean su perfil pendiente mediante handle_new_user().

drop policy if exists "Anyone can request access" on public.pending_users;
revoke insert on table public.pending_users from anon;

comment on table public.pending_users is
  'Solicitudes heredadas; las altas nuevas usan profiles.access_status mediante el trigger de auth.users.';
