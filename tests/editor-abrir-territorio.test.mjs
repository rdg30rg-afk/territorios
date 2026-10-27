import assert from 'node:assert/strict'
import test from 'node:test'
import { readFile } from 'node:fs/promises'

const html = await readFile(new URL('../editor-manzanas.html', import.meta.url), 'utf8')
const source = html.slice(html.indexOf('<script type="module">'), html.lastIndexOf('</script>'))

function cuerpoDe (nombre) {
  const inicio = source.indexOf(`function ${nombre} (`)
  assert.notEqual(inicio, -1, `falta la función ${nombre}`)
  const fin = source.indexOf('\n}\n', inicio)
  return source.slice(inicio, fin)
}

test('con todo deseleccionado, tocar una manzana con territorio abre el territorio', () => {
  const alClic = cuerpoDe('alClic')
  const ver = alClic.slice(alClic.indexOf("if (herramienta === 'ver')"), alClic.indexOf("if (herramienta === 'borrar')"))
  assert.match(ver, /if \(!activo && m\.territorio && territorios\.has\(m\.territorio\)\)/)
  assert.match(ver, /abrirTerritorio\(m\.territorio\)/)
  // Abrir el territorio va antes que la ficha de la manzana, que queda para
  // cuando ya se trabaja adentro de uno o la manzana no tiene territorio.
  assert.ok(ver.indexOf('abrirTerritorio(') < ver.indexOf('abrirBurbuja('))
})

test('la lista y el mapa abren el territorio por el mismo camino', () => {
  const abrir = cuerpoDe('abrirTerritorio')
  for (const paso of ['activo = id', 'mzSel.clear()', 'enfocar(id)', 'refrescar()']) {
    assert.ok(abrir.includes(paso), `abrirTerritorio debe hacer ${paso}`)
  }
  assert.match(cuerpoDe('refrescarPanel'), /b\.onclick = \(\) => abrirTerritorio\(t\.id\)/)
})
