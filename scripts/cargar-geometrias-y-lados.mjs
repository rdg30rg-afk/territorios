// Carga la geometría de cada manzana y sus lados en la base.
//
// Fuente: public/datos/manzanas-territorios.json (lo que hoy lee el mapa
// del hermano desde un archivo estático, indexado por nombre de territorio).
// Destino: territorio_manzanas + manzana_lados, por territorio completo.
//
// REEMPLAZA las manzanas del territorio, no las actualiza por letra. La
// primera versión emparejaba por letra y estaba mal: de 508 coincidencias,
// 412 (81%) tenían la forma de OTRA manzana, porque el archivo se generó
// reasignando letras N→S / O→E y la base conserva las originales. Habría
// escrito el polígono equivocado en cuatro de cada cinco filas, sin fallar.
//
// La función de la base se niega a reemplazar un territorio que ya tenga
// cobertura informada.
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

// La base guarda lat/lng por manzana. Se deriva del polígono en vez de
// heredarse de la fila vieja: la fila vieja puede ser otra manzana.
function centroide (geom) {
  const pts = anilloDe(geom)
  const n = pts.length
  return [
    Number((pts.reduce((t, q) => t + q[0], 0) / n).toFixed(6)),
    Number((pts.reduce((t, q) => t + q[1], 0) / n).toFixed(6)),
  ]
}

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
    async rpc (fn, cuerpo) {
      const r = await fetch(`${base}/rpc/${fn}`, {
        method: 'POST',
        headers,
        body: JSON.stringify(cuerpo),
      })
      const txt = await r.text()
      if (!r.ok) {
        // El mensaje de la excepción de plpgsql es lo único que importa.
        try { throw new Error(JSON.parse(txt).message || txt) } catch (e) { throw e }
      }
      return JSON.parse(txt)
    },
  }
}

const resumen = { territorios: 0, manzanas: 0, lados: 0, histograma: {} }
const cargas = []

for (const [nombre, lista] of Object.entries(formas.territorios)) {
  resumen.territorios++
  const manzanas = lista.map((mz, orden) => {
    const lados = ladosDe(mz.geom)
    const [lat, lng] = centroide(mz.geom)
    resumen.manzanas++
    resumen.lados += lados.length
    resumen.histograma[lados.length] = (resumen.histograma[lados.length] || 0) + 1
    return {
      label: mz.letra,
      orden,
      lat,
      lng,
      geom: mz.geom,
      area_m2: areaM2(mz.geom),
      lados: lados.map((lado, i) => ({
        orden: i,
        geom: lineString(lado.puntos),
        largo_m: lado.largo_m,
        rumbo_grados: lado.rumbo_grados,
        medio_lat: Number(lado.medio[0].toFixed(6)),
        medio_lng: Number(lado.medio[1].toFixed(6)),
      })),
    }
  })
  cargas.push({ p_name: nombre, p_manzanas: manzanas })
}

console.log('Territorios a cargar :', resumen.territorios)
console.log('Manzanas             :', resumen.manzanas)
console.log('Lados                :', resumen.lados)
console.log(
  'Lados por manzana    :',
  Object.entries(resumen.histograma).sort((a, b) => a[0] - b[0]).map(([k, v]) => `${k}:${v}`).join('  '),
)

if (dryRun) {
  console.log('\nEnsayo: no se escribió nada.')
  process.exit(0)
}

// Una llamada por territorio. Cada una corre entera en su transacción:
// si falla, ese territorio queda como estaba y los anteriores ya están.
// Volver a correr el script lo retoma sin duplicar.
let hechos = 0
const fallados = []
for (const carga of cargas) {
  try {
    const r = await api.rpc('cargar_manzanas_de_territorio', carga)
    hechos++
    console.log(
      `  ${carga.p_name.padStart(3)} · ${String(r.manzanas).padStart(3)} manzanas, ` +
      `${String(r.lados).padStart(3)} lados` +
      (r.manzanas_borradas ? `  (reemplaza ${r.manzanas_borradas})` : ''),
    )
  } catch (e) {
    fallados.push(`${carga.p_name}: ${e.message}`)
    console.log(`  ${carga.p_name.padStart(3)} · FALLÓ`)
  }
}

console.log(`\n${hechos} territorios cargados.`)
if (fallados.length) {
  console.log(`\n${fallados.length} fallaron y quedaron como estaban:`)
  for (const f of fallados) console.log('  ' + f)
  process.exit(1)
}
