// Informe de impacto del arreglo del ángulo de las caras.
//
// Cuántas manzanas cambian de caras si se corrige la diferencia de ángulos
// (`Math.abs((((a - b) + 180) % 360) - 180)` da 356 en vez de 4 para +/-178
// grados, porque `%` en JS conserva el signo del dividendo).
//
// OFFLINE: no usa red, no lee credenciales, no toca la base. Lee solo
//   public/datos/manzanas-territorios.json
// y escribe
//   output/informe-caras-afectadas.json
//
//   Uso:
//     node scripts/informe-caras-afectadas.mjs
//
// Este script NO decide nada. Re-cortar las caras en `manzana_lados` lo decide
// una persona después de ver el informe: la cobertura no se arrastra a un
// dibujo nuevo, y la función de la base se niega a reemplazar un territorio
// que ya tiene cobertura informada.
//
// La fórmula VIEJA queda acá adentro solo para comparar. Las dos fórmulas
// corren sobre una copia del agrupamiento que es idéntica a la canónica de
// src/features/map-editor/geometry/blockGeometry.ts salvo por la diferencia de
// ángulos, que entra por parámetro. Como control, el informe también corre el
// módulo canónico y dice con cuál de las dos fórmulas coincide: antes del
// arreglo coincide con la vieja (que es lo que cargó `manzana_lados`), después
// con la nueva.

import { mkdir, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  automaticSideGroups,
  MINIMUM_SIDE_LENGTH_METERS,
  polygonRingLatLng,
  SIDE_ANGLE_TOLERANCE_DEGREES,
} from '../src/features/map-editor/geometry/blockGeometry.ts'

const repoRoot = path.resolve(import.meta.dirname, '..')
const ENTRADA = 'public/datos/manzanas-territorios.json'
const SALIDA = 'output/informe-caras-afectadas.json'

// ------------------------------------------------- las dos fórmulas
// Solo para comparar. La vieja es la que hoy está en las tres copias.
export const diferenciaVieja = (a, b) => Math.abs((((a - b) + 180) % 360) - 180)
// La nueva: siempre entre 0 y 180, sin importar el signo ni el orden.
export const diferenciaNueva = (a, b) => {
  const d = Math.abs(a - b) % 360
  return d > 180 ? 360 - d : d
}

// ------------------------------------------------- el agrupamiento
const metros = (a, b) =>
  Math.hypot((b[1] - a[1]) * Math.cos((a[0] * Math.PI) / 180) * 111320, (b[0] - a[0]) * 110540)
const rumbo = (a, b) =>
  (Math.atan2(b[0] - a[0], (b[1] - a[1]) * Math.cos((a[0] * Math.PI) / 180)) * 180) / Math.PI

function largoDeGrupo(puntos, grupo) {
  let total = 0
  for (let i = 1; i < grupo.length; i += 1) total += metros(puntos[grupo[i - 1]], puntos[grupo[i]])
  return total
}

// Mismo recorrido que `automaticSideGroups`, con la diferencia de ángulos
// como parámetro. Devuelve grupos de ÍNDICES del anillo abierto.
export function carasConFormula(puntos, diferencia) {
  const n = puntos.length
  const rum = (desde, hasta) => rumbo(puntos[desde], puntos[hasta])
  const grupos = [[0, 1 % n]]
  for (let i = 1; i < n; i += 1) {
    const siguiente = (i + 1) % n
    const actual = grupos[grupos.length - 1]
    if (
      diferencia(rum(i, siguiente), rum(actual[actual.length - 2], actual[actual.length - 1])) <=
      SIDE_ANGLE_TOLERANCE_DEGREES
    ) {
      actual.push(siguiente)
    } else {
      grupos.push([i, siguiente])
    }
  }
  if (grupos.length > 2) {
    const primero = grupos[0]
    const ultimo = grupos[grupos.length - 1]
    if (
      diferencia(
        rum(primero[0], primero[1]),
        rum(ultimo[ultimo.length - 2], ultimo[ultimo.length - 1]),
      ) <= SIDE_ANGLE_TOLERANCE_DEGREES
    ) {
      grupos[0] = ultimo.concat(primero.slice(1))
      grupos.pop()
    }
  }
  const largas = grupos.filter((g) => largoDeGrupo(puntos, g) >= MINIMUM_SIDE_LENGTH_METERS)
  return largas.length ? largas : [grupos[0]]
}

