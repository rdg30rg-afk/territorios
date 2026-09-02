// Carga la geometría de cada manzana y sus lados en la base.
//
// Fuente: public/datos/manzanas-territorios.json (lo que hoy lee el mapa
// del hermano desde un archivo estático, indexado por nombre de territorio).
// Destino: territorio_manzanas.geometry_geojson + tabla manzana_lados.
//
// El cálculo de lados es UNA COPIA EXACTA del que hace vista-hermano.html.
// Si los dos se separan, el cliente y la base dejan de hablar del mismo
// lado y la cobertura apunta a otra calle. Cualquier cambio va en los dos.
//
//   Ensayo (no escribe nada, no necesita credenciales):
//     node scripts/cargar-geometrias-y-lados.mjs --dry-run
//
//   Carga real contra el CLON de desarrollo:
//     SUPABASE_PROJECT_REF=rkmioktcsgqqjshrlkmy \
//     SUPABASE_SERVICE_ROLE_KEY_FILE=/ruta/a/la/clave.txt \
//     node scripts/cargar-geometrias-y-lados.mjs
//
// La clave de servicio se lee de un ARCHIVO, nunca de la línea de
// comandos ni del historial de la terminal.

import { readFile } from 'node:fs/promises'
import path from 'node:path'

const dryRun = process.argv.includes('--dry-run')
const repoRoot = path.resolve(import.meta.dirname, '..')

// ---------------------------------------------------- geometría (lados)
// Copia literal de vista-hermano.html. No tocar de un solo lado.
const TOL_GRADOS = 25
const LARGO_MINIMO = 12

const metros = (a, b) =>
  Math.hypot((b[1] - a[1]) * Math.cos((a[0] * Math.PI) / 180) * 111320, (b[0] - a[0]) * 110540)

const rumbo = (a, b) =>
  (Math.atan2(b[0] - a[0], (b[1] - a[1]) * Math.cos((a[0] * Math.PI) / 180)) * 180) / Math.PI

const difAngulo = (x, y) => Math.abs((((x - y) + 180) % 360) - 180)

function anilloDe (geom) {
  const anillo = geom.coordinates[0].map(([x, y]) => [y, x])
  const cerrado =
    anillo[0][0] === anillo[anillo.length - 1][0] && anillo[0][1] === anillo[anillo.length - 1][1]
  return cerrado ? anillo.slice(0, -1) : anillo
}

function ladosDe (geom) {
  const pts = anilloDe(geom)
  const n = pts.length
  let grupos = [[pts[0], pts[1 % n]]]
  for (let i = 1; i < n; i++) {
    const a = pts[i]
    const b = pts[(i + 1) % n]
    const g = grupos[grupos.length - 1]
    if (difAngulo(rumbo(a, b), rumbo(g[g.length - 2], g[g.length - 1])) <= TOL_GRADOS) g.push(b)
    else grupos.push([a, b])
  }
  if (grupos.length > 2) {
    const pri = grupos[0]
    const ult = grupos[grupos.length - 1]
    if (difAngulo(rumbo(pri[0], pri[1]), rumbo(ult[ult.length - 2], ult[ult.length - 1])) <= TOL_GRADOS) {
      grupos[0] = ult.concat(pri.slice(1))
      grupos.pop()
    }
  }
  const largo = (g) => g.slice(1).reduce((t, q, i) => t + metros(g[i], q), 0)
  const res = grupos.filter((g) => largo(g) >= LARGO_MINIMO)
  return (res.length ? res : [grupos[0]]).map((g) => ({
    puntos: g,
    largo_m: Number(largo(g).toFixed(2)),
    // Rumbo de punta a punta: sirve para reconocer el mismo lado después
    // de un redibujado. Normalizado a [0,180) porque una calle no tiene
    // sentido de circulación.
    rumbo_grados: Number((((rumbo(g[0], g[g.length - 1]) % 180) + 180) % 180).toFixed(2)),
    medio: g[Math.floor(g.length / 2)],
  }))
}

// Área por fórmula del zapatero, en metros locales. Sin PostGIS es lo
// único que hace falta para ponderar el heatmap por superficie.
function areaM2 (geom) {
  const pts = anilloDe(geom)
  const lat0 = pts.reduce((t, p) => t + p[0], 0) / pts.length
  const k = Math.cos((lat0 * Math.PI) / 180) * 111320
  let s = 0
  for (let i = 0; i < pts.length; i++) {
    const a = pts[i]
    const b = pts[(i + 1) % pts.length]
    s += (a[1] * k) * (b[0] * 110540) - (b[1] * k) * (a[0] * 110540)
  }
  return Number(Math.abs(s / 2).toFixed(2))
}

const lineString = (puntos) => ({
  type: 'LineString',
  coordinates: puntos.map(([lat, lng]) => [lng, lat]),
})

// ------------------------------------------------------------- carga
const formas = JSON.parse(
  await readFile(path.join(repoRoot, 'public/datos/manzanas-territorios.json'), 'utf8'),
)

