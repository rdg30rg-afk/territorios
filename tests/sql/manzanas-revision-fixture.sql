-- Prepara lo que manzanas-revision-assertions.sql da por hecho: un territorio
-- ya publicado una vez (revisión 2) y la sesión abierta como administrador.
-- En la base de DEV lo arma el script de verificación con rollback exterior;
-- en el Postgres local descartable se hace directo, sin tocar ninguna base remota.
\set ON_ERROR_STOP on
reset role;
insert into public.territorios(id,name,editor_revision)
 values('81000000-0000-0000-0000-000000000091','QA-ATOMIC-A',2);
set role authenticated;
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000000001',false);
