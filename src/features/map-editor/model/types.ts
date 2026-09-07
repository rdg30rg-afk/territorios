export type LngLat = readonly [lng: number, lat: number]
export type LatLng = readonly [lat: number, lng: number]

export type EditorPolygon = {
  type: 'Polygon'
  coordinates: LngLat[][]
}

export type ManualSideGroups = number[][]

export type EditorTerritory = {
  id: string
  number: string
  sector?: string | null
  color?: string | null
}

export type EditorBlock = {
  id: string
  sourceKey?: string | null
  geometry: EditorPolygon
  territoryId: string | null
  label?: string | null
  order?: number | null
  manualSideGroups?: ManualSideGroups | null
  manualVertexCount?: number | null
  edited?: boolean
}

export type EditorDocument = {
  territories: Record<string, EditorTerritory>
  blocks: Record<string, EditorBlock>
  touchedTerritoryIds: string[]
}

export type EditorHistory = {
  present: EditorDocument
  past: EditorDocument[]
  future: EditorDocument[]
}
