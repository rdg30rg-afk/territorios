import { area } from '@turf/area'
import { difference } from '@turf/difference'
import { feature, featureCollection } from '@turf/helpers'
import { intersect } from '@turf/intersect'
import { union } from '@turf/union'
import type { Feature, MultiPolygon, Polygon } from 'geojson'

import { polygonRingLatLng } from './blockGeometry.ts'
import type { EditorPolygon, LngLat } from '../model/types.ts'

/** Superficie mínima para considerar que una parte no está vacía. */
export const MINIMUM_OPERATION_AREA_SQUARE_METERS = 0.01

/**
 * Divide el polígono en dos partes. `first` es el lado izquierdo de la
 * dirección `start -> end` y `second` el lado derecho. Los puntos están en
 * el orden GeoJSON `[longitud, latitud]`, no en el orden de Leaflet.
 */
export type PolygonSplitResult = readonly [first: EditorPolygon, second: EditorPolygon]

type TurfPolygonFeature = Feature<Polygon>
type TurfPolygonalFeature = Feature<Polygon | MultiPolygon>

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : 'Error geométrico desconocido.'
}

function assertPosition(value: unknown, label: string): asserts value is LngLat {
  if (!Array.isArray(value) || value.length < 2) {
    throw new Error(`${label} no contiene longitud y latitud.`)
  }

  const [longitude, latitude] = value
  if (!Number.isFinite(longitude) || !Number.isFinite(latitude)) {
    throw new Error(`${label} contiene valores no numéricos.`)
  }
  if (longitude < -180 || longitude > 180 || latitude < -90 || latitude > 90) {
    throw new Error(`${label} está fuera del rango geográfico válido.`)
  }
}

function samePosition(first: LngLat, second: LngLat) {
  return first[0] === second[0] && first[1] === second[1]
}

function normalizeRing(ring: unknown, ringIndex: number): LngLat[] {
  if (!Array.isArray(ring) || ring.length < 3) {
    throw new Error(`El anillo ${ringIndex + 1} necesita al menos tres vértices.`)
  }

  const normalized = ring.map((position, positionIndex) => {
    const label = `La coordenada ${positionIndex + 1} del anillo ${ringIndex + 1}`
    assertPosition(position, label)
    return [position[0], position[1]] as LngLat
  })
  const openRing = samePosition(normalized[0], normalized.at(-1)!)
    ? normalized.slice(0, -1)
    : normalized
  const distinctCoordinates = new Set(openRing.map(([longitude, latitude]) => `${longitude}:${latitude}`))
  if (openRing.length < 3 || distinctCoordinates.size < 3) {
    throw new Error(`El anillo ${ringIndex + 1} necesita tres vértices distintos.`)
  }

  const closedRing = normalized.slice()
  if (!samePosition(closedRing[0], closedRing.at(-1)!)) {
    closedRing.push([...closedRing[0]] as LngLat)
  }
  return closedRing
}

/**
 * Valida y copia una geometría antes de entregársela a Turf. Además cierra
 * anillos abiertos, porque el editor legado aceptaba ambos formatos.
 */
function normalizePolygon(geometry: EditorPolygon, label: string): EditorPolygon {
  try {
    polygonRingLatLng(geometry)
  } catch (error) {
    throw new Error(`${label} no es válida: ${errorMessage(error)}`)
  }

  if (!Array.isArray(geometry.coordinates) || geometry.coordinates.length === 0) {
    throw new Error(`${label} no tiene anillos.`)
  }

  try {
    return {
      type: 'Polygon',
      coordinates: geometry.coordinates.map((ring, ringIndex) => normalizeRing(ring, ringIndex)),
    }
  } catch (error) {
    throw new Error(`${label} no es válida: ${errorMessage(error)}`)
  }
}

function turfPolygon(geometry: EditorPolygon): TurfPolygonFeature {
  return feature(geometry as unknown as Polygon)
}

function ensurePositiveArea(featureValue: TurfPolygonFeature, label: string) {
  if (area(featureValue) <= MINIMUM_OPERATION_AREA_SQUARE_METERS) {
    throw new Error(`${label} no tiene una superficie positiva.`)
  }
}

function areaIsConserved(expected: number, actual: number) {
  const tolerance = Math.max(MINIMUM_OPERATION_AREA_SQUARE_METERS, expected * 1e-7)
  return Math.abs(expected - actual) <= tolerance
}

function asEditorPolygon(featureValue: TurfPolygonalFeature | null, label: string): EditorPolygon {
  if (!featureValue) {
    throw new Error(`${label} no produjo una geometría; el corte no atravesó el polígono.`)
  }
  if (featureValue.geometry.type !== 'Polygon') {
    throw new Error(`${label} produjo varias partes; se necesita un único polígono.`)
  }

  const result = structuredClone(featureValue.geometry) as unknown as EditorPolygon
  if (area(featureValue) <= MINIMUM_OPERATION_AREA_SQUARE_METERS) {
    throw new Error(`${label} produjo una parte sin superficie.`)
  }
  return result
}

/**
 * Fusiona dos manzanas vecinas en un único polígono.
 *
 * Las manzanas que se superponen se rechazan: una fusión no debe ocultar un
 * problema de datos. Las que están separadas también se rechazan aunque Turf
 * pueda representarlas como MultiPolygon. Ninguna de las entradas se muta.
 */
