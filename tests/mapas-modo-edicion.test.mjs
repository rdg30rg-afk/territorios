import assert from 'node:assert/strict'
import test from 'node:test'
import { readFile } from 'node:fs/promises'

const [app, page, map, css] = await Promise.all([
  readFile(new URL('../src/App.tsx', import.meta.url), 'utf8'),
  readFile(new URL('../src/pages/MapasPage.tsx', import.meta.url), 'utf8'),
  readFile(new URL('../src/components/SanJuanMap.tsx', import.meta.url), 'utf8'),
  readFile(new URL('../src/styles/mapas-pagina.css', import.meta.url), 'utf8'),
])

test('/mapas inicia en consulta y entrega el modo explícito a SanJuanMap', () => {
  assert.match(app, /<Route\s+path="mapas"\s+element=\{loadRoute\(<MapasPage\s*\/>\)\}\s*\/>/)
  assert.match(page, /const \[editingEnabled,\s*setEditingEnabled\]\s*=\s*useState\(false\)/)
  assert.match(page, /<SanJuanMap[\s\S]*?editingEnabled=\{editingEnabled\}[\s\S]*?\/>/)
})

test('el botón de edición requiere permiso administrativo', () => {
  assert.match(page, /import \{ canOpenAdminPanel \} from '\.\.\/lib\/access'/)
  assert.match(page, /const canEditMap\s*=\s*canOpenAdminPanel\(profile,\s*contexto\)/)
  assert.match(page, /\{canEditMap\s*&&\s*view\s*===\s*'editor'\s*\?\s*\([\s\S]*?className=\{editingEnabled\s*\?\s*'map-mode-button is-active'\s*:\s*'map-mode-button'\}/)
})

test('al pasar a Cobertura se desactiva la edición', () => {
  assert.match(page, /const selectView\s*=\s*\(nextView:[\s\S]*?setView\(nextView\)[\s\S]*?if \(nextView === 'cobertura'\) setEditingEnabled\(false\)[\s\S]*?\}/)
  assert.match(page, /onClick=\{\(\) => selectView\('cobertura'\)\}[\s\S]*?>\s*Cobertura\s*<\/button>/)
})

test('SanJuanMap sólo habilita escritura con modo y permiso', () => {
  assert.match(map, /editingEnabled\?: boolean/)
  assert.match(map, /export function SanJuanMap\(\{\s*initialTerritoryId\s*=\s*null,\s*editingEnabled\s*=\s*false\s*\}: SanJuanMapProps\)/)
  assert.match(map, /const canManageTerritories\s*=\s*editingEnabled\s*&&\s*canOpenAdminPanel\(profile,\s*contexto\)/)
})

test('en móvil no se ofrece el botón de edición', () => {
  assert.match(css, /@media\s*\(max-width:\s*767px\)\s*\{[\s\S]*?\.map-mode-button\s*\{\s*display:\s*none;\s*\}[\s\S]*?\}/)
})

test('en consulta el control Leaflet Draw queda oculto', () => {
  assert.match(map, /className=\{editingEnabled\s*\?\s*'territory-console is-editing-map'\s*:\s*'territory-console'\}/)
  assert.match(css, /\.territory-console:not\(\.is-editing-map\)\s+\.leaflet-draw\s*\{\s*display:\s*none;\s*\}/)
})
