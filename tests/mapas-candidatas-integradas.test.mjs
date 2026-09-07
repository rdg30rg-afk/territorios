import assert from 'node:assert/strict'
import test from 'node:test'
import { readFile } from 'node:fs/promises'

const [mapSource, repositorySource] = await Promise.all([
  readFile(new URL('../src/components/SanJuanMap.tsx', import.meta.url), 'utf8'),
  readFile(new URL('../src/features/map-editor/data/editorRepository.ts', import.meta.url), 'utf8'),
])

function assertSource(source, pattern, message) {
  assert.match(source, pattern, message)
}

test('las candidatas se cargan con el cliente autenticado compartido', () => {
  assertSource(
    mapSource,
    /import \{ isSupabaseConfigured, supabase \} from '\.\.\/lib\/supabase'/,
    'SanJuanMap debe usar el cliente compartido que conserva la sesión',
  )
  assertSource(mapSource, /const client\s*=\s*supabase/)
  assertSource(
    mapSource,
    /loadEditorCandidates\(\s*createSupabaseEditorTransport\(client\),/,
    'la carga debe pasar por el repositorio usando ese cliente',
  )
  assertSource(
    repositorySource,
    /createSupabaseEditorTransport\(client:\s*SupabaseClient\)[\s\S]*?client\s*\.from\('manzana_candidatas'\)/,
    'el repositorio debe consultar candidatas mediante SupabaseClient',
  )
  assertSource(repositorySource, /\.eq\('activa',\s*true\)/)
})

test('el umbral de zoom gobierna tanto la consulta como el dibujo', () => {
  assertSource(mapSource, /const EDITOR_CANDIDATE_ZOOM\s*=\s*14\b/)
  assertSource(
    mapSource,
    /layer\?\.clearLayers\(\)[\s\S]*?if \(!layer \|\| !editingEnabled \|\| mapZoom < EDITOR_CANDIDATE_ZOOM\) return[\s\S]*?for \(const candidate of editorCandidates\)/,
    'la capa no debe dibujar candidatas por debajo del umbral',
  )
  assertSource(
    mapSource,
    /if \(!client \|\| !map \|\| !editingEnabled \|\| mapZoom < EDITOR_CANDIDATE_ZOOM\) \{[\s\S]*?return\s*\}/,
    'la base no debe consultarse por debajo del umbral',
  )
})

test('los pedidos viejos se abortan hasta el transporte paginado', () => {
  assertSource(mapSource, /const abortController\s*=\s*new AbortController\(\)/)
  assertSource(
    mapSource,
    /loadEditorCandidates\([\s\S]*?abortController\.signal,[\s\S]*?return \(\) => abortController\.abort\(\)/,
    'cada efecto debe cancelar su pedido al ser reemplazado o desmontado',
  )
  assertSource(mapSource, /loadError\.name === 'AbortError'\) return/)
  assertSource(mapSource, /if \(!abortController\.signal\.aborted\) setIsLoadingCandidates\(false\)/)
  assertSource(repositorySource, /signal\?: AbortSignal/)
  assertSource(repositorySource, /if \(signal\) query = query\.abortSignal\(signal\)/)
  assertSource(repositorySource, /if \(signal\?\.aborted\) throw new DOMException\('Carga cancelada', 'AbortError'\)/)
  assertSource(
    repositorySource,
    /transport\.queryCandidates\([\s\S]*?from \+ CANDIDATE_PAGE_SIZE - 1,[\s\S]*?signal,[\s\S]*?\)/,
    'el mismo AbortSignal debe llegar a cada página',
  )
})

test('el estado de candidatas es visible durante la edición', () => {
  assertSource(mapSource, /\{editingEnabled && !modoEdicion \? \([\s\S]*?className="territory-map-help editor-candidate-status"/)
  for (const message of [
    'No se pudo cargar la base de manzanas:',
    'Acercate al barrio para ver la base de manzanas.',
    'Cargando manzanas del encuadre…',
    'manzanas de referencia en este encuadre.',
  ]) {
    assert.ok(mapSource.includes(message), `falta el estado visible: ${message}`)
  }
})

test('cerrar edición limpia candidatas, capa, errores y herramientas activas', () => {
  assertSource(
    mapSource,
    /if \(!client \|\| !map \|\| !editingEnabled \|\| mapZoom < EDITOR_CANDIDATE_ZOOM\) \{\s*setEditorCandidates\(\[\]\)\s*setIsLoadingCandidates\(false\)\s*setCandidateError\(null\)\s*return\s*\}/,
    'salir de edición debe limpiar el estado de la carga',
  )
  assertSource(
    mapSource,
    /const layer\s*=\s*candidateLayerRef\.current\s*layer\?\.clearLayers\(\)\s*if \(!layer \|\| !editingEnabled/,
    'salir de edición debe vaciar la capa de candidatas',
  )
  assertSource(
    mapSource,
    /if \(previousEditingEnabled\.current && !editingEnabled\) resetEditor\(\)/,
    'la transición de edición a consulta debe reiniciar el editor',
  )
  assertSource(mapSource, /\}, \[client, editingEnabled, mapZoom, vistaMovida\]\)/)
})
