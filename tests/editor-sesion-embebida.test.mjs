import assert from 'node:assert/strict'
import test from 'node:test'
import { readFile } from 'node:fs/promises'

const html = await readFile(new URL('../editor-manzanas.html', import.meta.url), 'utf8')
const mapasPage = await readFile(new URL('../src/pages/MapasPage.tsx', import.meta.url), 'utf8')

test('el editor srcDoc deriva el origen confiable desde la app contenedora', () => {
  assert.match(html, /new URL\(document\.referrer\)\.origin/)
  assert.match(html, /evento\.origin !== ORIGEN_APP/)
  assert.match(html, /evento\.source !== parent/)
  assert.match(html, /parent\.postMessage\(\{ type: 'territorios:editor:request-session' \}, ORIGEN_APP\)/)
  assert.doesNotMatch(html, /evento\.origin !== location\.origin/)
})

test('la app versiona el editor embebido para no reutilizar una copia PWA anterior', () => {
  assert.match(mapasPage, /window\.location\.hostname/)
  assert.match(mapasPage, /editorPath = hostLocal \? 'editor-manzanas\.html' : 'editor-manzanas-embedded\.html'/)
  assert.match(mapasPage, /editorPath\}\?embed-session-bridge=2/)
})
