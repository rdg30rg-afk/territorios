-- =====================================================================
-- Solicitar un territorio personal
--
-- Hasta ahora una reserva solo podía nacer de un admin: no había forma de
-- que un hermano pidiera un territorio desde su teléfono. La reserva pasa
-- a tener un paso previo, 'solicitada', que no bloquea nada y espera una
-- decisión.
--
-- Y la solicitud guarda A LA PERSONA, no su nombre escrito a mano.
-- `reserved_for` es texto libre y por eso el emparejado de "cuál es mi
-- territorio" hoy se hace comparando cadenas: es el mismo problema que
-- las 55 variantes de conductor del Excel, adentro del sistema nuevo.
-- `requested_by` es la referencia de verdad, y por acá empieza a
-- reemplazarlo sin romper lo que ya existe.
-- =====================================================================

begin;

alter table territorio_personal_reservas
  drop constraint if exists territorio_personal_reservas_status_check;

alter table territorio_personal_reservas
  add constraint territorio_personal_reservas_status_check
  check (status in ('solicitada', 'activa', 'liberada', 'rechazada'));

alter table territorio_personal_reservas
  add column if not exists requested_by uuid references profiles (id) on delete set null;
alter table territorio_personal_reservas
  add column if not exists requested_at timestamptz;
alter table territorio_personal_reservas
  add column if not exists decided_by uuid references profiles (id) on delete set null;
alter table territorio_personal_reservas
  add column if not exists decided_at timestamptz;
alter table territorio_personal_reservas
  add column if not exists nota text;

-- Una sola solicitud pendiente por persona y territorio: tocar dos veces
-- el botón no genera dos pedidos.
create unique index if not exists reservas_solicitud_unica_idx
  on territorio_personal_reservas (territory_id, requested_by)
  where status = 'solicitada';

-- El índice de exclusividad que ya existía sigue igual: solo una reserva
-- ACTIVA por territorio. Una solicitud no bloquea a nadie.

-- Cualquiera puede pedir, y solo por sí mismo. Aprobar sigue siendo del
-- admin: esta política no permite crear una reserva 'activa'.
drop policy if exists "Pedir un territorio" on territorio_personal_reservas;
create policy "Pedir un territorio"
on territorio_personal_reservas
for insert
to authenticated
with check (
  status = 'solicitada'
  and requested_by = auth.uid()
);

-- Y cada uno ve lo suyo, tenga o no módulos asignados.
drop policy if exists "Ver mis solicitudes" on territorio_personal_reservas;
create policy "Ver mis solicitudes"
on territorio_personal_reservas
for select
to authenticated
using (requested_by = auth.uid());

commit;