// ------------------------------------------------- el informe
const clave = (grupo) => grupo.join('-')
const mismosGrupos = (a, b) => a.length === b.length && a.every((g, i) => clave(g) === clave(b[i]))
const redondear = (x) => Number(x.toFixed(2))
const histograma = (cantidades) => {
  const h = {}
  for (const c of cantidades) h[c] = (h[c] || 0) + 1
  return Object.fromEntries(Object.entries(h).sort((a, b) => a[0] - b[0]))
}

export function calcularInforme(formas) {
  const filas = []
  const errores = []
  let coincideVieja = 0
  let coincideNueva = 0

  for (const [territorio, lista] of Object.entries(formas.territorios)) {
    lista.forEach((mz, posicion) => {
      let puntos
      try {
        puntos = polygonRingLatLng(mz.geom)
      } catch (e) {
        errores.push({ territorio, letra: mz.letra, posicion, error: e.message })
        return
      }
      const antes = carasConFormula(puntos, diferenciaVieja)
      const despues = carasConFormula(puntos, diferenciaNueva)
      const canonico = automaticSideGroups(mz.geom)
      if (mismosGrupos(canonico, antes)) coincideVieja += 1
      if (mismosGrupos(canonico, despues)) coincideNueva += 1
      filas.push({ territorio, letra: mz.letra, posicion, puntos, antes, despues })
    })
  }

  const cambian = filas.filter((f) => !mismosGrupos(f.antes, f.despues))
  const cambianCantidad = cambian.filter((f) => f.antes.length !== f.despues.length)

  const manzanas = cambian.map((f) => {
    const clavesDespues = new Set(f.despues.map(clave))
    const clavesAntes = new Set(f.antes.map(clave))
    return {
      territorio: f.territorio,
      letra: f.letra,
      posicion: f.posicion,
      vertices: f.puntos.length,
      caras_antes: f.antes.length,
      caras_despues: f.despues.length,
      cambia_cantidad: f.antes.length !== f.despues.length,
      indices_antes: f.antes,
      indices_despues: f.despues,
      largos_antes_m: f.antes.map((g) => redondear(largoDeGrupo(f.puntos, g))),
      largos_despues_m: f.despues.map((g) => redondear(largoDeGrupo(f.puntos, g))),
      // Una cara "se conserva" si el mismo tramo de vértices sigue existiendo.
      // Las que no, son las que tendrían cobertura colgada en la base.
      caras_antes_que_desaparecen: f.antes.filter((g) => !clavesDespues.has(clave(g))).length,
      caras_despues_nuevas: f.despues.filter((g) => !clavesAntes.has(clave(g))).length,
    }
  })

  const porTerritorio = new Map()
  for (const f of filas) {
    const t = porTerritorio.get(f.territorio) || { antes: 0, despues: 0, letras: [] }
    t.antes += f.antes.length
    t.despues += f.despues.length
    if (!mismosGrupos(f.antes, f.despues)) t.letras.push(f.letra)
    porTerritorio.set(f.territorio, t)
  }
  const territoriosAfectados = [...porTerritorio.entries()]
    .filter(([, t]) => t.letras.length)
    .map(([territorio, t]) => ({
      territorio,
      manzanas_que_cambian: t.letras,
      lados_antes: t.antes,
      lados_despues: t.despues,
    }))

  const ladosAntes = filas.reduce((t, f) => t + f.antes.length, 0)
  const ladosDespues = filas.reduce((t, f) => t + f.despues.length, 0)

  return {
    fuente: ENTRADA,
    parametros: {
      tolerancia_grados: SIDE_ANGLE_TOLERANCE_DEGREES,
      largo_minimo_m: MINIMUM_SIDE_LENGTH_METERS,
    },
    formulas: {
      vieja: 'Math.abs((((a - b) + 180) % 360) - 180)',
      nueva: 'd = Math.abs(a - b) % 360; d > 180 ? 360 - d : d',
    },
    totales: {
      territorios: Object.keys(formas.territorios).length,
      manzanas: filas.length + errores.length,
      manzanas_con_error: errores.length,
      lados_antes: ladosAntes,
      lados_despues: ladosDespues,
      diferencia_de_lados: ladosDespues - ladosAntes,
      manzanas_que_cambian_de_cantidad: cambianCantidad.length,
      manzanas_que_cambian_de_agrupamiento: cambian.length,
      territorios_afectados: territoriosAfectados.length,
      caras_antes_que_desaparecen: manzanas.reduce((t, m) => t + m.caras_antes_que_desaparecen, 0),
      caras_despues_nuevas: manzanas.reduce((t, m) => t + m.caras_despues_nuevas, 0),
    },
    histograma_caras_por_manzana: {
      antes: histograma(filas.map((f) => f.antes.length)),
      despues: histograma(filas.map((f) => f.despues.length)),
    },
    modulo_canonico: {
      nota:
        'Con cuál de las dos fórmulas coincide hoy blockGeometry.ts (el módulo que importa ' +
        'cargar-geometrias-y-lados.mjs). Antes del arreglo: la vieja; después: la nueva.',
      manzanas_que_coinciden_con_vieja: coincideVieja,
      manzanas_que_coinciden_con_nueva: coincideNueva,
    },
    territorios_afectados: territoriosAfectados,
    manzanas,
    errores,
  }
}

