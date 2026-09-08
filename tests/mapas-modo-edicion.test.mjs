import assert from 'node:assert/strict'
import test from 'node:test'
import { readFile } from 'node:fs/promises'

const [app, page, map, css] = await Promise.all([
  readFile(new URL('../src/App.tsx', import.meta.url), 'utf8'),
  readFile(new URL('../src/pages/MapasPage.tsx', import.meta.url), 'utf8'),
  readFile(new URL('../src/components/SanJuanMap.tsx', import.meta.url), 'utf8'),
  readFile(new URL('../src/styles/mapas-pagina.css', import.meta.url), 'utf8'),
])

test('/mapas inicia en el editor completo y conserva SanJuanMap como consulta sin escritura', () => {
  assert.match(app, /<Route\s+path="mapas"\s+element=\{loadRoute\(<MapasPage\s*\/>\)\}\s*\/>/)
  assert.match(page, /const \[view,\s*setView\]\s*=\s*useState<'editor' \| 'cobertura'>\('editor'\)/)
  assert.match(page, /<SanJuanMap[\s\S]*?editingEnabled=\{false\}[\s\S]*?\/>/)
})

test('el editor completo requiere permiso administrativo', () => {
  assert.match(page, /import \{ canOpenAdminPanel \} from '\.\.\/lib\/access'/)
  assert.match(page, /const canEditMap\s*=\s*canOpenAdminPanel\(profile,\s*contexto\)/)
  assert.match(page, /\{canEditMap\s*\?\s*\([\s\S]*?<iframe[\s\S]*?srcDoc=\{editorHtml\}/)
})

test('al pasar a Cobertura el editor se oculta sin desmontarse', () => {
  assert.match(page, /<div hidden=\{view !== 'editor'\} className="editor-integrado-container">/)
  assert.match(page, /onClick=\{\(\) => setView\('cobertura'\)\}/)
  assert.match(page, /\{view === 'cobertura' \? <CoverageHeatmapPanel/)
})

test('SanJuanMap sólo habilita escritura con modo y permiso', () => {
  assert.match(map, /editingEnabled\?: boolean/)
  assert.match(map, /export function SanJuanMap\(\{\s*initialTerritoryId\s*=\s*null,\s*editingEnabled\s*=\s*false,\s*onPendingChange\s*\}: SanJuanMapProps\)/)
  assert.match(map, /useEffect\(\(\) => \{ onPendingChange\?\.\(editorPending\) \}, \[editorPending, onPendingChange\]\)/)
  assert.match(map, /const canManageTerritories\s*=\s*editingEnabled\s*&&\s*canOpenAdminPanel\(profile,\s*contexto\)/)
})

test('en móvil no se ofrece el botón de edición', () => {
  assert.match(css, /@media\s*\(max-width:\s*767px\)\s*\{[\s\S]*?\.map-mode-button\s*\{\s*display:\s*none;\s*\}[\s\S]*?\}/)
})

test('en consulta el control Leaflet Draw queda oculto', () => {
  assert.match(map, /className=\{editingEnabled\s*\?\s*'territory-console is-editing-map'\s*:\s*'territory-console'\}/)
  assert.match(css, /\.territory-console:not\(\.is-editing-map\)\s+\.leaflet-draw\s*\{\s*display:\s*none;\s*\}/)
})
