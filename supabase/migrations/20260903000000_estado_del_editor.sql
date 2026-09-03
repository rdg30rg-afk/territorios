-- =====================================================================
-- El estado del editor de manzanas deja de vivir en un navegador
--
-- Hasta ahora el editor guardaba todo en el localStorage de un Chrome:
-- los 69 territorios, las 652 asignaciones, las manzanas descartadas,
-- las geometrias editadas a mano y las caras corregidas. Borrar los
-- datos del navegador se llevaba todo eso, y ya habia 25 territorios
-- con trabajo que no estaba en ningun otro lado.
--
-- Lo que se guarda acá NO es dato operativo: el dibujo bueno viaja a
-- territorio_manzanas y manzana_lados cuando se aprieta "Guardar en la
-- base". Esto es el borrador -lo tocado y todavia no subido, mas las
-- decisiones que no tienen tabla propia, como que manzanas de OSM se
-- descartaron-. Por eso es un jsonb y no un esquema normalizado:
-- normalizar un borrador obliga a migrar la base cada vez que el editor
-- aprende algo nuevo.
--
-- Son 22 KB.
-- =====================================================================

begin;

create table if not exists editor_estado (
  id text primary key,
  estado jsonb not null,
  actualizado_por uuid references profiles (id) on delete set null,
  actualizado_at timestamptz not null default now()
);

comment on table editor_estado is
  'Borrador del editor de manzanas. El dibujo definitivo vive en territorio_manzanas.';

alter table editor_estado enable row level security;

-- El editor es del admin, y el borrador tambien.
drop policy if exists "Admins manejan el borrador del editor" on editor_estado;
create policy "Admins manejan el borrador del editor" on editor_estado
for all to authenticated
using (public.is_admin(auth.uid())) with check (public.is_admin(auth.uid()));

commit;
