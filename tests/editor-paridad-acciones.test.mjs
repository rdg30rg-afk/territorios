import assert from 'node:assert/strict'
import test from 'node:test'
import { readFile } from 'node:fs/promises'

const html = await readFile(new URL('../editor-manzanas.html', import.meta.url), 'utf8')
const body = html.slice(html.indexOf('<body>'), html.indexOf('<script src='))
const scriptStart = html.indexOf('<script type="module">')
const scriptEnd = html.lastIndexOf('</script>')
assert.notEqual(scriptStart, -1, 'el editor debe conservar su módulo JavaScript')
assert.notEqual(scriptEnd, -1, 'el editor debe cerrar su módulo JavaScript')
const source = html.slice(scriptStart, scriptEnd)

function hasDomId (id) {
  return new RegExp(`<[^>]+\\bid="${id}"(?:\\s|>)`).test(body)
}

function assertDomId (id) {
  assert.equal(hasDomId(id), true, `falta el control DOM #${id}`)
}

function assertSource (pattern, message) {
  assert.match(source, pattern, message)
}

test('el DOM conserva todas las herramientas críticas del editor legado', () => {
  const botones = [...body.matchAll(/<button\b[^>]*data-h="([^"]+)"[^>]*>([\s\S]*?)<\/button>/g)]
  const herramientas = botones.map(([, herramienta]) => herramienta)
  // El menú va en dos grupos con rótulo (E6): Dibujo y Territorio. El orden
  // en pantalla sigue a los grupos; los atajos 1-9 no, porque están atados a la
  // herramienta (se verifican más abajo).
  const esperadas = ['ver', 'dibujar', 'dividir', 'fusionar', 'editar', 'borrar', 'marcar', 'mover', 'letras', 'caras']

  assert.deepEqual(herramientas, esperadas)
  // Agrupar no puede perder ni sumar herramientas.
  assert.deepEqual([...herramientas].sort(),
    ['borrar', 'caras', 'dibujar', 'dividir', 'editar', 'fusionar', 'letras', 'marcar', 'mover', 'ver'])

  const grupos = [...body.matchAll(/<div class="herr-grupo"[^>]*>\s*<p class="herr-rotulo"[^>]*>([^<]+)<\/p>([\s\S]*?)<\/div>/g)]
    .map(([, rotulo, cuerpo]) => [rotulo, [...cuerpo.matchAll(/data-h="([^"]+)"/g)].map(([, h]) => h)])
  assert.deepEqual(grupos, [
    ['Dibujo', ['dibujar', 'dividir', 'fusionar', 'editar', 'borrar']],
    ['Territorio', ['marcar', 'mover', 'letras', 'caras']],
  ])
  assert.match(body, /role="group" aria-labelledby="rotDibujo"/)
  assert.match(body, /role="group" aria-labelledby="rotTerritorio"/)

  // Los atajos quedan iguales: el número que se ve en el botón y la tabla del teclado.
  const atajos = Object.fromEntries(botones
    .map(([, h, contenido]) => [h, contenido.match(/<span class="k">(\d)<\/span>/)?.[1]])
    .filter(([, k]) => k))
  assert.deepEqual(atajos, { dibujar: '1', dividir: '2', fusionar: '3', mover: '4', editar: '5', marcar: '6', borrar: '7', caras: '8', letras: '9' })
  assertSource(/const map = \{ 1: 'dibujar', 2: 'dividir', 3: 'fusionar', 4: 'mover', 5: 'editar', 6: 'marcar', 7: 'borrar', 8: 'caras', 9: 'letras' \}/,
    'la tabla de atajos del teclado no puede cambiar')
  for (const herramienta of esperadas) {
    assertSource(
      new RegExp(`herramienta === '${herramienta}'|data-h="${herramienta}"`),
      `falta la implementación fuente de la herramienta ${herramienta}`,
    )
  }

  assert.match(body, /data-h="ver"[^>]*>[\s\S]*?Solo mirar/)
  assert.match(body, /data-h="dibujar"[^>]*>[\s\S]*?Dibujar manzana/)
  assert.match(body, /data-h="dividir"[^>]*>[\s\S]*?Dividir manzana/)
  assert.match(body, /data-h="fusionar"[^>]*>[\s\S]*?Fusionar manzanas/)
  assert.match(body, /data-h="mover"[^>]*>[\s\S]*?Mover a territorio/)
  assert.match(body, /data-h="editar"[^>]*>[\s\S]*?Editar vértices/)
  assert.match(body, /data-h="marcar"[^>]*>[\s\S]*?Marcar manzanas/)
  assert.match(body, /data-h="borrar"[^>]*>[\s\S]*?Borrar manzana/)
  assert.match(body, /data-h="caras"[^>]*>[\s\S]*?Arreglar caras/)
  assert.match(body, /data-h="letras"[^>]*>[\s\S]*?Poner las letras/)

  assertSource(/function dividir\s*\(/, 'falta dividir manzanas')
  assertSource(/function fusionar\s*\(/, 'falta fusionar manzanas')
  assertSource(/function iniciarEdicion\s*\(/, 'falta editar vértices')
  assertSource(/function pintarCaras\s*\(/, 'falta arreglar caras')
  assertSource(/function aplicarLetrasNuevas\s*\(/, 'falta poner letras a mano')
})

test('undo y redo siguen disponibles por estado, teclado y barra móvil', () => {
  assertSource(/let historial\s*=\s*\[\]/, 'falta el historial para undo')
  assertSource(/let rehechos\s*=\s*\[\]/, 'falta la pila de redo')
  assertSource(/function instantanea\s*\(/, 'falta tomar instantáneas antes de editar')
  assertSource(/function deshacer\s*\(/, 'falta deshacer')
  assertSource(/function rehacer\s*\(/, 'falta rehacer')
  assertSource(/if \(e\.shiftKey\) rehacer\(\); else deshacer\(\)/, 'falta Cmd/Ctrl+Shift+Z para rehacer')
  assertSource(/document\.getElementById\('mDeshacer'\)\.onclick/, 'falta el control móvil de deshacer')
  assertDomId('mDeshacer')
  assert.match(body, /id="mDeshacer"[^>]*>[\s\S]*?Deshacer/)
})

test('importar y exportar conservan controles, JSON y restauración de estado', () => {
  assertDomId('bExport')
  assertDomId('bImport')
  assertDomId('fImport')
  assert.match(body, /id="bExport"[^>]*>[\s\S]*?Exportar/)
  assert.match(body, /id="bImport"[^>]*>[\s\S]*?Importar/)
  assert.match(body, /id="fImport"[^>]*accept="application\/json"/)

  assertSource(/document\.getElementById\('bExport'\)\.onclick\s*=/)
  assertSource(/URL\.createObjectURL\(new Blob\(\[JSON\.stringify\(datos, null, 2\)\]/)
  assertSource(/a\.download\s*=\s*'territorios\.json'/)
  assertSource(/document\.getElementById\('bImport'\)\.onclick\s*=/)
  assertSource(/document\.getElementById\('fImport'\)\.onchange\s*=/)
  // Importar lee con JSON.parse dentro de un try, valida la forma ANTES de
  // tocar nada y recién después toma la instantánea y reemplaza el estado.
  assertSource(/try \{ d = JSON\.parse\(await f\.text\(\)\) \} catch/)
  assertSource(/const v = validarImportacion\(d\)/)
  assertSource(/territorios\s*=\s*new Map\(v\.territorios\.map/)
  assertSource(/for \(const mm of v\.manzanas\)/)
  const importar = source.slice(source.indexOf("document.getElementById('fImport').onchange"))
  assert.ok(importar.indexOf('validarImportacion(d)') < importar.indexOf('instantanea()'),
    'la instantánea va después de validar, nunca antes')
})

test('el borrador remoto se lee, se agrupa y se escribe con control de versión', () => {
  assertSource(/const BORRADOR_ID\s*=\s*'manzanas'/)
  assertSource(/let borradorSello\s*=\s*null/)
  assertSource(/let borradorPendiente\s*=\s*null/)
  assertSource(/async function leerBorrador\s*\(\)/)
  assertSource(/function guardarBorrador\s*\(datos\)/)
  assertSource(/async function escribirBorrador\s*\(\)/)
  assertSource(/editor_estado\?id=eq\.\$\{BORRADOR_ID\}/)
  assertSource(/borradorPendiente\s*=\s*datos/)
  assertSource(/setTimeout\(\(\) => void escribirBorrador\(\), 1200\)/)
  assertSource(/if \(borradorSello\)[\s\S]*?method: 'PATCH'/)
  assertSource(/method: 'POST'[\s\S]*?editor_estado/)
  assertSource(/actualizado_at=eq\.\$\{encodeURIComponent\(borradorSello\)\}/)
  assertSource(/if \(!baseLeida\) \{ borradorEstado = 'local'/)
  assertSource(/if \(borradorEstado === 'guardado' && borradorPendiente\)/)
})

test('sin sesión y conflicto tienen estados visibles y bloquean escritura peligrosa', () => {
  assertSource(/borradorEstado\s*=\s*'sin_sesion'/)
  assertSource(/borradorEstado\s*=\s*'conflicto'/)
  assertSource(/sin_sesion:\s*\[sesionVencida[\s\S]*?Sin sesión: tu trabajo no se está guardando/)
  assertSource(/conflicto:\s*\['Otra persona guardó después que vos\.[\s\S]*?Recargá antes de seguir\./)
  assertSource(/if \(borradorEstado === 'conflicto'\) return/)
  assertSource(/r\.status === 409/)
  assertSource(/sesionVencida \? 'Tu sesión venció' : 'Falta iniciar sesión'/)
  assertSource(/if \(!token\) \{[\s\S]*?await dialogo\(/)
  assertSource(/Otra pestaña creó el borrador\.[\s\S]*?recargá antes de reemplazar/)
})

test('la revisión del dibujo conserva diagnóstico, lista y acciones de revisión', () => {
  assertDomId('cRevisar')
  assertDomId('panelRevision')
  assertDomId('listaRev')
  assertDomId('bDesRevisar')
  assertDomId('bLimpiar')
  assert.match(body, /id="cRevisar"[^>]*>\s*revisar dibujo/)
  assert.match(body, /id="panelRevision"[^>]*>[\s\S]*?A revisar/)

  assertSource(/let verRevision\s*=\s*false/)
  assertSource(/function diagnosticar\s*\(/)
  assertSource(/function refrescarRevision\s*\(/)
  assertSource(/const SIN_VIVIENDAS|let SIN_VIVIENDAS/)
  assertSource(/document\.getElementById\('cRevisar'\)\.onchange/)
  assertSource(/document\.getElementById\('bDesRevisar'\)\.onclick/)
  assertSource(/const bLimpiar = document\.getElementById\('bLimpiar'\)/)
  assertSource(/bLimpiar\.onclick/)
  assertSource(/revisadas\.add\(m\.id\)/)
  assertSource(/m\.editada\)/)
})

test('la publicación revisa versiones y envía un lote atómico completo', () => {
  assertDomId('bGuardarBD')
  assert.match(body, /id="bGuardarBD"[^>]*>[\s\S]*?Guardar este territorio/)

  const revisionAt = source.indexOf("rpcEditor('revisar_publicacion_editor'")
  const publishAt = source.indexOf("rpcEditor('publicar_territorios_atomico'")
  assert.ok(revisionAt >= 0, 'falta revisar_publicacion_editor')
  assert.ok(publishAt >= 0, 'falta publicar_territorios_atomico')
  assert.ok(revisionAt < publishAt, 'la revisión de versión debe ocurrir antes de publicar')

  assertSource(/const capturas = aPublicar\.map\([\s\S]*?JSON\.parse\(JSON\.stringify\(prepararTerritorio\(x\)\)\)/)
  assertSource(/const versiones = await rpcEditor\('revisar_publicacion_editor'/)
  assertSource(/version_esperada:\s*revision\.version/)
  assertSource(/const lote = capturas\.map\([\s\S]*?manzanas: x\.manzanas/)
  assertSource(/const resultados = renumeraciones\.length \|\| colores\.length[\s\S]*?rpcEditor\('publicar_editor_con_renumeracion'[\s\S]*?rpcEditor\('publicar_territorios_atomico', \{ p_territorios: lote \}, token\)/)
  assertSource(/resultados\.length !== capturas\.length/)
  assertSource(/Se guarda el lote completo o ninguno\./)
  assertSource(/publicacionEnVuelo\s*=\s*true[\s\S]*?boton\.disabled\s*=\s*true/)
  assertSource(/finally \{[\s\S]*?publicacionEnVuelo\s*=\s*false[\s\S]*?boton\.disabled\s*=\s*false/)
})

test('mover una manzana marca explícitamente origen y destino para el mismo lote', () => {
  const inicioMover = source.indexOf("if (herramienta === 'marcar' || herramienta === 'mover')")
  const finMover = source.indexOf("if (herramienta === 'fusionar')", inicioMover)
  assert.ok(inicioMover >= 0, 'falta la rama de marcar/mover')
  assert.ok(finMover > inicioMover, 'la rama de mover debe estar completa')
  const mover = source.slice(inicioMover, finMover)

  assert.match(mover, /const anterior = m\.territorio/)
  assert.match(mover, /m\.territorio = activo/)
  assert.match(mover, /if \(anterior && anterior !== activo\) \{ tocados\.add\(activo\); tocados\.add\(anterior\) \}/)
  assert.match(mover, /reletrar\(activo\)/)
  assert.match(mover, /reletrar\(anterior\)/)

  assertSource(/const arrastrados = \[\.\.\.tocados\][\s\S]*?id !== activo/)
  assertSource(/const vaciados = \[\.\.\.tocados\][\s\S]*?!mzDe\(id\)\.length/)
  assertSource(/const aPublicar = \[\.\.\.new Map\(\[t, \.\.\.arrastrados, \.\.\.vaciados, \.\.\.renumerados\]/)
})
