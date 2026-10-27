// Ayuda para los tests que leen editor-manzanas.html como texto: recorta un
// tramo entre dos marcas y falla con un mensaje claro si alguna se renombró,
// en vez de devolver un tramo vacío que "pasa" sin probar nada.
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'

export const html = await readFile(new URL('../../editor-manzanas.html', import.meta.url), 'utf8')
export const body = html.slice(html.indexOf('<body>'), html.indexOf('<script src='))

export function tramo (desde, hasta) {
  const i = html.indexOf(desde)
  assert.ok(i >= 0, `no se encontró la marca inicial: ${desde}`)
  const j = html.indexOf(hasta, i + desde.length)
  assert.ok(j > i, `no se encontró la marca final: ${hasta}`)
  return html.slice(i, j)
}
