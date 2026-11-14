import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

const [page, editor] = await Promise.all([
  readFile(new URL('../src/pages/MapasPage.tsx', import.meta.url), 'utf8'),
  readFile(new URL('../editor-manzanas.html', import.meta.url), 'utf8'),
])

test('Mapas arranca siempre en solo lectura: el editor solo se monta con edición confirmada', () => {
  assert.match(page, /useState\(false\)/)
  assert.match(page, /const \[editando, setEditando\] = useState\(false\)/)
  assert.match(page, /if \(!enEdicion \|\| editorHtml \|\| modoSimulacion\) return/)
  // Ningún parámetro de la URL activa la edición.
  assert.doesNotMatch(page, /get\('editar'\)/)
  assert.doesNotMatch(page, /useState\(false\)[\s\S]{0,40}searchParams/)
})

test('el botón y el diálogo de confirmación existen y el foco inicial va en Cancelar', () => {
  assert.match(page, /\{canEditMap && view === 'editor' && !enEdicion \?/)
  assert.match(page, /Editar el mapa/)
  assert.match(page, /Sí, editar el mapa/)
  assert.match(page, /Vas a trabajar sobre el borrador compartido\. Lo que publiques cambia el mapa que usan los hermanos\./)
  assert.match(page, /botonCancelarEntrada\.current\?\.focus\(\)/)
  assert.match(page, /ref=\{botonCancelarEntrada\}/)
  // El único setEditando(true) está detrás del botón de confirmar.
  assert.equal((page.match(/setEditando\(true\)/g) ?? []).length, 1)
  assert.match(page, /setConfirmandoEntrada\(false\); if \(canEditMap\) setEditando\(true\)/)
})

test('la franja de edición y el aviso de salida con cambios sin guardar (M11)', () => {
  assert.match(page, /Estás editando el mapa/)
  assert.match(page, /Salir de la edición/)
  assert.match(page, /territorios:editor:cambios/)
  assert.match(page, /document\.addEventListener\('click', alTocarEnlace, true\)/)
  assert.match(page, /if \(enEdicion && siguiente === 'cobertura'\) \{ pedirSalida/)
  assert.match(page, /Salir sin guardar/)
})

test('el editor le avisa al padre si hay trabajo sin guardar', () => {
  assert.match(editor, /type: 'territorios:editor:cambios', sinGuardar: ahora/)
  assert.match(editor, /window\.self !== window\.top && ORIGEN_APP/)
})

test('M1: Cancelar, Esc y clic afuera nunca suben la copia local', () => {
  // El diálogo tiene un tercer botón explícito para la copia local.
  assert.match(editor, /alternativa: 'Usar el de esta computadora'/)
  assert.match(editor, /if \(alt\) \{ resolver\('alternativa'\); return \}/)
  // Escape y clic afuera siguen cerrando con false -> null.
  assert.match(editor, /if \(e\.key === 'Escape'\) \{ e\.stopPropagation\(\); cerrar\(false\) \}/)
  assert.match(editor, /velo\.onclick = \(e\) => \{ if \(e\.target === velo\) cerrar\(false\) \}/)
  // Solo 'alternativa' + segunda confirmación elige la copia local; lo demás es la base.
  assert.match(editor, /Esto reemplaza el borrador de todos/)
  assert.match(editor, /if \(r === 'alternativa'\) \{[\s\S]*?if \(seguro\) eleccion = 'local'[\s\S]*?\} else \{\s*eleccion = 'base'/)
  assert.doesNotMatch(editor, /const usarBase = await dialogo/)
})
