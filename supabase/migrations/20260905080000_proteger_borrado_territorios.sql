begin;
-- Protección inmediata mientras se completa el retiro territorial integral.
-- Un DELETE del padre puede llevarse manzanas sin cobertura y otras relaciones
-- históricas por cascada. Ninguna cuenta del navegador debe poder hacerlo.
revoke delete on public.territorios from public,anon,authenticated;
notify pgrst,'reload schema';
commit;
