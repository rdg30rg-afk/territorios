import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'

const mapSource = readFileSync(new URL('../src/components/SanJuanMap.tsx', import.meta.url), 'utf8')

test('dividir y fusionar viven en el editor React y modifican el historial', () => {
  assert.match(mapSource, /mergeAdjacentPolygons/)
  assert.match(mapSource, /mergeBlocks\(document/)
  assert.match(mapSource, /splitPolygonByLine/)
  assert.match(mapSource, /splitBlock\(document/)
  assert.match(mapSource, />\s*Dividir\s*</)
  assert.match(mapSource, />\s*Fusionar\s*</)
})

test('el editor integrado expone vértices, retiro, reletrado y mudanza', () => {
  assert.match(mapSource, /updateBlockGeometry\(document/)
  assert.match(mapSource, />\s*Editar vértices\s*</)
  assert.match(mapSource, /removeSelectedEditorBlocks/)
  assert.match(mapSource, />\s*Reletrar territorio\s*</)
  assert.match(mapSource, /assignSelectedEditorBlocks\(selectedTerritoryId\)/)
})

test('dibujar manzanas y corregir caras también modifican el documento React', () => {
  assert.match(mapSource, /addBlock\(document/)
  assert.match(mapSource, /Dibujar manzana/)
  assert.match(mapSource, /setManualSideGroups\(document/)
  assert.match(mapSource, /Arreglar caras/)
  assert.match(mapSource, /Volver a automático/)
})

test('guardar borrador y publicar usan los contratos v2 dentro de Mapas', () => {
  assert.match(mapSource, /saveEditorDraft\(/)
  assert.match(mapSource, /reviewEditorPublicationV2\(/)
  assert.match(mapSource, /publishEditorPublicationV2\(/)
  assert.match(mapSource, /buildAtomicPublicationV2\(/)
  assert.match(mapSource, /crypto\.randomUUID\(\)/)
  assert.match(mapSource, /Guardar borrador/)
  assert.match(mapSource, /Revisar y publicar/)
})