let api = null
if (!dryRun) {
  const ref = process.env.SUPABASE_PROJECT_REF
  const keyFile = process.env.SUPABASE_SERVICE_ROLE_KEY_FILE
  if (!ref || !keyFile) {
    throw new Error('Faltan SUPABASE_PROJECT_REF y SUPABASE_SERVICE_ROLE_KEY_FILE.')
  }
  if (ref === 'dwgvzcnarrjgqjotocdw') {
    throw new Error('Ese es el proyecto de PRODUCCIÓN. Este script es solo para el clon.')
  }
  const key = (await readFile(keyFile, 'utf8')).trim()
  const base = `https://${ref}.supabase.co/rest/v1`
  const headers = { apikey: key, Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' }
  api = {
    async get (ruta) {
      const r = await fetch(`${base}/${ruta}`, { headers })
      if (!r.ok) throw new Error(`GET ${ruta}: ${r.status} ${await r.text()}`)
      return r.json()
    },
    async send (metodo, ruta, cuerpo) {
      const r = await fetch(`${base}/${ruta}`, {
        method: metodo,
        headers: { ...headers, Prefer: 'return=minimal' },
        body: JSON.stringify(cuerpo),
      })
      if (!r.ok) throw new Error(`${metodo} ${ruta}: ${r.status} ${await r.text()}`)
    },
  }
}

const territorios = api
  ? await api.get('territorios?select=id,name')
  : Object.keys(formas.territorios).map((name) => ({ id: `dry-${name}`, name }))

const manzanasBd = api
  ? await api.get('territorio_manzanas?select=id,territory_id,label')
  : []

const porNombre = new Map(territorios.map((t) => [t.name, t]))
const porClave = new Map(manzanasBd.map((m) => [`${m.territory_id}|${m.label}`, m]))

const resumen = {
  territoriosEnArchivo: Object.keys(formas.territorios).length,
  manzanasEnArchivo: 0,
  sinTerritorio: [],
  sinFilaEnBd: [],
  actualizadas: 0,
  lados: 0,
  histograma: {},
}

const lotesManzanas = []
const lotesLados = []

for (const [nombre, lista] of Object.entries(formas.territorios)) {
  const terr = porNombre.get(nombre)
  if (!terr) {
    resumen.sinTerritorio.push(nombre)
    continue
  }
  for (const mz of lista) {
    resumen.manzanasEnArchivo++
    const fila = api ? porClave.get(`${terr.id}|${mz.letra}`) : { id: `dry-${nombre}-${mz.letra}` }
    if (!fila) {
      resumen.sinFilaEnBd.push(`${nombre}/${mz.letra}`)
      continue
    }
    const lados = ladosDe(mz.geom)
    resumen.actualizadas++
    resumen.lados += lados.length
    resumen.histograma[lados.length] = (resumen.histograma[lados.length] || 0) + 1

    lotesManzanas.push({
      id: fila.id,
      geometry_geojson: mz.geom,
      area_m2: areaM2(mz.geom),
    })
    lados.forEach((lado, i) => {
      lotesLados.push({
        manzana_id: fila.id,
        territory_id: terr.id,
        orden: i,
        geometry_geojson: lineString(lado.puntos),
        largo_m: lado.largo_m,
        rumbo_grados: lado.rumbo_grados,
        medio_lat: Number(lado.medio[0].toFixed(6)),
        medio_lng: Number(lado.medio[1].toFixed(6)),
      })
    })
  }
}

console.log('Territorios en el archivo :', resumen.territoriosEnArchivo)
console.log('Manzanas en el archivo    :', resumen.manzanasEnArchivo)
console.log('Manzanas a actualizar     :', resumen.actualizadas)
console.log('Lados a crear             :', resumen.lados)
console.log(
  'Lados por manzana         :',
  Object.entries(resumen.histograma)
    .sort((a, b) => a[0] - b[0])
    .map(([k, v]) => `${k}:${v}`)
    .join('  '),
)
if (resumen.sinTerritorio.length) {
  console.log('\nSin territorio en la base :', resumen.sinTerritorio.join(', '))
}
if (resumen.sinFilaEnBd.length) {
  console.log(`\nSin fila en territorio_manzanas (${resumen.sinFilaEnBd.length}):`)
  console.log('  ' + resumen.sinFilaEnBd.slice(0, 40).join(', ') + (resumen.sinFilaEnBd.length > 40 ? ' …' : ''))
}

if (dryRun) {
  console.log('\nEnsayo: no se escribió nada.')
  process.exit(0)
}

// Idempotente: se puede volver a correr. Cierra los lados vigentes de las
// manzanas que toca y crea el juego nuevo, en vez de duplicar.
const ahora = new Date().toISOString()
const tocadas = [...new Set(lotesLados.map((l) => l.manzana_id))]

for (let i = 0; i < tocadas.length; i += 50) {
  const grupo = tocadas.slice(i, i + 50)
  await api.send(
    'PATCH',
    `manzana_lados?vigente_hasta=is.null&manzana_id=in.(${grupo.join(',')})`,
    { vigente_hasta: ahora },
  )
}
console.log(`Lados anteriores cerrados para ${tocadas.length} manzanas.`)

for (let i = 0; i < lotesManzanas.length; i += 200) {
  const grupo = lotesManzanas.slice(i, i + 200)
  await api.send('POST', 'territorio_manzanas?on_conflict=id', grupo.map((m) => ({ ...m, updated_at: ahora })))
}
console.log(`Geometría cargada en ${lotesManzanas.length} manzanas.`)

for (let i = 0; i < lotesLados.length; i += 500) {
  await api.send('POST', 'manzana_lados', lotesLados.slice(i, i + 500))
}
console.log(`${lotesLados.length} lados creados.`)
console.log('\nListo.')