// ------------------------------------------------- consola
function resumen(informe) {
  const t = informe.totales
  const h = informe.histograma_caras_por_manzana
  const fmt = (o) => Object.entries(o).map(([k, v]) => `${k}:${v}`).join('  ')
  const lineas = [
    `Fuente                              : ${informe.fuente}`,
    `Territorios / manzanas              : ${t.territorios} / ${t.manzanas}` +
      (t.manzanas_con_error ? `  (${t.manzanas_con_error} con error)` : ''),
    `Lados con la fórmula vieja          : ${t.lados_antes}`,
    `Lados con la fórmula nueva          : ${t.lados_despues}  (${t.diferencia_de_lados >= 0 ? '+' : ''}${t.diferencia_de_lados})`,
    `Manzanas que cambian de cantidad    : ${t.manzanas_que_cambian_de_cantidad}`,
    `Manzanas que cambian de agrupamiento: ${t.manzanas_que_cambian_de_agrupamiento}  (en ${t.territorios_afectados} territorios)`,
    `Caras viejas que desaparecen        : ${t.caras_antes_que_desaparecen}  (las que tendrían cobertura colgada)`,
    `Caras nuevas sin equivalente        : ${t.caras_despues_nuevas}`,
    `Caras por manzana, antes            : ${fmt(h.antes)}`,
    `Caras por manzana, después          : ${fmt(h.despues)}`,
    `Módulo canónico coincide con        : vieja ${informe.modulo_canonico.manzanas_que_coinciden_con_vieja}, ` +
      `nueva ${informe.modulo_canonico.manzanas_que_coinciden_con_nueva} (de ${t.manzanas - t.manzanas_con_error})`,
  ]
  if (informe.manzanas.length) {
    lineas.push('', 'Manzanas que cambian (territorio y letra: caras antes -> después):')
    for (const t of informe.territorios_afectados) {
      const detalle = informe.manzanas
        .filter((m) => m.territorio === t.territorio)
        .map((m) => `${m.letra} ${m.caras_antes}->${m.caras_despues}${m.cambia_cantidad ? '' : ' (mismas, otro corte)'}`)
        .join(', ')
      lineas.push(`  territorio ${String(t.territorio).padStart(3)} · ${t.lados_antes} -> ${t.lados_despues} lados · ${detalle}`)
    }
  }
  for (const e of informe.errores) lineas.push(`  ERROR ${e.territorio}/${e.letra}: ${e.error}`)
  return lineas.join('\n')
}

// JSON con sangria, pero con las listas de numeros (indices, largos) en una
// sola linea: si no, cada indice ocupa una linea y el archivo no se lee.
const conSangria = (informe) =>
  JSON.stringify(informe, null, 2).replace(/\[\s*(?:-?\d+(?:\.\d+)?\s*,?\s*)+\]/g, (lista) =>
    lista.replace(/\s+/g, '').replace(/,/g, ', '),
  ) + '\n'

async function main() {
  const formas = JSON.parse(await readFile(path.join(repoRoot, ENTRADA), 'utf8'))
  const informe = calcularInforme(formas)
  const destino = path.join(repoRoot, SALIDA)
  await mkdir(path.dirname(destino), { recursive: true })
  await writeFile(destino, conSangria(informe))
  console.log(resumen(informe))
  console.log(`\nEscrito: ${SALIDA}`)
  console.log('No se tocó la base ni `manzana_lados`: re-cortar las caras lo decide una persona.')
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await main()
}
