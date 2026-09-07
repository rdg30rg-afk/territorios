// Recupera en DEV territorios que existen en el borrador legacy pero aún no tienen UUID.
// Ensayo por defecto; --apply inserta todos en una única transacción de PostgreSQL.
import { createHash } from 'node:crypto'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { spawnSync } from 'node:child_process'
import path from 'node:path'
import { featureCollection, polygon } from '@turf/helpers'
import { union } from '@turf/union'

process.umask(0o077)
const DEV_REF = 'rkmioktcsgqqjshrlkmy'
const PROD_REF = 'dwgvzcnarrjgqjotocdw'
const PASSWORD_FILE = '/tmp/territorios-dev-db-password'
const apply = process.argv.includes('--apply')
const projectRef = process.env.SUPABASE_PROJECT_REF
const passwordFile = process.env.SUPABASE_DB_PASSWORD_FILE
if (projectRef === PROD_REF) throw new Error('Producción está bloqueada.')
if (projectRef !== DEV_REF) throw new Error('Este recuperador acepta únicamente DEV.')
if (passwordFile !== PASSWORD_FILE) throw new Error(`Usá ${PASSWORD_FILE}.`)
const password = (await readFile(PASSWORD_FILE, 'utf8')).trim()
if (!password) throw new Error('El archivo de contraseña DEV está vacío.')

function psql(sql) {
  const result = spawnSync('/opt/homebrew/opt/libpq/bin/psql', [
    '-X', '-A', '-t',
    '--dbname', `postgresql://postgres@db.${DEV_REF}.supabase.co:5432/postgres?sslmode=require`,
    '--no-password', '--set', 'ON_ERROR_STOP=1',
  ], {
    input: sql,
    encoding: 'utf8',
    maxBuffer: 50 * 1024 * 1024,
    env: {
      ...process.env,
      PGPASSWORD: password,
      PGCONNECT_TIMEOUT: '15',
      PGOPTIONS: '-c statement_timeout=60000 -c lock_timeout=5000',
    },
  })
  if (result.status !== 0) {
    throw new Error((result.stderr || result.stdout).replaceAll(password, '[redacted]'))
  }
  return result.stdout.trim()
}

const snapshotSql = String.raw`
select json_build_object(
  'state', (select estado from public.editor_estado where id = 'manzanas'),
  'territories', coalesce((
    select json_agg(json_build_object('id', id, 'name', name, 'sector', sector) order by id)
    from public.territorios
  ), '[]'::json),
  'candidates', coalesce((
    select json_agg(json_build_object('sourceKey', source_key, 'geometry', geometry_geojson) order by source_key)
    from public.manzana_candidatas where activa
  ), '[]'::json)
);
`
const snapshot = JSON.parse(psql(snapshotSql))
if (!snapshot.state) throw new Error('DEV no tiene un borrador legacy para recuperar.')
if (snapshot.state.schema_version === 2) throw new Error('El borrador ya es v2; no corresponde sembrar desde legacy.')

const normalize = (value) => String(value ?? '').trim().toLocaleLowerCase('es-AR')
const canonicalNumbers = new Set(snapshot.territories.map((territory) => normalize(territory.name)))
const candidates = new Map(snapshot.candidates.map((candidate) => [candidate.sourceKey, candidate.geometry]))
const discarded = new Set(snapshot.state.descartadas ?? [])
const edited = new Map((snapshot.state.editadas ?? []).map((item) => [item.id, item.geom]))
const assignments = Array.isArray(snapshot.state.asignacion) ? snapshot.state.asignacion : []
const rows = []

for (const territory of snapshot.state.territorios ?? []) {
  const name = String(territory.numero ?? '').trim()
  if (!name || canonicalNumbers.has(normalize(name))) continue
  const assigned = assignments.filter((assignment) => assignment?.[1] === territory.id)
  const geometries = []
  for (const assignment of assigned) {
    const sourceKey = assignment[0]
    const geometry = edited.get(sourceKey) ?? (discarded.has(sourceKey) ? null : candidates.get(sourceKey))
    if (geometry) geometries.push(geometry)
  }
  if (!geometries.length) throw new Error(`El territorio ${name} no tiene manzanas efectivas para derivar su contorno.`)
  const outline = union(featureCollection(geometries.map((geometry) => polygon(geometry.coordinates))))
  if (!outline || outline.geometry.type !== 'Polygon') {
    throw new Error(`El territorio ${name} no forma un único polígono; requiere revisión manual.`)
  }
  rows.push({
    name,
    description: 'Recuperado del borrador legacy del editor de manzanas.',
    sector: typeof territory.sector === 'string' ? territory.sector : null,
    polygon_geojson: {
      ...outline.geometry,
      ...(typeof territory.color === 'string' ? { color: territory.color } : {}),
    },
    assignedBlocks: geometries.length,
  })
}

rows.sort((first, second) => first.name.localeCompare(second.name, 'es-AR', { numeric: true }))
if (new Set(rows.map((row) => normalize(row.name))).size !== rows.length) {
  throw new Error('El borrador repite el número de un territorio sin UUID.')
}

const summary = rows.map(({ name, assignedBlocks, polygon_geojson: geometry }) => ({
  name,
  assignedBlocks,
  vertices: geometry.coordinates[0].length - 1,
}))
if (!apply) {
  console.log(JSON.stringify({ projectRef: DEV_REF, dryRun: true, missingTerritories: summary }))
  process.exit(0)
}
if (!rows.length) {
  console.log(JSON.stringify({ projectRef: DEV_REF, inserted: 0, alreadyComplete: true }))
  process.exit(0)
}

const backupDirectory = path.resolve(
  'backups/seeds',
  `legacy-editor-territories-${Date.now()}`,
)
await mkdir(backupDirectory, { recursive: true, mode: 0o700 })
await writeFile(
  path.join(backupDirectory, 'before.json'),
  JSON.stringify({ territories: snapshot.territories, planned: rows }, null, 2),
  { mode: 0o600 },
)

const payload = JSON.stringify(rows.map(({ assignedBlocks: _ignored, ...row }) => row))
const delimiter = `$territorios_${createHash('sha256').update(payload).digest('hex').slice(0, 16)}$`
if (payload.includes(delimiter)) throw new Error('No se pudo delimitar el lote SQL con seguridad.')
const applySql = `
begin;
lock table public.territorios in share row exclusive mode;
do $$
begin
  if exists (
    select 1
    from jsonb_array_elements(${delimiter}${payload}${delimiter}::jsonb) as lote(item)
    join public.territorios t on lower(btrim(t.name)) = lower(btrim(item ->> 'name'))
  ) then
    raise exception 'Un territorio apareció mientras se preparaba la recuperación' using errcode = '40001';
  end if;
end;
$$;
insert into public.territorios (name, description, polygon_geojson, sector)
select
  btrim(item ->> 'name'),
  item ->> 'description',
  item -> 'polygon_geojson',
  item ->> 'sector'
from jsonb_array_elements(${delimiter}${payload}${delimiter}::jsonb) as lote(item);
commit;
`
psql(applySql)

const verification = JSON.parse(psql(`
select json_build_object(
  'count', count(*),
  'names', json_agg(name order by name)
)
from public.territorios
where lower(btrim(name)) = any(array[${rows.map((row) => `'${normalize(row.name).replaceAll("'", "''")}'`).join(',')}]);
`))
if (Number(verification.count) !== rows.length) {
  throw new Error('La base no confirmó todos los territorios recuperados.')
}
console.log(JSON.stringify({
  projectRef: DEV_REF,
  inserted: rows.length,
  territories: summary,
  backupDirectory,
}))
