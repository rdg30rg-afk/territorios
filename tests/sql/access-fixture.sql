create role authenticated;
create role anon;
create schema auth;
create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
grant usage on schema auth, public to authenticated, anon;
create table public.profiles(id uuid primary key, full_name text, role text, access_status text, driver_id uuid);
create table public.conductores(id uuid primary key);
create table public.user_module_access(user_id uuid references profiles, module_key text, unique(user_id,module_key));
create table public.salidas(id uuid primary key,territory_id uuid,driver_id uuid);
create table public.territorios(id uuid primary key, name text);
create table public.salida_resultados(
 id uuid primary key,
 salida_id uuid not null references salidas(id) on delete cascade,
 estado text not null default 'sin_dato'
   check (estado in ('realizada','parcial','no_realizada','cancelada','sin_dato')),
 motivo text check (motivo in ('acceso','edificio','consorcio','clima','feriado','sin_conductor','sin_publicadores','otro')),
 observaciones text,
 ocurrio_at timestamptz,
 corrige_id uuid references salida_resultados(id) on delete set null,
 origen text not null default 'app' check (origen in ('app','excel')),
 registro_id uuid,
 informado_por uuid references profiles(id) on delete set null,
 informado_at timestamptz not null default now()
);
create index salida_resultados_salida_idx on salida_resultados(salida_id, informado_at desc);
create view public.salida_resultado_actual with (security_invoker = true) as
select distinct on (r.salida_id)
 r.salida_id, r.id as resultado_id, r.estado, r.motivo, r.observaciones,
 r.ocurrio_at, r.origen, r.informado_por, r.informado_at,
 (r.corrige_id is not null) as es_correccion
from public.salida_resultados r
order by r.salida_id, r.informado_at desc, r.id;
create table public.territorio_personal_reservas(
 id uuid primary key default gen_random_uuid(),territory_id uuid not null references territorios,
 reserved_for text not null,status text not null default 'activa',reserved_at timestamptz not null default now(),
 released_at timestamptz,created_by uuid,requested_by uuid,requested_at timestamptz,decided_by uuid,decided_at timestamptz,nota text
);
create unique index active_reservation on territorio_personal_reservas(territory_id) where status='activa';
create unique index pending_reservation on territorio_personal_reservas(territory_id,requested_by) where status='solicitada';
create table public.territorio_manzanas(id uuid primary key,territory_id uuid,geometry_version integer,vigente_hasta timestamptz);
create table public.manzana_lados(id uuid primary key,manzana_id uuid,territory_id uuid,geometry_version integer,vigente_hasta timestamptz);
create table public.cobertura_eventos(id uuid primary key,lado_id uuid,manzana_id uuid,territory_id uuid,estado text,origen text,informado_por uuid,salida_id uuid,corrige_evento_id uuid,nota text,informado_at timestamptz default now());
alter table profiles enable row level security;
alter table user_module_access enable row level security;
alter table salidas enable row level security;
alter table territorios enable row level security;
alter table territorio_personal_reservas enable row level security;
alter table salida_resultados enable row level security;
create policy own_reservations on territorio_personal_reservas for select to authenticated using(requested_by=auth.uid());
create policy result_read on salida_resultados for select to authenticated using(true);
create policy result_direct_write on salida_resultados for insert to authenticated with check(true);
create policy old_allow on salidas for all to authenticated using(true) with check(true);
create policy own_profile on profiles for select to authenticated using(id=auth.uid());
grant select, insert, update, delete on all tables in schema public to authenticated;
grant select on public.salida_resultado_actual to authenticated;
insert into profiles values
 ('00000000-0000-0000-0000-000000000001','Admin prueba','admin','active',null),
 ('00000000-0000-0000-0000-000000000002','Publicador prueba','viewer','active',null),
 ('00000000-0000-0000-0000-000000000003','Pendiente prueba','viewer','pending',null),
 ('00000000-0000-0000-0000-000000000004','Inactivo prueba','admin','inactive',null),
 ('00000000-0000-0000-0000-000000000005','Conductor exacto','conductor','active','70000000-0000-0000-0000-000000000001'),
 ('00000000-0000-0000-0000-000000000006','Conductor equivocado','conductor','active','70000000-0000-0000-0000-000000000002'),
 ('00000000-0000-0000-0000-000000000007','Conductor inactivo','conductor','inactive','70000000-0000-0000-0000-000000000001');
insert into conductores values
 ('70000000-0000-0000-0000-000000000001'),
 ('70000000-0000-0000-0000-000000000002');
insert into user_module_access values
 ('00000000-0000-0000-0000-000000000005','salidas'),
 ('00000000-0000-0000-0000-000000000006','salidas');
insert into user_module_access values ('00000000-0000-0000-0000-000000000004','mapas');
insert into salidas(id,driver_id) values
 ('30000000-0000-0000-0000-000000000001','70000000-0000-0000-0000-000000000001');
