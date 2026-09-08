import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

const [pageSource, editorSource] = await Promise.all([
  readFile(new URL('../src/pages/MapasPage.tsx', import.meta.url), 'utf8'),
  readFile(new URL('../editor-manzanas.html', import.meta.url), 'utf8'),
])

function iframeRegion() {
  const iframeStart = pageSource.indexOf('<iframe')
  assert.notEqual(iframeStart, -1, 'Mapas debe montar un iframe para el editor administrativo')
  return pageSource.slice(Math.max(0, iframeStart - 800), iframeStart + 800)
}

test('el editor embebido conserva título y recibe el HTML versionado por srcDoc', () => {
  const region = iframeRegion()

  assert.match(region, /srcDoc\s*=\s*\{editorHtml\}/)
  assert.match(region, /title\s*=\s*["']Editor completo de manzanas y territorios["']/)
  assert.match(editorSource, /<title>Editor de manzanas · Territorios<\/title>/)
  assert.match(pageSource, /fetch\(`\/\$\{editorPath\}\?embed-session-bridge=2`/)
  assert.match(pageSource, /window\.__TERRITORIOS_APP_ORIGIN__/)
})

test('sólo el administrador recibe el iframe; SanJuanMap queda como fallback de consulta', () => {
  assert.match(pageSource, /import \{ canOpenAdminPanel \} from ['"]\.\.\/lib\/access['"]/)
  assert.match(pageSource, /const canEditMap\s*=\s*canOpenAdminPanel\(profile,\s*contexto\)/)

  const iframeStart = pageSource.indexOf('<iframe')
  const iframeGuard = pageSource.slice(Math.max(0, iframeStart - 800), iframeStart)
  assert.match(iframeGuard, /canEditMap\s*\?\s*\($/m)

  const mapStart = pageSource.indexOf('<SanJuanMap')
  assert.notEqual(mapStart, -1, 'debe conservar SanJuanMap como fallback')
  const mapRegion = pageSource.slice(Math.max(0, mapStart - 500), mapStart + 900)
  assert.match(mapRegion, /\)\s*:\s*\(/)
  assert.match(mapRegion, /editingEnabled\s*=\s*\{false\}/)
})

test('cambiar a Cobertura oculta el iframe sin desmontarlo', () => {
  const region = iframeRegion()

  assert.match(region, /hidden\s*=\s*\{\s*view\s*!==\s*['"]editor['"]\s*\}/)
  assert.doesNotMatch(region, /view\s*===\s*['"]editor['"]\s*\?/)
  assert.match(pageSource, /setView\(['"]cobertura['"]\)/)
})
