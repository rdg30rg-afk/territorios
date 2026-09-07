import type { EditorBlock, EditorPolygon, LatLng, ManualSideGroups } from '../model/types.ts'

export const SIDE_ANGLE_TOLERANCE_DEGREES = 25
export const MINIMUM_SIDE_LENGTH_METERS = 12

export type BlockSide = {
  indices: number[]
  points: LatLng[]
  lengthMeters: number
  bearingDegrees: number
  midpoint: LatLng
}

function assertCoordinate(value: unknown, index: number): asserts value is [number, number] {
  if (!Array.isArray(value) || value.length < 2) {
    throw new Error(`La coordenada ${index + 1} no tiene longitud y latitud.`)
  }
  const [lng, lat] = value
  if (!Number.isFinite(lng) || !Number.isFinite(lat)) {
    throw new Error(`La coordenada ${index + 1} contiene valores no numéricos.`)
  }
  if (lng < -180 || lng > 180 || lat < -90 || lat > 90) {
    throw new Error(`La coordenada ${index + 1} está fuera del rango geográfico válido.`)
  }
}

export function polygonRingLatLng(geometry: EditorPolygon): LatLng[] {
  if (geometry?.type !== 'Polygon' || !Array.isArray(geometry.coordinates?.[0])) {
    throw new Error('La geometría debe ser un polígono GeoJSON.')
  }

  const sourceRing = geometry.coordinates[0]
  sourceRing.forEach(assertCoordinate)
  const ring = sourceRing.map(([lng, lat]) => [lat, lng] as LatLng)
  const first = ring[0]
  const last = ring.at(-1)
  const isClosed = Boolean(first && last && first[0] === last[0] && first[1] === last[1])
  const openRing = isClosed ? ring.slice(0, -1) : ring

  const distinctCoordinates = new Set(openRing.map(([lat, lng]) => `${lat}:${lng}`))
  if (openRing.length < 3 || distinctCoordinates.size < 3) {
    throw new Error('El polígono necesita al menos tres vértices distintos.')
  }
  return openRing
}

function metersBetween(a: LatLng, b: LatLng) {
  return Math.hypot(
    (b[1] - a[1]) * Math.cos((a[0] * Math.PI) / 180) * 111320,
    (b[0] - a[0]) * 110540,
  )
}

function bearingBetween(a: LatLng, b: LatLng) {
  return (
    (Math.atan2(
      b[0] - a[0],
      (b[1] - a[1]) * Math.cos((a[0] * Math.PI) / 180),
    ) * 180) /
    Math.PI
  )
}

function angleDifference(a: number, b: number) {
  return Math.abs((((a - b) + 180) % 360) - 180)
}

function groupLength(points: LatLng[], group: number[]) {
  let total = 0
  for (let index = 1; index < group.length; index += 1) {
    total += metersBetween(points[group[index - 1]], points[group[index]])
  }
  return total
}

export function automaticSideGroups(geometry: EditorPolygon): ManualSideGroups {
  const points = polygonRingLatLng(geometry)
  const count = points.length
  const bearing = (from: number, to: number) => bearingBetween(points[from], points[to])
  const groups: number[][] = [[0, 1 % count]]

  for (let index = 1; index < count; index += 1) {
    const next = (index + 1) % count
    const current = groups[groups.length - 1]
    const previousIndex = current[current.length - 2]
    const currentIndex = current[current.length - 1]
    if (
      angleDifference(bearing(index, next), bearing(previousIndex, currentIndex)) <=
      SIDE_ANGLE_TOLERANCE_DEGREES
    ) {
      current.push(next)
    } else {
      groups.push([index, next])
    }
  }

  if (groups.length > 2) {
    const first = groups[0]
    const last = groups[groups.length - 1]
    if (
      angleDifference(
        bearing(first[0], first[1]),
        bearing(last[last.length - 2], last[last.length - 1]),
      ) <= SIDE_ANGLE_TOLERANCE_DEGREES
    ) {
      groups[0] = last.concat(first.slice(1))
      groups.pop()
    }
  }

  const longEnough = groups.filter(
    (group) => groupLength(points, group) >= MINIMUM_SIDE_LENGTH_METERS,
  )
  return longEnough.length ? longEnough : [groups[0]]
}

function validManualGroups(groups: ManualSideGroups, vertexCount: number) {
  return (
    groups.length > 0 &&
    groups.every(
      (group) =>
        group.length >= 2 &&
        group.every((index) => Number.isInteger(index) && index >= 0 && index < vertexCount),
    )
  )
}

export function groupsForBlock(block: Pick<EditorBlock, 'geometry' | 'manualSideGroups' | 'manualVertexCount'>) {
  const vertexCount = polygonRingLatLng(block.geometry).length
  if (
    block.manualSideGroups &&
    block.manualVertexCount === vertexCount &&
    validManualGroups(block.manualSideGroups, vertexCount)
  ) {
    return block.manualSideGroups.map((group) => [...group])
  }
  return automaticSideGroups(block.geometry)
}

export function sideFromGroup(points: LatLng[], group: number[]): BlockSide {
  if (!validManualGroups([group], points.length)) {
    throw new Error('La cara contiene índices de vértices inválidos.')
  }
  const sidePoints = group.map((index) => points[index])
  return {
    indices: [...group],
    points: sidePoints,
    lengthMeters: Number(groupLength(points, group).toFixed(2)),
    bearingDegrees: Number(
      (((bearingBetween(sidePoints[0], sidePoints[sidePoints.length - 1]) % 180) + 180) % 180).toFixed(2),
    ),
    midpoint: sidePoints[Math.floor(sidePoints.length / 2)],
  }
}

export function sidesForBlock(block: Pick<EditorBlock, 'geometry' | 'manualSideGroups' | 'manualVertexCount'>) {
  const points = polygonRingLatLng(block.geometry)
  return groupsForBlock(block).map((group) => sideFromGroup(points, group))
}

export function polygonAreaSquareMeters(geometry: EditorPolygon) {
  const points = polygonRingLatLng(geometry)
  const referenceLatitude = points.reduce((total, point) => total + point[0], 0) / points.length
  const longitudeScale = Math.cos((referenceLatitude * Math.PI) / 180) * 111320
  let area = 0
  for (let index = 0; index < points.length; index += 1) {
    const current = points[index]
    const next = points[(index + 1) % points.length]
    area +=
      current[1] * longitudeScale * (next[0] * 110540) -
      next[1] * longitudeScale * (current[0] * 110540)
  }
  return Number(Math.abs(area / 2).toFixed(2))
}

export function polygonCenter(geometry: EditorPolygon): LatLng {
  const points = polygonRingLatLng(geometry)
  return [
    Number((points.reduce((total, point) => total + point[0], 0) / points.length).toFixed(6)),
    Number((points.reduce((total, point) => total + point[1], 0) / points.length).toFixed(6)),
  ]
}

export function offsetInside(points: LatLng[], center: LatLng, metersInside = 7): LatLng[] {
  const [centerLat, centerLng] = center
  return points.map(([lat, lng]) => {
    const latitudeDifference = centerLat - lat
    const longitudeDifferenceMeters =
      (centerLng - lng) * Math.cos((lat * Math.PI) / 180)
    const distance =
      Math.hypot(latitudeDifference * 110540, longitudeDifferenceMeters * 111320) || 1
    const factor = metersInside / distance
    return [
      lat + latitudeDifference * factor,
      lng + (centerLng - lng) * factor,
    ] as LatLng
  })
}
