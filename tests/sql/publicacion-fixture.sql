-- Columnas usadas por la implementación real, sobre el fixture mínimo A-C.
alter table territorios add column updated_at timestamptz;
alter table territorio_manzanas alter column id set default gen_random_uuid();
alter table territorio_manzanas add column label text,add column lat numeric,add column lng numeric,
 add column geometry_geojson jsonb,add column area_m2 numeric,add column orden integer,
 add column updated_at timestamptz,add column vigente_desde timestamptz default now();
alter table manzana_lados alter column id set default gen_random_uuid();
alter table manzana_lados add column orden integer,add column geometry_geojson jsonb,add column largo_m numeric,
 add column rumbo_grados numeric,add column medio_lat numeric,add column medio_lng numeric,
 add column vigente_desde timestamptz default now();
insert into territorios(id,name) values('81000000-0000-0000-0000-000000000001','QA-A'),('81000000-0000-0000-0000-000000000002','QA-B');
insert into territorio_manzanas(id,territory_id,geometry_version) values
 ('82000000-0000-0000-0000-000000000001','81000000-0000-0000-0000-000000000001',1),
 ('82000000-0000-0000-0000-000000000002','81000000-0000-0000-0000-000000000002',1);
