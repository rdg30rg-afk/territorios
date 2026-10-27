// El informe de impacto del arreglo del angulo de las caras.
//
// scripts/informe-caras-afectadas.mjs compara las caras con la formula vieja
// y con la nueva. Es lo que Mateo mira antes de decidir si se vuelven a cortar
// las caras en `manzana_lados`, asi que sus numeros tienen que ser los
// verdaderos y el archivo que queda commiteado tiene que salir de este codigo.
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'
import {
  calcularInforme,
  carasConFormula,
  diferenciaNueva,
  diferenciaVieja,
} from '../scripts/informe-caras-afectadas.mjs'

const leer = (nombre) => readFile(new URL(`../${nombre}`, import.meta.url), 'utf8')
const formas = JSON.parse(await leer('public/datos/manzanas-territorios.json'))

// Un paso es [rumbo, metros] con la convencion de las caras: 0 = este,
// 90 = norte, +-180 = oeste.
function poligono(pasos) {
  let lng = -68.5355
  let lat = -31.5365
  const anillo = [[lng, lat]]
  for (const [rumbo, metros] of pasos) {
    const t = metros / 111000
    const th = (rumbo * Math.PI) / 180
    const nuevoLng = lng + (t * Math.cos(th)) / Math.cos((lat * Math.PI) / 180)
    lat += t * Math.sin(th)
    lng = nuevoLng
    anillo.push([lng, lat])
  }
  return { type: 'Polygon', coordinates: [[...anillo, anillo[0]]] }
}
// Dos tramos a +178 y -178 grados: la formula vieja no los une, la nueva si.
const conLadoPartido = poligono([[90, 100], [178, 50], [-178, 50]])
// Cuatro lados bien separados: no cambia con ninguna de las dos.
const rectangulo = poligono([[90, 100], [180, 100], [-90, 100]])

test('el informe sobre las 605 manzanas reales da los numeros que se le pasan a Mateo', () => {
  const informe = calcularInforme(formas)
  assert.deepEqual(
    {
      territorios: informe.totales.territorios,
      manzanas: informe.totales.manzanas,
      con_error: informe.totales.manzanas_con_error,
      antes: informe.totales.lados_antes,
      despues: informe.totales.lados_despues,
      cambian_de_cantidad: informe.totales.manzanas_que_cambian_de_cantidad,
      cambian_de_agrupamiento: informe.totales.manzanas_que_cambian_de_agrupamiento,
      territorios_afectados: informe.totales.territorios_afectados,
    },
    {
      territorios: 68,
      manzanas: 605,
      con_error: 0,
      antes: 2715, // los lados que hoy salen de cargar-geometrias-y-lados.mjs
      despues: 2667,
      cambian_de_cantidad: 44,
      cambian_de_agrupamiento: 66,
      territorios_afectados: 34,
    },
  )
  assert.equal(informe.totales.diferencia_de_lados, -48)
  assert.equal(informe.manzanas.length, 66)
  assert.equal(informe.manzanas.filter((m) => m.cambia_cantidad).length, 44)
  // Con la formula nueva, 413 de las 605 manzanas dan 4 lados (con la vieja,
  // 400): son los numeros que citan los comentarios del editor y de la vista.
  assert.equal(informe.histograma_caras_por_manzana.antes[4], 400)
  assert.equal(informe.histograma_caras_por_manzana.despues[4], 413)
})

test('el informe y el modulo canonico coinciden: el canonico ya usa la formula nueva', () => {
  const informe = calcularInforme(formas)
  assert.equal(informe.modulo_canonico.manzanas_que_coinciden_con_nueva, 605)
  // Las que no cambian de agrupamiento coinciden con las dos formulas.
  assert.equal(informe.modulo_canonico.manzanas_que_coinciden_con_vieja, 605 - 66)
})

test('el archivo commiteado en output/ sale de este codigo', async () => {
  let guardado
  try {
    guardado = JSON.parse(await leer('output/informe-caras-afectadas.json'))
  } catch (e) {
    if (e.code === 'ENOENT') return // no se commitea en todas las ramas
    throw e
  }
  assert.deepEqual(guardado, JSON.parse(JSON.stringify(calcularInforme(formas))), 'correr: node scripts/informe-caras-afectadas.mjs')
})

test('el informe detecta un lado partido en +-180 y deja quieto el que no cambia', () => {
  const informe = calcularInforme({
    territorios: { 7: [{ letra: 'a', geom: conLadoPartido }, { letra: 'b', geom: rectangulo }] },
  })
  assert.equal(informe.totales.lados_antes, 4 + 4)
  assert.equal(informe.totales.lados_despues, 3 + 4)
  assert.equal(informe.totales.manzanas_que_cambian_de_cantidad, 1)
  assert.equal(informe.manzanas.length, 1)
  const [m] = informe.manzanas
  assert.equal(m.territorio, '7')
  assert.equal(m.letra, 'a')
  assert.deepEqual(m.indices_antes, [[0, 1], [1, 2], [2, 3], [3, 0]])
  assert.deepEqual(m.indices_despues, [[0, 1], [1, 2, 3], [3, 0]])
  // Las dos caras de 50 m desaparecen como tales y aparece una de 100 m: es lo
  // que dejaria cobertura colgada si se re-cortara sin cuidado.
  assert.equal(m.caras_antes_que_desaparecen, 2)
  assert.equal(m.caras_despues_nuevas, 1)
  assert.deepEqual(informe.territorios_afectados, [
    { territorio: '7', manzanas_que_cambian: ['a'], lados_antes: 8, lados_despues: 7 },
  ])
})

test('una manzana rota no tumba el informe: queda anotada como error', () => {
  const informe = calcularInforme({
    territorios: { 9: [{ letra: 'x', geom: { type: 'Polygon', coordinates: [[[-68.5, -31.5]]] } }, { letra: 'y', geom: rectangulo }] },
  })
  assert.equal(informe.totales.manzanas, 2)
  assert.equal(informe.totales.manzanas_con_error, 1)
  assert.equal(informe.errores[0].letra, 'x')
  assert.match(informe.errores[0].error, /tres vértices distintos/)
  assert.equal(informe.totales.lados_antes, 4)
})

test('las dos formulas del informe: la vieja se equivoca en +-178 y la nueva no', () => {
  assert.equal(diferenciaVieja(-178, 178), 356)
  assert.equal(diferenciaNueva(-178, 178), 4)
  assert.equal(diferenciaNueva(178, -178), 4)
  assert.equal(diferenciaNueva(0, 180), 180)
  assert.equal(diferenciaNueva(-180, 180), 0)
  // La copia del agrupamiento del informe, con la formula nueva, tiene que dar
  // lo mismo que el modulo canonico: es lo que hace creible la comparacion.
  const anillo = [[-31.5, -68.5], [-31.5, -68.499], [-31.499, -68.499], [-31.499, -68.5]]
  assert.deepEqual(carasConFormula(anillo, diferenciaNueva), [[0, 1], [1, 2], [2, 3], [3, 0]])
})

test('el informe es offline: sin red, sin credenciales, sin base', async () => {
  const fuente = await leer('scripts/informe-caras-afectadas.mjs')
  const codigo = fuente.split('\n').filter((l) => !l.trim().startsWith('//')).join('\n')
  for (const prohibido of ['fetch(', 'process.env', "from 'node:http", "from 'node:https", "from 'node:net", 'XMLHttpRequest', 'rpc(']) {
    assert.ok(!codigo.includes(prohibido), `el informe no debe usar ${prohibido}`)
  }
})
