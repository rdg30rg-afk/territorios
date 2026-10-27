import assert from 'node:assert/strict'
import test from 'node:test'
import { readFile } from 'node:fs/promises'

import { MARCA_FONDO, MARCA_TINTA, desplazarPoligono, formasDeLaMarca, simboloSvg } from '../src/lib/marca.ts'

const publico = (ruta) => new URL(`../public/${ruta}`, import.meta.url)

test('tres manzanas llenas y la casa en contorno en la esquina de arriba a la derecha', () => {
  const formas = formasDeLaMarca({ trazo: 3.2 })
  const manzanas = formas.filter((f) => f.tipo === 'cuadrado')
  assert.deepEqual(manzanas.map((m) => [m.x, m.y, m.lado, m.color]), [
    [13, 13, 17, MARCA_TINTA],
    [13, 34, 17, MARCA_TINTA],
    [34, 34, 17, MARCA_TINTA],
  ])
  const [afuera, adentro] = formas.filter((f) => f.tipo === 'poligono')
  assert.equal(afuera.color, MARCA_TINTA)
  assert.equal(adentro.color, MARCA_FONDO)
  // La casa ocupa el lugar de la cuarta manzana, y el hueco queda adentro.
  for (const [x, y] of afuera.puntos) assert.ok(x >= 34 && x <= 51 && y >= 13 && y <= 30, `${x},${y}`)
  for (const [x, y] of adentro.puntos) assert.ok(x > 34 && x < 51 && y > 13.8 && y < 30, `${x},${y}`)
})

test('el contorno crece hacia adentro con el trazo', () => {
  assert.deepEqual(desplazarPoligono([[0, 0], [10, 0], [10, 10], [0, 10]], -1), [[1, 1], [9, 1], [9, 9], [1, 9]])
  const hueco = (trazo) => formasDeLaMarca({ trazo }).at(-1).puntos
  // Con más trazo el hueco es más chico: el piso sube.
  assert.ok(hueco(4.5)[3][1] < hueco(3.2)[3][1])
})

test('el favicon publicado es el que sale de marca.ts', async () => {
  // Si se cambia el color o el dibujo, hay que volver a correr
  // `node --experimental-strip-types scripts/generar-iconos.mjs`.
  assert.equal(await readFile(publico('favicon.svg'), 'utf8'), simboloSvg({ trazo: 4.5 }))
})

test('los íconos van con versión, para que el navegador y la CDN no muestren los viejos', async () => {
  const index = await readFile(new URL('../index.html', import.meta.url), 'utf8')
  for (const ruta of ['/favicon.ico', '/favicon.svg', '/pwa/icon-180.png']) {
    assert.ok(index.includes(`href="${ruta}?v=%VERSION_MARCA%"`), ruta)
  }
  const editor = await readFile(new URL('../editor-manzanas.html', import.meta.url), 'utf8')
  assert.ok(editor.includes('href="/favicon.svg?v=%VERSION_MARCA%"'))
  const config = await readFile(new URL('../vite.config.ts', import.meta.url), 'utf8')
  assert.equal((config.match(/src: `pwa\/[a-z0-9-]+\.png\?v=\$\{versionDeLaMarca\}`/g) ?? []).length, 4)
  // favicon.ico es un ICO de verdad, no la app en HTML.
  const ico = await readFile(publico('favicon.ico'))
  assert.deepEqual([...ico.subarray(0, 4)], [0, 0, 1, 0])
})

test('el manifest usa un ícono maskable propio, con la marca achicada', async () => {
  const config = await readFile(new URL('../vite.config.ts', import.meta.url), 'utf8')
  assert.match(config, /src: `pwa\/icon-maskable-512\.png\?v=\$\{versionDeLaMarca\}`,[\s\S]*?purpose: 'maskable'/)
  assert.match(simboloSvg({ escala: 0.8 }), /scale\(0\.8\)/)
  for (const ruta of ['pwa/icon-180.png', 'pwa/icon-192.png', 'pwa/icon-512.png', 'pwa/icon-maskable-512.png']) {
    const png = await readFile(publico(ruta))
    assert.equal(png.subarray(1, 4).toString(), 'PNG', ruta)
  }
})
