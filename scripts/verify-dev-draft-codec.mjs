// Abre el borrador real de DEV con el codec nuevo sin escribir ni mostrar su contenido.
import { readFile } from 'node:fs/promises'
import { spawnSync } from 'node:child_process'
import { featureCollection, polygon } from '@turf/helpers'
import { union } from '@turf/union'
import { decodeEditorDraftState, encodeEditorDraftState } from '../src/features/map-editor/model/draftCodec.ts'

const DEV_REF = 'rkmioktcsgqqjshrlkmy'
const PROD_REF = 'dwgvzcnarrjgqjotocdw'
const PASSWORD_FILE = '/tmp/territorios-dev-db-password'
const projectRef = process.env.SUPABASE_PROJECT_REF
const passwordFile = process.env.SUPABASE_DB_PASSWORD_FILE
if (projectRef === PROD_REF) throw new Error('Producción está bloqueada.')
if (projectRef !== DEV_REF) throw new Error('Esta verificación acepta únicamente DEV.')
if (passwordFile !== PASSWORD_FILE) throw new Error(`Usá ${PASSWORD_FILE}.`)
const password = (await readFile(PASSWORD_FILE, 'utf8')).trim()
if (!password) throw new Error('El archivo de contraseña DEV está vacío.')

const sql = String.raw`
select json_build_object(
  'state', (select estado from public.editor_estado where id = 'manzanas'),
  'territories', coalesce((
    select json_agg(json_build_object('id', id, 'number', name, 'sector', sector) order by id)
    from public.territorios
  ), '[]'::json),
  'candidates', coalesce((
    select json_agg(json_build_object(
      'id', id,
      'sourceKey', source_key,
      'datasetVersion', dataset_version,
      'geometry', geometry_geojson,
      'center', json_build_array(centro_lat, centro_lng),
      'diagnostics', diagnostics
    ) order by source_key)
    from public.manzana_candidatas
    where activa
  ), '[]'::json)
);
`

const result = spawnSync('/opt/homebrew/opt/libpq/bin/psql', [
  '-X', '-A', '-t',
  '--dbname', `postgresql://postgres@db.${DEV_REF}.supabase.co:5432/postgres?sslmode=require`,
  '--no-password', '--set', 'ON_ERROR_STOP=1', '--command', sql,
], {
  encoding: 'utf8',
  maxBuffer: 50 * 1024 * 1024,
  env: {
    ...process.env,
    PGPASSWORD: password,
    PGCONNECT_TIMEOUT: '15',
    PGOPTIONS: '-c statement_timeout=30000',
  },
})
if (result.status !== 0) {
  throw new Error((result.stderr || result.stdout).replaceAll(password, '[redacted]'))
}

const payload = JSON.parse(result.stdout.trim())
if (!payload.state) throw new Error('DEV no tiene un borrador para verificar.')
const canonicalNumbers = new Set(payload.territories.map((territory) => String(territory.number).trim().toLocaleLowerCase('es-AR')))
const legacyTerritories = Array.isArray(payload.state.territorios) ? payload.state.territorios : []
const assignments = Array.isArray(payload.state.asignacion) ? payload.state.asignacion : []
const missingTerritories = legacyTerritories
  .filter((territory) => !canonicalNumbers.has(String(territory.numero ?? '').trim().toLocaleLowerCase('es-AR')))
  .map((territory) => {
    const sourceKeys = assignments
      .filter((assignment) => assignment?.[1] === territory.id)
      .map((assignment) => assignment[0])
    const edited = new Map((payload.state.editadas ?? []).map((item) => [item.id, item.geom]))
    const candidates = new Map(payload.candidates.map((item) => [item.sourceKey, item.geometry]))
    const geometries = sourceKeys.map((sourceKey) => edited.get(sourceKey) ?? candidates.get(sourceKey))
    if (geometries.some((geometry) => !geometry)) {
      throw new Error(`El territorio legado ${territory.numero} contiene manzanas sin geometría.`)
    }
    const outline = union(featureCollection(geometries.map((geometry) => polygon(geometry.coordinates))))
    return {
      number: String(territory.numero ?? '').trim(),
      assignedBlocks: sourceKeys.length,
      outlineType: outline.geometry.type,
      outlineParts: outline.geometry.type === 'MultiPolygon' ? outline.geometry.coordinates.length : 1,
    }
  })
if (missingTerritories.length) {
  throw new Error(`El borrador tiene territorios sin UUID canónico: ${JSON.stringify(missingTerritories)}`)
}
const decoded = decodeEditorDraftState(payload.state, payload.territories, payload.candidates)
const encoded = encodeEditorDraftState(decoded)
const roundTrip = decodeEditorDraftState(encoded, payload.territories, payload.candidates)
if (JSON.stringify(roundTrip.document) !== JSON.stringify(decoded.document)) {
  throw new Error('El roundtrip v2 cambió el documento real de DEV.')
}

console.log(JSON.stringify({
  projectRef: DEV_REF,
  legacy: decoded.migratedFromLegacy,
  territories: Object.keys(decoded.document.territories).length,
  blocks: Object.keys(decoded.document.blocks).length,
  assignedBlocks: Object.values(decoded.document.blocks).filter((block) => block.territoryId).length,
  touchedTerritories: decoded.document.touchedTerritoryIds.length,
  discarded: decoded.discardedSourceKeys.length,
  reviewed: decoded.reviewedBlockIds.length,
  roundTrip: true,
  wroteData: false,
}))
