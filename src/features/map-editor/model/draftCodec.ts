import { polygonCenter, polygonRingLatLng } from '../geometry/blockGeometry.ts'
import type { EditorCandidate } from '../data/editorRepository.ts'
import { createEditorDocument } from './editorDocument.ts'
import type { EditorBlock, EditorDocument, EditorPolygon, EditorTerritory } from './types.ts'

type LegacyTerritory = {
  id: string
  numero: string
  sector?: string | null
  color?: string | null
  letras?: 'orden' | 'proximidad'
}

export type EditorDraftStateV2 = {
  schema_version: 2
  dataset_version: string
  document: EditorDocument
  discarded_source_keys: string[]
  reviewed_block_ids: string[]
}

export type DecodedEditorDraft = {
  document: EditorDocument
  datasetVersion: string
  discardedSourceKeys: string[]
  reviewedBlockIds: string[]
  migratedFromLegacy: boolean
}

function record(value: unknown, message: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(message)
  return value as Record<string, unknown>
}

function array(value: unknown, field: string): unknown[] {
  if (value === undefined) return []
  if (!Array.isArray(value)) throw new Error(`El campo legado ${field} no es una lista.`)
  return value
}

function text(value: unknown, field: string) {
  if (typeof value !== 'string' || !value.trim()) {
    throw new Error(`El campo ${field} del borrador es inválido.`)
  }
  return value.trim()
}

function normalizeNumber(value: unknown) {
  return String(value ?? '').trim().toLocaleLowerCase('es-AR')
}

function uniqueStrings(value: unknown, field: string) {
  return [...new Set(array(value, field).map((item) => text(item, field)))]
}

function candidateIndexes(candidates: readonly EditorCandidate[]) {
  const byId = new Map<string, EditorCandidate>()
  const bySourceKey = new Map<string, EditorCandidate>()
  const versions = new Set<string>()
  for (const candidate of candidates) {
    if (byId.has(candidate.id)) throw new Error(`La candidata UUID ${candidate.id} está repetida.`)
    if (bySourceKey.has(candidate.sourceKey)) {
      throw new Error(`La candidata source_key ${candidate.sourceKey} está repetida.`)
    }
    byId.set(candidate.id, candidate)
    bySourceKey.set(candidate.sourceKey, candidate)
    versions.add(candidate.datasetVersion)
  }
  if (versions.size !== 1) {
    throw new Error('Se necesita exactamente una versión completa de candidatas para abrir el borrador.')
  }
  return { byId, bySourceKey, datasetVersion: [...versions][0] }
}

function canonicalTerritoryIndexes(territories: readonly EditorTerritory[]) {
  const byId = new Map<string, EditorTerritory>()
  const byNumber = new Map<string, EditorTerritory>()
  for (const territory of territories) {
    const number = normalizeNumber(territory.number)
    if (!territory.id || !number) throw new Error('Hay un territorio canónico sin UUID o número.')
    if (byId.has(territory.id)) throw new Error(`El UUID territorial ${territory.id} está repetido.`)
    if (byNumber.has(number)) {
      throw new Error(`El número territorial ${territory.number} está repetido; no se puede migrar.`)
    }
    byId.set(territory.id, territory)
    byNumber.set(number, territory)
  }
  return { byId, byNumber }
}

function parseLegacyTerritories(value: unknown) {
  const byLegacyId = new Map<string, LegacyTerritory>()
  for (const raw of array(value, 'territorios')) {
    const row = record(raw, 'Hay un territorio legado inválido.')
    const legacy: LegacyTerritory = {
      id: text(row.id, 'territorios.id'),
      numero: text(String(row.numero ?? ''), 'territorios.numero'),
      sector: typeof row.sector === 'string' ? row.sector : null,
      color: typeof row.color === 'string' ? row.color : null,
      letras: row.letras === 'proximidad' ? 'proximidad' : 'orden',
    }
    if (byLegacyId.has(legacy.id)) throw new Error(`El territorio legado ${legacy.id} está repetido.`)
    byLegacyId.set(legacy.id, legacy)
  }
  return byLegacyId
}

function labelForIndex(index: number) {
  const alphabet = 'abcdefghijklmnopqrstuvwxyz'
  return index < alphabet.length
    ? alphabet[index]
    : alphabet[Math.floor(index / alphabet.length) - 1] + alphabet[index % alphabet.length]
}

