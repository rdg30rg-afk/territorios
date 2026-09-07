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
// El cálculo de lados usa el módulo canónico compartido con el editor.
// Así la vista previa y lo que finalmente se guarda no pueden divergir.
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
import {
  polygonAreaSquareMeters,
  polygonCenter,
  sidesForBlock,
} from '../src/features/map-editor/geometry/blockGeometry.ts'

const dryRun = process.argv.includes('--dry-run')
const repoRoot = path.resolve(import.meta.dirname, '..')

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
    const lados = sidesForBlock({ geometry: mz.geom })
    const [lat, lng] = polygonCenter(mz.geom)
    resumen.manzanas++
    resumen.lados += lados.length
    resumen.histograma[lados.length] = (resumen.histograma[lados.length] || 0) + 1
    return {
      label: mz.letra,
      orden,
      lat,
      lng,
      geom: mz.geom,
      area_m2: polygonAreaSquareMeters(mz.geom),
      lados: lados.map((lado, i) => ({
        orden: i,
        geom: lineString(lado.points),
        largo_m: lado.lengthMeters,
        rumbo_grados: lado.bearingDegrees,
        medio_lat: Number(lado.midpoint[0].toFixed(6)),
        medio_lng: Number(lado.midpoint[1].toFixed(6)),
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
