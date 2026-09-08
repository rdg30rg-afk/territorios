import assert from 'node:assert/strict'
import test from 'node:test'
import { readFile } from 'node:fs/promises'

const [mapSource, workspaceSource] = await Promise.all([
  readFile(new URL('../src/components/SanJuanMap.tsx', import.meta.url), 'utf8'),
  readFile(new URL('../src/features/map-editor/data/loadEditorWorkspace.ts', import.meta.url), 'utf8'),
])

function assertSource(source, pattern, message) {
  assert.match(source, pattern, message)
}

test('el borrador solo se abre con modo edición y permiso administrativo', () => {
  assertSource(
    mapSource,
    /const client = supabase\s+const canManageTerritories = editingEnabled && canOpenAdminPanel\(profile, contexto\)/,
    'el mapa debe usar el cliente compartido y derivar el permiso del modo edición más el rol admin',
  )
  assertSource(
    mapSource,
    /if \(!client \|\| !canManageTerritories \|\| isLoading \|\| !territories\.length\) \{[\s\S]*?setEditorWorkspace\(null\)[\s\S]*?return\s*\}/,
    'la carga del borrador debe estar protegida por cliente, permiso admin, carga y territorios',
  )
  assertSource(
    mapSource,
    /void loadEditorWorkspace\(\s*createSupabaseEditorTransport\(client\),/,
    'el workspace debe abrirse a través del transport del cliente compartido',
  )
})

test('el workspace trae el dataset completo y el borrador por su RPC', () => {
  assertSource(
    workspaceSource,
    /loadAllEditorCandidates,\s*readEditorDraft,/,
    'el workspace debe importar la carga completa y la lectura del borrador',
  )
  assertSource(
    workspaceSource,
    /const \[candidates, remoteDraft\] = await Promise\.all\(\[[\s\S]*?loadAllEditorCandidates\(transport, signal\),[\s\S]*?readEditorDraft\(transport\),[\s\S]*?\]\)/,
    'el workspace debe consultar todo el dataset y el borrador RPC juntos',
  )
  assertSource(
    mapSource,
    /loadEditorWorkspace\(\s*createSupabaseEditorTransport\(client\),[\s\S]*?abortController\.signal,/,
    'la pantalla debe pasar el transport autenticado y la señal a la carga del workspace',
  )
})

test('salir o cambiar dependencias aborta la carga y evita resultados obsoletos', () => {
  assertSource(mapSource, /const abortController = new AbortController\(\)\s*let active = true/)
  assertSource(
    mapSource,
    /loadEditorWorkspace\([\s\S]*?abortController\.signal,[\s\S]*?\)\s*\.then\(\(workspace\) => \{\s*if \(active && loadingActor === liveEditorActor\.current\) \{[\s\S]*?setEditorWorkspace\(workspace\)/,
    'un resultado solo puede instalarse si el efecto sigue activo y pertenece al actor autenticado actual',
  )
  assertSource(
    mapSource,
    /return \(\) => \{\s*active = false\s*abortController\.abort\(\)\s*\}/,
    'la limpieza del efecto debe abortar al salir o cambiar sus dependencias',
  )
  assertSource(
    mapSource,
    /\}, \[canManageTerritories, client, isLoading, territories, recoveryStore\]\)/,
    'el cambio de permiso, cliente, carga, dataset o recuperación debe reiniciar la carga',
  )
  assertSource(
    workspaceSource,
    /if \(signal\?\.aborted\) throw new DOMException\('Carga cancelada', 'AbortError'\)/,
    'el workspace debe respetar la cancelación antes de devolver datos',
  )
})

test('un borrador ausente bloquea la apertura y no se convierte en estado vacío', () => {
  assertSource(
    workspaceSource,
    /if \(!remoteDraft\.state\) \{\s*throw new Error\(\s*'No hay un borrador compartido\.[\s\S]*?\)\s*\}/,
    'un borrador ausente debe producir un error accionable',
  )
  assertSource(
    workspaceSource,
    /draft: decodeEditorDraftState\(remoteDraft\.state, territories, candidates\)/,
    'solo se debe decodificar el estado remoto validado',
  )
})

test('la pantalla muestra carga, error, revisión, cantidad y legacy protegido', () => {
  assertSource(mapSource, /className="editor-workspace-status"/)
  assertSource(mapSource, /setIsLoadingEditorWorkspace\(true\)/)
  assertSource(mapSource, /editorWorkspaceError\s*\?/)
  assertSource(mapSource, /El taller sigue bloqueado:/)
  assertSource(mapSource, /Abriendo el borrador compartido…/)
  assertSource(
    mapSource,
    /Object\.values\(editorDocument\?\.blocks \?\? \{\}\)\.filter\(\(block\) => block\.territoryId\)\.length/,
    'debe mostrar la cantidad de manzanas asignadas',
  )
  assertSource(mapSource, /editorWorkspace\.revision/)
  assertSource(mapSource, /editorWorkspace\.draft\.migratedFromLegacy \? ' · formato anterior protegido' : ''/)
})

test('la edición local selecciona, asigna y conserva deshacer y rehacer', () => {
  assertSource(mapSource, /const recovery = recoveryStore\?\.read\(\)/)
  assertSource(mapSource, /createEditorHistory\(recovery\?\.document \?\? workspace\.draft\.document\)/)
  assert.doesNotMatch(mapSource, /setEditorHistory\(createEditorHistory\(editorHistory\.present\)\)/)
  assertSource(mapSource, /candidatePolygon\.on\('click',[\s\S]*?toggleEditorBlock\(draftBlock\.id\)/)
  assertSource(
    mapSource,
    /commitEditorChange\(current, \(document\) =>\s*assignBlocks\(document, selectedEditorBlockIds, territoryId\)/,
    'asignar o liberar debe pasar por el historial puro del editor',
  )
  assertSource(mapSource, /undoEditorChange\(current\)/)
  assertSource(mapSource, /redoEditorChange\(current\)/)
  assertSource(mapSource, /cambios locales sin guardar/)
  assertSource(
    mapSource,
    /removedSourceKeys[\s\S]*?discardedSourceKeys: \[\.\.\.new Set/,
    'las manzanas retiradas deben guardarse como descartadas y no reaparecer',
  )
})
