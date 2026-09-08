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

export function addBlock(document: EditorDocument, block: EditorBlock): EditorDocument {
  if (document.blocks[block.id]) throw new Error(`Ya existe la manzana ${block.id}.`)
  if (block.territoryId && !document.territories[block.territoryId]) {
    throw new Error(`No existe el territorio ${block.territoryId}.`)
  }
  polygonRingLatLng(block.geometry)
  return {
    ...document,
    blocks: {
      ...document.blocks,
      [block.id]: { ...block, edited: true },
    },
    touchedTerritoryIds: markTouched(document, [block.territoryId]),
  }
}

export function mergeBlocks(
  document: EditorDocument,
  keptBlockId: string,
  removedBlockId: string,
  geometry: EditorPolygon,
): EditorDocument {
  if (keptBlockId === removedBlockId) throw new Error('Elegí dos manzanas distintas para fusionar.')
  const kept = document.blocks[keptBlockId]
  const removed = document.blocks[removedBlockId]
  if (!kept || !removed) throw new Error('Una de las manzanas elegidas ya no existe.')
  if (kept.territoryId && removed.territoryId && kept.territoryId !== removed.territoryId) {
    throw new Error('Mové primero las manzanas al mismo territorio antes de fusionarlas.')
  }
  polygonRingLatLng(geometry)
  const blocks = { ...document.blocks }
  delete blocks[removedBlockId]
  blocks[keptBlockId] = {
    ...kept,
    geometry,
    territoryId: kept.territoryId ?? removed.territoryId,
    manualSideGroups: null,
    manualVertexCount: null,
    edited: true,
  }
  return {
    ...document,
    blocks,
    touchedTerritoryIds: markTouched(document, [kept.territoryId, removed.territoryId]),
  }
}

export function splitBlock(
  document: EditorDocument,
  blockId: string,
  newBlockId: string,
  geometries: readonly [EditorPolygon, EditorPolygon],
): EditorDocument {
  const block = document.blocks[blockId]
  if (!block) throw new Error(`No existe la manzana ${blockId}.`)
  if (document.blocks[newBlockId]) throw new Error(`Ya existe la manzana ${newBlockId}.`)
  geometries.forEach(polygonRingLatLng)
  const baseOrder = block.order ?? Object.values(document.blocks)
    .filter((candidate) => candidate.territoryId === block.territoryId)
    .length
  return {
    ...document,
    blocks: {
      ...document.blocks,
      [blockId]: {
        ...block,
        geometry: geometries[0],
        manualSideGroups: null,
        manualVertexCount: null,
        edited: true,
      },
      [newBlockId]: {
        ...block,
        id: newBlockId,
        sourceKey: null,
        geometry: geometries[1],
        label: null,
        order: baseOrder + 0.5,
        manualSideGroups: null,
        manualVertexCount: null,
        edited: true,
      },
    },
    touchedTerritoryIds: markTouched(document, [block.territoryId]),
  }
}

function alphabeticalLabel(index: number) {
  const alphabet = 'abcdefghijklmnopqrstuvwxyz'
  let value = index
  let label = ''
  do {
    label = alphabet[value % alphabet.length] + label
    value = Math.floor(value / alphabet.length) - 1
  } while (value >= 0)
  return label
}

export function relabelTerritoryBlocks(
  document: EditorDocument,
  territoryId: string,
  orderedBlockIds: readonly string[],
): EditorDocument {
  if (!document.territories[territoryId]) throw new Error(`No existe el territorio ${territoryId}.`)
  const expected = Object.values(document.blocks)
    .filter((block) => block.territoryId === territoryId)
    .map((block) => block.id)
  if (expected.length !== orderedBlockIds.length ||
    new Set(orderedBlockIds).size !== orderedBlockIds.length ||
    expected.some((id) => !orderedBlockIds.includes(id))) {
    throw new Error('El orden debe incluir una vez cada manzana del territorio.')
  }
  const blocks = { ...document.blocks }
  orderedBlockIds.forEach((id, index) => {
    blocks[id] = {
      ...document.blocks[id],
      label: alphabeticalLabel(index),
      order: index,
      edited: true,
    }
  })
  return {
    ...document,
    blocks,
    touchedTerritoryIds: markTouched(document, [territoryId]),
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