function labelAssignedBlocks(blocks: Record<string, EditorBlock>, modes: Map<string, LegacyTerritory>) {
  const byTerritory = new Map<string, EditorBlock[]>()
  for (const block of Object.values(blocks)) {
    if (!block.territoryId) continue
    const current = byTerritory.get(block.territoryId) ?? []
    current.push(block)
    byTerritory.set(block.territoryId, current)
  }
  for (const [territoryId, ownBlocks] of byTerritory) {
    const mode = modes.get(territoryId)?.letras ?? 'orden'
    ownBlocks.sort((first, second) => {
      const [firstLat, firstLng] = polygonCenter(first.geometry)
      const [secondLat, secondLng] = polygonCenter(second.geometry)
      const proximity = secondLat - firstLat || firstLng - secondLng
      if (mode === 'proximidad') return proximity || first.id.localeCompare(second.id)
      return (first.order ?? -1) - (second.order ?? -1) || proximity || first.id.localeCompare(second.id)
    })
    ownBlocks.forEach((block, index) => { block.label = labelForIndex(index) })
  }
}

function decodeV2(
  raw: Record<string, unknown>,
  canonicalTerritories: readonly EditorTerritory[],
  candidates: readonly EditorCandidate[],
): DecodedEditorDraft {
  const { byId: territoryById } = canonicalTerritoryIndexes(canonicalTerritories)
  const { byId: candidateById, datasetVersion } = candidateIndexes(candidates)
  if (text(raw.dataset_version, 'dataset_version') !== datasetVersion) {
    throw new Error('El borrador pertenece a otra versión de la base de manzanas.')
  }
  const documentValue = record(raw.document, 'El documento v2 del borrador es inválido.')
  const territoryRows = record(documentValue.territories, 'Los territorios del borrador v2 son inválidos.')
  const blockRows = record(documentValue.blocks, 'Las manzanas del borrador v2 son inválidas.')
  const territories: EditorTerritory[] = []
  for (const [id, rawTerritory] of Object.entries(territoryRows)) {
    const territory = record(rawTerritory, `El territorio ${id} del borrador es inválido.`)
    const canonical = territoryById.get(id)
    if (!canonical) throw new Error(`El territorio UUID ${id} del borrador ya no existe.`)
    const decodedTerritory: EditorTerritory = {
      ...canonical,
      number: text(territory.number, `territories.${id}.number`),
    }
    if (typeof territory.sector === 'string') decodedTerritory.sector = territory.sector
    if (typeof territory.color === 'string') decodedTerritory.color = territory.color
    territories.push(decodedTerritory)
  }
  const blocks: EditorBlock[] = []
  for (const [id, rawBlock] of Object.entries(blockRows)) {
    const block = record(rawBlock, `La manzana ${id} del borrador es inválida.`)
    const geometry = record(block.geometry, `La geometría de ${id} es inválida.`) as EditorPolygon
    polygonRingLatLng(geometry)
    const territoryId = block.territoryId === null ? null : text(block.territoryId, `${id}.territoryId`)
    if (territoryId && !territoryById.has(territoryId)) {
      throw new Error(`La manzana ${id} apunta al territorio inexistente ${territoryId}.`)
    }
    if (block.sourceKey && candidateById.has(id) && candidateById.get(id)?.sourceKey !== block.sourceKey) {
      throw new Error(`La identidad de la candidata ${id} no coincide con su source_key.`)
    }
    blocks.push({ ...block, id, geometry, territoryId } as EditorBlock)
  }
  const document = createEditorDocument(territories, blocks)
  document.touchedTerritoryIds = uniqueStrings(documentValue.touchedTerritoryIds, 'touchedTerritoryIds')
  return {
    document,
    datasetVersion,
    discardedSourceKeys: uniqueStrings(raw.discarded_source_keys, 'discarded_source_keys'),
    reviewedBlockIds: uniqueStrings(raw.reviewed_block_ids, 'reviewed_block_ids'),
    migratedFromLegacy: false,
  }
}