export function mergeAdjacentPolygons(
  first: EditorPolygon,
  second: EditorPolygon,
): EditorPolygon {
  const firstPolygon = normalizePolygon(first, 'La primera geometría')
  const secondPolygon = normalizePolygon(second, 'La segunda geometría')
  const firstFeature = turfPolygon(firstPolygon)
  const secondFeature = turfPolygon(secondPolygon)
  ensurePositiveArea(firstFeature, 'La primera geometría')
  ensurePositiveArea(secondFeature, 'La segunda geometría')

  let sharedArea: TurfPolygonalFeature | null
  try {
    sharedArea = intersect(featureCollection([firstFeature, secondFeature]))
  } catch (error) {
    throw new Error(`No se pudo comprobar si las geometrías se superponen: ${errorMessage(error)}`)
  }
  if (sharedArea && area(sharedArea) > MINIMUM_OPERATION_AREA_SQUARE_METERS) {
    throw new Error('No se pueden fusionar polígonos que se superponen.')
  }

  let merged: TurfPolygonalFeature | null
  try {
    merged = union(featureCollection([firstFeature, secondFeature]))
  } catch (error) {
    throw new Error(`No se pudieron fusionar las geometrías: ${errorMessage(error)}`)
  }
  if (!merged) throw new Error('No se pudieron fusionar las geometrías: Turf no devolvió un resultado.')
  if (merged.geometry.type !== 'Polygon') {
    throw new Error('Esas dos manzanas no son vecinas: la unión queda separada.')
  }

  const expectedArea = area(firstFeature) + area(secondFeature)
  if (!areaIsConserved(expectedArea, area(merged))) {
    throw new Error('La fusión no conservó la superficie de las dos manzanas.')
  }
  return asEditorPolygon(merged, 'La fusión')
}

function assertCutPoint(value: unknown, label: string): asserts value is LngLat {
  assertPosition(value, label)
}

function buildPositiveHalfPlane(
  polygonGeometry: EditorPolygon,
  start: LngLat,
  end: LngLat,
): EditorPolygon {
  const deltaLongitude = end[0] - start[0]
  const deltaLatitude = end[1] - start[1]
  const lineLength = Math.hypot(deltaLongitude, deltaLatitude)
  if (lineLength === 0) throw new Error('La línea de corte necesita dos puntos distintos.')

  const center: LngLat = [
    (start[0] + end[0]) / 2,
    (start[1] + end[1]) / 2,
  ]
  const unitAlongLine: LngLat = [deltaLongitude / lineLength, deltaLatitude / lineLength]
  const unitNormal: LngLat = [-unitAlongLine[1], unitAlongLine[0]]
  const polygonPoints = polygonGeometry.coordinates.flat()
  const radius = Math.max(
    lineLength / 2,
    ...polygonPoints.map((point) => Math.hypot(point[0] - center[0], point[1] - center[1])),
  )
  const reach = Math.max(radius * 4, 1e-6)

  const lineStart: LngLat = [
    center[0] - unitAlongLine[0] * reach,
    center[1] - unitAlongLine[1] * reach,
  ]
  const lineEnd: LngLat = [
    center[0] + unitAlongLine[0] * reach,
    center[1] + unitAlongLine[1] * reach,
  ]
  const positiveEnd: LngLat = [
    lineEnd[0] + unitNormal[0] * reach,
    lineEnd[1] + unitNormal[1] * reach,
  ]
  const positiveStart: LngLat = [
    lineStart[0] + unitNormal[0] * reach,
    lineStart[1] + unitNormal[1] * reach,
  ]

  return {
    type: 'Polygon',
    coordinates: [[lineStart, lineEnd, positiveEnd, positiveStart, lineStart]],
  }
}

/**
 * Parte un polígono por la recta infinita que pasa por dos puntos.
 *
 * El editor legado extiende la línea dibujada para que el corte funcione aun
 * cuando los dos clics quedan dentro del mapa. Se conserva esa semántica,
 * pero la extensión se calcula según el tamaño del polígono en vez de usar
 * una constante fija en grados. Cada resultado debe ser un Polygon simple;
 * un corte que deja varias islas se rechaza para no crear una manzana ambigua.
 */
export function splitPolygonByLine(
  geometry: EditorPolygon,
  start: LngLat,
  end: LngLat,
): PolygonSplitResult {
  const polygonGeometry = normalizePolygon(geometry, 'La geometría a dividir')
  assertCutPoint(start, 'El primer punto de corte')
  assertCutPoint(end, 'El segundo punto de corte')
  if (samePosition(start, end)) throw new Error('La línea de corte necesita dos puntos distintos.')

  const source = turfPolygon(polygonGeometry)
  ensurePositiveArea(source, 'La geometría a dividir')
  const halfPlane = turfPolygon(buildPositiveHalfPlane(polygonGeometry, start, end))
  const inputs = featureCollection([source, halfPlane])

  let positive: TurfPolygonalFeature | null
  let negative: TurfPolygonalFeature | null
  try {
    positive = intersect(inputs)
    negative = difference(inputs)
  } catch (error) {
    throw new Error(`No se pudo dividir la geometría: ${errorMessage(error)}`)
  }

  const first = asEditorPolygon(positive, 'La primera parte del corte')
  const second = asEditorPolygon(negative, 'La segunda parte del corte')
  if (!areaIsConserved(area(source), area(turfPolygon(first)) + area(turfPolygon(second)))) {
    throw new Error('El corte no conservó la superficie del polígono original.')
  }
  return [first, second]
}
