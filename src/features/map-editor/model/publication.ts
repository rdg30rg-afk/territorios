import {
  polygonAreaSquareMeters,
  polygonCenter,
  sidesForBlock,
} from '../geometry/blockGeometry.ts'
import type { EditorBlock, EditorDocument, EditorPolygon } from './types.ts'

export type PublishableSide = {
  orden: number
  geom: { type: 'LineString'; coordinates: Array<[number, number]> }
  largo_m: number
  rumbo_grados: number
  medio_lat: number
  medio_lng: number
}

export type PublishableBlock = {
  label: string
  orden: number
  lat: number
  lng: number
  geom: EditorPolygon
  area_m2: number
  lados: PublishableSide[]
}

export type PublicationSnapshot = {
  territoryId: string
  name: string
  blocks: PublishableBlock[]
}

export type TerritoryRevision = {
  nombre: string
  version: number
}

export type TerritoryRevisionV2 = {
  territory_id: string
  version: number
}

export type AtomicPublicationItem = {
  nombre: string
  version_esperada: number
  manzanas: PublishableBlock[]
}

export type AtomicPublicationItemV2 = {
  territory_id: string
  version_esperada: number
  manzanas: PublishableBlock[]
}

function compareBlocks(first: EditorBlock, second: EditorBlock) {
  const orderDifference = (first.order ?? Number.MAX_SAFE_INTEGER) -
    (second.order ?? Number.MAX_SAFE_INTEGER)
  if (orderDifference !== 0) return orderDifference
  const labelDifference = (first.label ?? '').localeCompare(second.label ?? '', 'es', {
    numeric: true,
    sensitivity: 'base',
  })
  return labelDifference || first.id.localeCompare(second.id)
}

export function prepareTerritoryBlocks(document: EditorDocument, territoryId: string) {
  if (!document.territories[territoryId]) {
    throw new Error(`No existe el territorio ${territoryId}.`)
  }

  return Object.values(document.blocks)
    .filter((block) => block.territoryId === territoryId)
    .sort(compareBlocks)
    .map((block, order): PublishableBlock => {
      const label = block.label?.trim()
      if (!label) throw new Error(`La manzana ${block.id} no tiene letra.`)
      const [lat, lng] = polygonCenter(block.geometry)
      return {
        label,
        orden: order,
        lat,
        lng,
        geom: structuredClone(block.geometry),
        area_m2: polygonAreaSquareMeters(block.geometry),
        lados: sidesForBlock(block).map((side, sideOrder) => ({
          orden: sideOrder,
          geom: {
            type: 'LineString',
            coordinates: side.points.map(([sideLat, sideLng]) => [sideLng, sideLat]),
          },
          largo_m: side.lengthMeters,
          rumbo_grados: side.bearingDegrees,
          medio_lat: Number(side.midpoint[0].toFixed(6)),
          medio_lng: Number(side.midpoint[1].toFixed(6)),
        })),
      }
    })
}

export function createPublicationSnapshot(document: EditorDocument, activeTerritoryId: string) {
  if (!document.territories[activeTerritoryId]) {
    throw new Error('Elegí un territorio válido antes de publicar.')
  }

  const territoryIds = [
    activeTerritoryId,
    ...document.touchedTerritoryIds.filter((id) => id !== activeTerritoryId),
  ]
  return [...new Set(territoryIds)]
    .filter((id) => Boolean(document.territories[id]))
    .map((territoryId): PublicationSnapshot => ({
      territoryId,
      name: String(document.territories[territoryId].number),
      blocks: prepareTerritoryBlocks(document, territoryId),
    }))
}

export function buildAtomicPublication(
  snapshots: readonly PublicationSnapshot[],
  revisions: readonly TerritoryRevision[],
): AtomicPublicationItem[] {
  const versionByName = new Map<string, number>()
  for (const revision of revisions) {
    if (!Number.isInteger(revision.version)) continue
    versionByName.set(revision.nombre.trim().toLocaleLowerCase('es'), revision.version)
  }

  return snapshots.map((snapshot) => {
    const version = versionByName.get(snapshot.name.trim().toLocaleLowerCase('es'))
    if (version === undefined) {
      throw new Error(`No se pudo verificar la versión del territorio ${snapshot.name}.`)
    }
    return {
      nombre: snapshot.name,
      version_esperada: version,
      manzanas: structuredClone(snapshot.blocks),
    }
  })
}

export function buildAtomicPublicationV2(
  snapshots: readonly PublicationSnapshot[],
  revisions: readonly TerritoryRevisionV2[],
): AtomicPublicationItemV2[] {
  const versionById = new Map<string, number>()
  for (const revision of revisions) {
    if (!revision.territory_id || !Number.isSafeInteger(revision.version) || revision.version < 0) {
      continue
    }
    if (versionById.has(revision.territory_id)) {
      throw new Error(`La revisión del territorio UUID ${revision.territory_id} está repetida.`)
    }
    versionById.set(revision.territory_id, revision.version)
  }

  return snapshots.map((snapshot) => {
    const version = versionById.get(snapshot.territoryId)
    if (version === undefined) {
      throw new Error(`No se pudo verificar la versión del territorio UUID ${snapshot.territoryId}.`)
    }
    return {
      territory_id: snapshot.territoryId,
      version_esperada: version,
      manzanas: structuredClone(snapshot.blocks),
    }
  })
}

export function publicationStillMatches(
  document: EditorDocument,
  snapshot: PublicationSnapshot,
) {
  const territory = document.territories[snapshot.territoryId]
  if (!territory || String(territory.number) !== snapshot.name) return false
  return JSON.stringify(prepareTerritoryBlocks(document, snapshot.territoryId)) ===
    JSON.stringify(snapshot.blocks)
}
