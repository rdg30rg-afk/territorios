// Carga la fuente reproducible del editor en el clon DEV. Nunca acepta PROD.
import { createHash } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import path from 'node:path'

const DEV_REF = 'rkmioktcsgqqjshrlkmy'
const PROD_REF = 'dwgvzcnarrjgqjotocdw'
const dryRun = process.argv.includes('--dry-run')
const sourceFile = path.resolve('public/datos/manzanas-congregacion.geojson')
const sourceBytes = await readFile(sourceFile)
const datasetVersion = createHash('sha256').update(sourceBytes).digest('hex')
const collection = JSON.parse(sourceBytes.toString('utf8'))

if (collection?.type !== 'FeatureCollection' || !Array.isArray(collection.features)) {
  throw new Error('La fuente no es una FeatureCollection GeoJSON.')
}

function normalizeFeature(feature, index) {
  const sourceKey = String(feature?.properties?.id ?? '').trim()
  const geometry = feature?.geometry
  const ring = geometry?.coordinates?.[0]
  if (!sourceKey || geometry?.type !== 'Polygon' || !Array.isArray(ring) || ring.length < 4) {
    throw new Error(`Candidata inválida en la posición ${index}.`)
  }

  const coordinates = ring.map((coordinate, coordinateIndex) => {
    if (!Array.isArray(coordinate) || coordinate.length < 2) {
      throw new Error(`Coordenada inválida en ${sourceKey}:${coordinateIndex}.`)
    }
    const [lng, lat] = coordinate.map(Number)
    if (!Number.isFinite(lng) || !Number.isFinite(lat) ||
      lng < -180 || lng > 180 || lat < -90 || lat > 90) {
      throw new Error(`Coordenada fuera de rango en ${sourceKey}:${coordinateIndex}.`)
    }
    return [lng, lat]
  })
  const openRing = coordinates.length > 1 &&
    coordinates[0][0] === coordinates.at(-1)[0] &&
    coordinates[0][1] === coordinates.at(-1)[1]
    ? coordinates.slice(0, -1)
    : coordinates
  if (new Set(openRing.map(([lng, lat]) => `${lng}:${lat}`)).size < 3) {
    throw new Error(`La candidata ${sourceKey} no tiene tres vértices distintos.`)
  }

  const lngs = openRing.map(([lng]) => lng)
  const lats = openRing.map(([, lat]) => lat)
  return {
    source_key: sourceKey,
    dataset_version: datasetVersion,
    geometry_geojson: { type: 'Polygon', coordinates: [[...openRing, openRing[0]]] },
    bbox_min_lng: Math.min(...lngs),
    bbox_min_lat: Math.min(...lats),
    bbox_max_lng: Math.max(...lngs),
    bbox_max_lat: Math.max(...lats),
    centro_lat: Number((lats.reduce((sum, value) => sum + value, 0) / lats.length).toFixed(6)),
    centro_lng: Number((lngs.reduce((sum, value) => sum + value, 0) / lngs.length).toFixed(6)),
    diagnostics: {
      source_area_m2: Number.isFinite(Number(feature.properties?.m2))
        ? Number(feature.properties.m2)
        : null,
      vertex_count: openRing.length,
    },
    activa: true,
  }
}

const rows = collection.features.map(normalizeFeature)
if (new Set(rows.map((row) => row.source_key)).size !== rows.length) {
  throw new Error('La fuente contiene source_key repetidos.')
}

console.log(`Dataset: ${datasetVersion}`)
console.log(`Candidatas válidas: ${rows.length}`)
if (dryRun) {
  console.log('Ensayo: no se escribió nada.')
  process.exit(0)
}

const projectRef = process.env.SUPABASE_PROJECT_REF
const keyFile = process.env.SUPABASE_SERVICE_ROLE_KEY_FILE
if (projectRef === PROD_REF) throw new Error('Producción está bloqueada para este cargador.')
if (projectRef !== DEV_REF) throw new Error('Este cargador acepta únicamente el clon DEV.')
if (keyFile !== '/tmp/territorios-dev-service-role') {
  throw new Error('La service role DEV debe venir de /tmp/territorios-dev-service-role.')
}

const serviceRole = (await readFile(keyFile, 'utf8')).trim()
if (!serviceRole) throw new Error('El archivo de service role está vacío.')
const baseUrl = `https://${DEV_REF}.supabase.co/rest/v1/manzana_candidatas`
const headers = {
  apikey: serviceRole,
  Authorization: `Bearer ${serviceRole}`,
  'Content-Type': 'application/json',
}

for (let offset = 0; offset < rows.length; offset += 200) {
  const page = rows.slice(offset, offset + 200)
  const response = await fetch(
    `${baseUrl}?on_conflict=dataset_version,source_key`,
    {
      method: 'POST',
      headers: { ...headers, Prefer: 'resolution=merge-duplicates,return=minimal' },
      body: JSON.stringify(page),
    },
  )
  if (!response.ok) throw new Error(`Falló lote ${offset / 200 + 1}: ${await response.text()}`)
  console.log(`Cargadas ${Math.min(offset + page.length, rows.length)} de ${rows.length}`)
}

const deactivate = await fetch(
  `${baseUrl}?dataset_version=neq.${encodeURIComponent(datasetVersion)}&activa=eq.true`,
  {
    method: 'PATCH',
    headers: { ...headers, Prefer: 'return=minimal' },
    body: JSON.stringify({ activa: false }),
  },
)
if (!deactivate.ok) throw new Error(`No se pudieron desactivar fuentes anteriores: ${await deactivate.text()}`)

console.log(`Fuente activa confirmada: ${rows.length} candidatas.`)
