import { polygonRingLatLng } from '../geometry/blockGeometry.ts'
import type {
  EditorBlock,
  EditorDocument,
  EditorHistory,
  EditorPolygon,
  EditorTerritory,
  ManualSideGroups,
} from './types.ts'

function indexById<T extends { id: string }>(items: readonly T[]) {
  return Object.fromEntries(items.map((item) => [item.id, { ...item }])) as Record<string, T>
}

function unique(values: readonly string[]) {
  return [...new Set(values)]
}

function markTouched(document: EditorDocument, territoryIds: Array<string | null>) {
  return unique([
    ...document.touchedTerritoryIds,
    ...territoryIds.filter((id): id is string => Boolean(id)),
  ])
}

export function createEditorDocument(
  territories: readonly EditorTerritory[],
  blocks: readonly EditorBlock[],
): EditorDocument {
  for (const block of blocks) polygonRingLatLng(block.geometry)
  return {
    territories: indexById(territories),
    blocks: indexById(blocks),
    touchedTerritoryIds: [],
  }
}

export function assignBlocks(
  document: EditorDocument,
  blockIds: readonly string[],
  territoryId: string | null,
): EditorDocument {
  if (territoryId && !document.territories[territoryId]) {
    throw new Error(`No existe el territorio ${territoryId}.`)
  }

  const blocks = { ...document.blocks }
  const affectedTerritories: Array<string | null> = []
  let changed = false
  for (const blockId of unique(blockIds)) {
    const block = document.blocks[blockId]
    if (!block) throw new Error(`No existe la manzana ${blockId}.`)
    if (block.territoryId === territoryId) continue
    affectedTerritories.push(block.territoryId, territoryId)
    blocks[blockId] = { ...block, territoryId, edited: true }
    changed = true
  }

  if (!changed) return document
  return {
    ...document,
    blocks,
    touchedTerritoryIds: markTouched(document, affectedTerritories),
  }
}

export function updateBlockGeometry(
  document: EditorDocument,
  blockId: string,
  geometry: EditorPolygon,
): EditorDocument {
  const block = document.blocks[blockId]
  if (!block) throw new Error(`No existe la manzana ${blockId}.`)
  const previousVertexCount = polygonRingLatLng(block.geometry).length
  const nextVertexCount = polygonRingLatLng(geometry).length
  const keepsManualSides = previousVertexCount === nextVertexCount

  return {
    ...document,
    blocks: {
      ...document.blocks,
      [blockId]: {
        ...block,
        geometry,
        manualSideGroups: keepsManualSides ? block.manualSideGroups : null,
        manualVertexCount: keepsManualSides ? block.manualVertexCount : null,
        edited: true,
      },
    },
    touchedTerritoryIds: markTouched(document, [block.territoryId]),
  }
}

export function setManualSideGroups(
  document: EditorDocument,
  blockId: string,
  groups: ManualSideGroups | null,
): EditorDocument {
  const block = document.blocks[blockId]
  if (!block) throw new Error(`No existe la manzana ${blockId}.`)
  const vertexCount = polygonRingLatLng(block.geometry).length
  if (
    groups &&
    groups.some(
      (group) =>
        group.length < 2 ||
        group.some((index) => !Number.isInteger(index) || index < 0 || index >= vertexCount),
    )
  ) {
    throw new Error('La corrección manual contiene vértices inválidos.')
  }

  return {
    ...document,
    blocks: {
      ...document.blocks,
      [blockId]: {
        ...block,
        manualSideGroups: groups?.map((group) => [...group]) ?? null,
        manualVertexCount: groups ? vertexCount : null,
        edited: true,
      },
    },
    touchedTerritoryIds: markTouched(document, [block.territoryId]),
  }
}

export function removeBlock(document: EditorDocument, blockId: string): EditorDocument {
  const block = document.blocks[blockId]
  if (!block) throw new Error(`No existe la manzana ${blockId}.`)
  const blocks = { ...document.blocks }
  delete blocks[blockId]
  return {
    ...document,
    blocks,
    touchedTerritoryIds: markTouched(document, [block.territoryId]),
  }
}

export function createEditorHistory(document: EditorDocument): EditorHistory {
  return { present: document, past: [], future: [] }
}

export function commitEditorChange(
  history: EditorHistory,
  change: (document: EditorDocument) => EditorDocument,
): EditorHistory {
  const next = change(history.present)
  if (next === history.present) return history
  return { present: next, past: [...history.past, history.present], future: [] }
}

export function undoEditorChange(history: EditorHistory): EditorHistory {
  const previous = history.past.at(-1)
  if (!previous) return history
  return {
    present: previous,
    past: history.past.slice(0, -1),
    future: [history.present, ...history.future],
  }
}

export function redoEditorChange(history: EditorHistory): EditorHistory {
  const next = history.future[0]
  if (!next) return history
  return {
    present: next,
    past: [...history.past, history.present],
    future: history.future.slice(1),
  }
}