export function decodeEditorDraftState(
  value: unknown,
  canonicalTerritories: readonly EditorTerritory[],
  candidates: readonly EditorCandidate[],
): DecodedEditorDraft {
  const raw = record(value, 'El borrador del editor es inválido.')
  if (raw.schema_version === 2) return decodeV2(raw, canonicalTerritories, candidates)

  const legacyTerritories = parseLegacyTerritories(raw.territorios)
  const { byNumber } = canonicalTerritoryIndexes(canonicalTerritories)
  const { datasetVersion } = candidateIndexes(candidates)
  const legacyToCanonical = new Map<string, EditorTerritory>()
  const modesByCanonicalId = new Map<string, LegacyTerritory>()
  for (const legacy of legacyTerritories.values()) {
    const canonical = byNumber.get(normalizeNumber(legacy.numero))
    if (!canonical) {
      throw new Error(`El territorio legado ${legacy.numero} no tiene equivalente UUID en la base.`)
    }
    legacyToCanonical.set(legacy.id, canonical)
    modesByCanonicalId.set(canonical.id, legacy)
  }

  const discardedSourceKeys = uniqueStrings(raw.descartadas, 'descartadas')
  const discarded = new Set(discardedSourceKeys)
  const blocksBySourceKey = new Map<string, EditorBlock>()
  for (const candidate of candidates) {
    if (discarded.has(candidate.sourceKey)) continue
    blocksBySourceKey.set(candidate.sourceKey, {
      id: candidate.id,
      sourceKey: candidate.sourceKey,
      geometry: structuredClone(candidate.geometry),
      territoryId: null,
    })
  }

  for (const rawEdit of array(raw.editadas, 'editadas')) {
    const edit = record(rawEdit, 'Hay una geometría editada inválida.')
    const sourceKey = text(edit.id, 'editadas.id')
    const geometry = record(edit.geom, `La geometría editada ${sourceKey} es inválida.`) as EditorPolygon
    polygonRingLatLng(geometry)
    const current = blocksBySourceKey.get(sourceKey)
    blocksBySourceKey.set(sourceKey, {
      id: current?.id ?? `legacy:${sourceKey}`,
      sourceKey,
      geometry,
      territoryId: current?.territoryId ?? null,
      edited: true,
    })
  }

  for (const rawAssignment of array(raw.asignacion, 'asignacion')) {
    if (!Array.isArray(rawAssignment) || rawAssignment.length < 2) {
      throw new Error('Hay una asignación legada inválida.')
    }
    const sourceKey = text(rawAssignment[0], 'asignacion.source_key')
    const legacyTerritoryId = text(rawAssignment[1], 'asignacion.territorio')
    const block = blocksBySourceKey.get(sourceKey)
    if (!block) throw new Error(`La manzana legada ${sourceKey} no existe en la fuente activa.`)
    const territory = legacyToCanonical.get(legacyTerritoryId)
    if (!territory) {
      throw new Error(`La asignación de ${sourceKey} apunta al territorio legado inexistente ${legacyTerritoryId}.`)
    }
    const order = rawAssignment[2] == null ? null : Number(rawAssignment[2])
    if (order !== null && !Number.isFinite(order)) throw new Error(`El orden de ${sourceKey} es inválido.`)
    block.territoryId = territory.id
    block.order = order
  }

  for (const rawSides of array(raw.caras, 'caras')) {
    if (!Array.isArray(rawSides) || rawSides.length < 3) throw new Error('Hay caras legadas inválidas.')
    const sourceKey = text(rawSides[0], 'caras.source_key')
    const block = blocksBySourceKey.get(sourceKey)
    if (!block) throw new Error(`Las caras apuntan a la manzana inexistente ${sourceKey}.`)
    if (!Array.isArray(rawSides[1])) throw new Error(`Las caras de ${sourceKey} no son una lista.`)
    const vertexCount = Number(rawSides[2])
    if (!Number.isInteger(vertexCount) || vertexCount < 3) {
      throw new Error(`La cantidad de vértices de ${sourceKey} es inválida.`)
    }
    block.manualSideGroups = rawSides[1] as number[][]
    block.manualVertexCount = vertexCount
  }

  const blocks = Object.fromEntries([...blocksBySourceKey.values()].map((block) => [block.id, block]))
  labelAssignedBlocks(blocks, modesByCanonicalId)
  const document = createEditorDocument(
    canonicalTerritories.map((canonical) => {
      const legacy = modesByCanonicalId.get(canonical.id)
      if (!legacy) return canonical
      const migrated = { ...canonical }
      if (legacy.sector != null) migrated.sector = legacy.sector
      if (legacy.color != null) migrated.color = legacy.color
      return migrated
    }),
    Object.values(blocks),
  )
  document.touchedTerritoryIds = uniqueStrings(raw.tocados, 'tocados').map((legacyId) => {
    const canonical = legacyToCanonical.get(legacyId)
    if (!canonical) throw new Error(`El territorio tocado legado ${legacyId} ya no existe.`)
    return canonical.id
  })

  const reviewedBlockIds = uniqueStrings(raw.revisadas, 'revisadas').map((sourceKey) => {
    const block = blocksBySourceKey.get(sourceKey)
    if (!block) throw new Error(`La manzana revisada ${sourceKey} ya no existe.`)
    return block.id
  })
  return {
    document,
    datasetVersion,
    discardedSourceKeys,
    reviewedBlockIds,
    migratedFromLegacy: true,
  }
}

export function encodeEditorDraftState(decoded: DecodedEditorDraft): EditorDraftStateV2 {
  return {
    schema_version: 2,
    dataset_version: decoded.datasetVersion,
    document: structuredClone(decoded.document),
    discarded_source_keys: [...new Set(decoded.discardedSourceKeys)],
    reviewed_block_ids: [...new Set(decoded.reviewedBlockIds)],
  }
}
