import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { loadManzanaFormas } from '../src/lib/loadManzanaFormas.ts'

const cuadrado = {
  type: 'Polygon',
  coordinates: [[[0, 0], [0, 1], [1, 1], [1, 0], [0, 0]]],
}

// Un cliente que aplica `in`, `is` y `not` como la base, y pagina con `range`.
function clienteDeMentira(filas, { falla = null } = {}) {
  const consultas = []
  return {
    consultas,
    client: {
      from(tabla) {
        const filtros = []
        const consulta = { tabla, filtros }
        consultas.push(consulta)
        const q = {
          select(columnas) { consulta.columnas = columnas; return q },
          in(columna, valores) { filtros.push(f => valores.includes(f[columna])); return q },
          is(columna, valor) { filtros.push(f => (f[columna] ?? null) === valor); return q },
          not(columna, _operador, valor) { filtros.push(f => (f[columna] ?? null) !== valor); return q },
          order(columna) { consulta.orden = columna; return q },
          async range(desde, hasta) {
            consulta.paginas = [...(consulta.paginas ?? []), [desde, hasta]]
            if (falla) return { data: null, error: { message: falla } }
            const lista = filas.filter(f => filtros.every(p => p(f)))
            return { data: lista.slice(desde, hasta + 1), error: null }
          },
        }
        return q
      },
    },
  }
}

const fila = (id, territorio, letra, extra = {}) => ({
  id, territory_id: territorio, label: letra, geometry_geojson: cuadrado, vigente_hasta: null, ...extra,
})

test('cada territorio pedido tiene su lista, vacía si la base no tiene formas', async () => {
  const { client } = clienteDeMentira([fila('1', 'a', 'a'), fila('2', 'a', 'b')])
  const formas = await loadManzanaFormas(client, ['a', 'b'])
  assert.deepEqual([...formas.keys()], ['a', 'b'])
  assert.deepEqual(formas.get('a').map(f => f.letra), ['a', 'b'])
  // El vacío es lo que el mapa traduce en "todavía no tiene manzanas publicadas".
  assert.deepEqual(formas.get('b'), [])
})

test('usa la letra y la forma de la base, no las de ningún archivo', async () => {
  const { client } = clienteDeMentira([fila('1', 'a', 'c')])
  const [forma] = (await loadManzanaFormas(client, ['a'])).get('a')
  assert.equal(forma.letra, 'c')
  assert.equal(forma.geom, cuadrado)
})

test('solo las manzanas vigentes y con forma', async () => {
  const { client } = clienteDeMentira([
    fila('1', 'a', 'a'),
    fila('2', 'a', 'b', { vigente_hasta: '2026-09-01T00:00:00Z' }),
    fila('3', 'a', 'c', { geometry_geojson: null }),
    fila('4', 'a', 'd', { geometry_geojson: { type: 'Polygon', coordinates: [] } }),
    fila('5', 'otro', 'e'),
  ])
  const formas = await loadManzanaFormas(client, ['a'])
  assert.deepEqual(formas.get('a').map(f => f.letra), ['a'])
  assert.equal(formas.has('otro'), false)
})

test('más de una página: ninguna manzana se pierde ni un territorio queda vacío por error', async () => {
  // Si la consulta se cortara en el primer millar, los territorios del final
  // aparecerían como "sin manzanas publicadas" sin que nada fallara.
  const filas = Array.from({ length: 1300 }, (_, i) =>
    fila(String(i).padStart(4, '0'), i < 1250 ? 'a' : 'b', `m${i}`))
  const { client, consultas } = clienteDeMentira(filas)
  const formas = await loadManzanaFormas(client, ['a', 'b'])
  assert.equal(formas.get('a').length, 1250)
  assert.equal(formas.get('b').length, 50)
  assert.equal(consultas.length, 3)
  assert.ok(consultas.every(c => c.orden === 'id'), 'sin orden fijo las páginas se pisan')
})

test('sin territorios no consulta nada', async () => {
  const { client, consultas } = clienteDeMentira([])
  const formas = await loadManzanaFormas(client, [])
  assert.equal(formas.size, 0)
  assert.equal(consultas.length, 0)
})

test('si la base falla se rechaza: nunca se confunde con "no tiene manzanas"', async () => {
  const { client } = clienteDeMentira([], { falla: 'column geometry_geojson does not exist' })
  await assert.rejects(() => loadManzanaFormas(client, ['a']), /geometry_geojson/)
})

test('SanJuanMap no se cae al archivo estático ni lo pide', async () => {
  const fuente = await readFile(new URL('../src/components/SanJuanMap.tsx', import.meta.url), 'utf8')
  assert.doesNotMatch(fuente, /fetch\(['"`]\/datos\//)
  assert.doesNotMatch(fuente, /manzanaFormas|setManzanaFormas|respaldoPedido/)
  assert.match(fuente, /loadManzanaFormas\(client, faltan\)/)
})

test('el aviso dice la verdad: sin manzanas publicadas, y aparte cuando la consulta falló', async () => {
  const fuente = await readFile(new URL('../src/components/SanJuanMap.tsx', import.meta.url), 'utf8')
  assert.match(fuente, /Este territorio todavía no tiene manzanas publicadas\./)
  assert.match(fuente, /AVISO_FORMAS_CON_ERROR/)
  // Solo hay aviso de "sin manzanas" cuando la base contestó con una lista vacía.
  assert.match(fuente, /formasBase\.get\(selectedTerritoryId\)\?\.length === 0 \? AVISO_SIN_MANZANAS/)
})

test('el archivo de respaldo sigue en public/datos: lo usan scripts y vista-hermano.html', async () => {
  const archivo = await readFile(new URL('../public/datos/manzanas-territorios.json', import.meta.url), 'utf8')
  assert.ok(JSON.parse(archivo).territorios)
  const vista = await readFile(new URL('../vista-hermano.html', import.meta.url), 'utf8')
  assert.match(vista, /\/datos\/manzanas-territorios\.json/)
})
