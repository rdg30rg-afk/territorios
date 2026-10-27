-- Supabase concede por defecto, a todo objeto nuevo del esquema public, permisos
-- a anon y authenticated (ALTER DEFAULT PRIVILEGES). El Postgres local no los
-- tiene, y sin ellos un `revoke` olvidado en la migración pasaría desapercibido.
-- Se simulan antes de aplicar la migración de errores_cliente.
alter default privileges in schema public grant all on tables to anon, authenticated;
alter default privileges in schema public grant execute on functions to anon, authenticated;
alter default privileges in schema public grant usage, select on sequences to anon, authenticated;
