import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import L from 'leaflet'
import 'leaflet-draw'
import {
  area,
  booleanIntersects,
  difference,
  featureCollection,
  intersect,
  polygon,
  union,
} from '@turf/turf'
import { useAuth } from '../context/useAuth'
import { isSupabaseConfigured, supabase } from '../lib/supabase'

L.drawLocal.draw.toolbar.buttons.polygon = 'Poligono'
L.drawLocal.draw.toolbar.buttons.rectangle = 'Rectangulo'
L.drawLocal.draw.toolbar.actions.title = 'Cancelar dibujo'
L.drawLocal.draw.toolbar.actions.text = 'Cancelar'
L.drawLocal.draw.toolbar.finish.title = 'Terminar poligono'
L.drawLocal.draw.toolbar.finish.text = 'Terminar'
L.drawLocal.draw.toolbar.undo.title = 'Quitar ultimo punto'
L.drawLocal.draw.toolbar.undo.text = 'Deshacer'
L.drawLocal.draw.handlers.polygon.tooltip.start = 'Haz clic para marcar el primer punto.'
L.drawLocal.draw.handlers.polygon.tooltip.cont = 'Sigue haciendo clic para continuar el contorno.'
L.drawLocal.draw.handlers.polygon.tooltip.end = 'Haz clic sobre el primer punto para cerrar el poligono.'
L.drawLocal.draw.handlers.rectangle.tooltip.start = 'Haz clic y arrastra para dibujar un rectangulo.'
L.drawLocal.edit.toolbar.buttons.edit = 'Editar territorio'
L.drawLocal.edit.toolbar.buttons.editDisabled = 'No hay territorios editables'
L.drawLocal.edit.toolbar.buttons.remove = 'Eliminar territorio'
L.drawLocal.edit.toolbar.buttons.removeDisabled = 'No hay territorios para eliminar'
L.drawLocal.edit.toolbar.actions.save.title = 'Guardar cambios'
L.drawLocal.edit.toolbar.actions.save.text = 'Guardar'
L.drawLocal.edit.toolbar.actions.cancel.title = 'Cancelar edicion'
L.drawLocal.edit.toolbar.actions.cancel.text = 'Cancelar'
L.drawLocal.edit.toolbar.actions.clearAll.title = 'Quitar todos los contornos'
L.drawLocal.edit.toolbar.actions.clearAll.text = 'Borrar todo'
L.drawLocal.edit.handlers.edit.tooltip.text = 'Arrastra los puntos para ajustar el territorio.'
L.drawLocal.edit.handlers.edit.tooltip.subtext = 'Pulsa guardar cuando termines.'
L.drawLocal.edit.handlers.remove.tooltip.text = 'Haz clic sobre un territorio para eliminarlo.'

const SAN_JUAN_CENTER: L.LatLngExpression = [-31.5375, -68.5364]
const DEFAULT_COMPANY_NAME = 'Territorios San Juan'
const SNAP_DISTANCE_PX = 16
const TERRITORY_COLORS = [
  '#d97706',
  '#2563eb',
  '#16a34a',
  '#dc2626',
  '#7c3aed',
  '#0891b2',
  '#ea580c',
  '#db2777',
]

type TerritoryPolygon = {
  type: 'Polygon'
  coordinates: [number, number][][]
  color?: string
}

type TerritoryRecord = {
  id: string
  name: string
  description: string | null
  polygon_geojson: TerritoryPolygon
  created_at: string
}

type TerritoryListItem = TerritoryRecord & {
  code: string
  companyName: string
  isActive: boolean
  color: string
}

type PdfPoint = {
  x: number
  y: number
}

function formatTerritoryDate(value: string) {
  return new Intl.DateTimeFormat('es-AR', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
  }).format(new Date(value))
}

function buildTerritoryCode(index: number) {
  return `TSJ-${String(index + 1).padStart(3, '0')}`
}

function getTerritoryColor(index: number, color?: string | null) {
  return color ?? TERRITORY_COLORS[index % TERRITORY_COLORS.length]
}

function geometryToLayer(
  geometry: TerritoryPolygon,
  options: L.GeoJSONOptions = {},
) {
  const feature = {
    type: 'Feature',
    properties: {},
    geometry: geometry as unknown as GeoJSON.Polygon,
  } as GeoJSON.Feature<GeoJSON.Polygon>

  return L.geoJSON(
    feature,
    options,
  )
}

function getPolygonVertexCount(geometry: TerritoryPolygon | null) {
  if (!geometry?.coordinates?.[0]?.length) {
    return 0
  }

  const ring = geometry.coordinates[0]
  const first = ring[0]
  const last = ring[ring.length - 1]

  if (
    ring.length > 1 &&
    first &&
    last &&
    first[0] === last[0] &&
    first[1] === last[1]
  ) {
    return ring.length - 1
  }

  return ring.length
}

function getGeometryBounds(geometry: TerritoryPolygon) {
  return geometryToLayer(geometry).getBounds()
}

function getPolygonVertices(geometry: TerritoryPolygon) {
  const ring = geometry.coordinates[0] ?? []

  if (
    ring.length > 1 &&
    ring[0][0] === ring[ring.length - 1][0] &&
    ring[0][1] === ring[ring.length - 1][1]
  ) {
    return ring.slice(0, -1)
  }

  return ring
}

function getAllTerritoryVertices(territories: TerritoryListItem[]) {
  return territories.flatMap((territory) =>
    getPolygonVertices(territory.polygon_geojson),
  )
}

function hexToRgb(hexColor: string) {
  const cleanColor = hexColor.replace('#', '')
  const fallback = { r: 217, g: 119, b: 6 }

  if (cleanColor.length !== 6) {
    return fallback
  }

  const parsed = Number.parseInt(cleanColor, 16)

  if (Number.isNaN(parsed)) {
    return fallback
  }

  return {
    r: (parsed >> 16) & 255,
    g: (parsed >> 8) & 255,
    b: parsed & 255,
  }
}

function getPdfTerritoryLabel(territory: TerritoryListItem) {
  return territory.name.trim() || territory.code
}

function getPdfBounds(territories: TerritoryListItem[]) {
  const vertices = getAllTerritoryVertices(territories)

  if (vertices.length === 0) {
    return null
  }

  const lngValues = vertices.map(([lng]) => lng)
  const latValues = vertices.map(([, lat]) => lat)
  const minLng = Math.min(...lngValues)
  const maxLng = Math.max(...lngValues)
  const minLat = Math.min(...latValues)
  const maxLat = Math.max(...latValues)
  const centerLat = (minLat + maxLat) / 2
  const lngScale = Math.max(0.2, Math.cos((centerLat * Math.PI) / 180))

  return {
    minX: minLng * lngScale,
    maxX: maxLng * lngScale,
    minY: minLat,
    maxY: maxLat,
    lngScale,
  }
}

function getPdfProjector(
  territories: TerritoryListItem[],
  frame: { x: number, y: number, width: number, height: number },
) {
  const bounds = getPdfBounds(territories)

  if (!bounds) {
    return null
  }

  const boundsWidth = Math.max(bounds.maxX - bounds.minX, 0.0001)
  const boundsHeight = Math.max(bounds.maxY - bounds.minY, 0.0001)
  const scale = Math.min(frame.width / boundsWidth, frame.height / boundsHeight)
  const drawingWidth = boundsWidth * scale
  const drawingHeight = boundsHeight * scale
  const offsetX = frame.x + (frame.width - drawingWidth) / 2
  const offsetY = frame.y + (frame.height - drawingHeight) / 2

  return ([lng, lat]: [number, number]): PdfPoint => ({
    x: offsetX + (lng * bounds.lngScale - bounds.minX) * scale,
    y: offsetY + (bounds.maxY - lat) * scale,
  })
}

function getPolygonCenter(points: PdfPoint[]) {
  const usablePoints =
    points.length > 1 &&
    points[0].x === points[points.length - 1].x &&
    points[0].y === points[points.length - 1].y
      ? points.slice(0, -1)
      : points

  if (usablePoints.length === 0) {
    return { x: 0, y: 0 }
  }

  return usablePoints.reduce(
    (center, point) => ({
      x: center.x + point.x / usablePoints.length,
      y: center.y + point.y / usablePoints.length,
    }),
    { x: 0, y: 0 },
  )
}

function collectSnapCandidates(
  territories: TerritoryRecord[],
  ignoredTerritoryId: string | null,
) {
  return territories.flatMap((territory) => {
    if (territory.id === ignoredTerritoryId) {
      return []
    }

    return getPolygonVertices(territory.polygon_geojson)
  })
}

function findOverlappingTerritories(
  geometry: TerritoryPolygon,
  territories: TerritoryRecord[],
  ignoredTerritoryId: string | null,
) {
  try {
    const currentPolygon = polygon(geometry.coordinates)

    return territories.filter((territory) => {
      if (territory.id === ignoredTerritoryId) {
        return false
      }

      const otherPolygon = polygon(territory.polygon_geojson.coordinates)

      if (!booleanIntersects(currentPolygon, otherPolygon)) {
        return false
      }

      return (
        intersect(featureCollection([currentPolygon, otherPolygon])) !== null
      )
    })
  } catch {
    return []
  }
}

function getOverlapPreviewGeometry(
  geometry: TerritoryPolygon,
  territories: TerritoryRecord[],
  ignoredTerritoryId: string | null,
) {
  try {
    const currentPolygon = polygon(geometry.coordinates)

    for (const territory of territories) {
      if (territory.id === ignoredTerritoryId) {
        continue
      }

      const otherPolygon = polygon(territory.polygon_geojson.coordinates)

      if (!booleanIntersects(currentPolygon, otherPolygon)) {
        continue
      }

      const overlapGeometry = intersect(featureCollection([currentPolygon, otherPolygon]))

      if (overlapGeometry) {
        return overlapGeometry as GeoJSON.Feature<GeoJSON.Polygon | GeoJSON.MultiPolygon>
      }
    }

    return null
  } catch {
    return null
  }
}

function normalizeAdjustedGeometry(
  geometry: GeoJSON.Polygon | GeoJSON.MultiPolygon,
  color: string,
): TerritoryPolygon | null {
  if (geometry.type === 'Polygon') {
    return {
      type: 'Polygon',
      coordinates: geometry.coordinates as [number, number][][],
      color,
    }
  }

  const largestPolygonCoordinates = geometry.coordinates.reduce<
    [number, number][][] | null
  >((largest, candidate) => {
    if (!largest) {
      return candidate as [number, number][][]
    }

    const largestArea = area(polygon(largest as [number, number][][]))
    const candidateArea = area(polygon(candidate as [number, number][][]))

    return candidateArea > largestArea
      ? (candidate as [number, number][][])
      : largest
  }, null)

  if (!largestPolygonCoordinates) {
    return null
  }

  return {
    type: 'Polygon',
    coordinates: largestPolygonCoordinates,
    color,
  }
}

function getAutoAdjustedGeometry(
  geometry: TerritoryPolygon,
  territories: TerritoryRecord[],
  ignoredTerritoryId: string | null,
) {
  try {
    const overlappingTerritories = findOverlappingTerritories(
      geometry,
      territories,
      ignoredTerritoryId,
    )

    if (overlappingTerritories.length === 0) {
      return {
        geometry,
        adjusted: false,
        overlappingTerritories,
      }
    }

    const overlappingFeatures = overlappingTerritories.map((territory) =>
      polygon(territory.polygon_geojson.coordinates),
    )

    const mergedOverlap =
      overlappingFeatures.length === 1
        ? overlappingFeatures[0]
        : union(featureCollection(overlappingFeatures))

    if (!mergedOverlap) {
      return {
        geometry,
        adjusted: false,
        overlappingTerritories,
      }
    }

    const adjustedFeature = difference(
      featureCollection([polygon(geometry.coordinates), mergedOverlap]),
    )

    if (!adjustedFeature) {
      return {
        geometry: null,
        adjusted: true,
        overlappingTerritories,
      }
    }

    return {
      geometry: normalizeAdjustedGeometry(
        adjustedFeature.geometry,
        geometry.color ?? '#000000',
      ),
      adjusted: true,
      overlappingTerritories,
    }
  } catch {
    return {
      geometry,
      adjusted: false,
      overlappingTerritories: [],
    }
  }
}

function buildGeometryFromVertices(
  vertices: [number, number][],
  color: string,
): TerritoryPolygon | null {
  if (vertices.length < 3) {
    return null
  }

  return {
    type: 'Polygon',
    coordinates: [[...vertices, vertices[0]]],
    color,
  }
}

function downloadBackupFile(filename: string, contents: string, mimeType: string) {
  const blob = new Blob([contents], { type: mimeType })
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = filename
  document.body.append(link)
  link.click()
  link.remove()
  window.setTimeout(() => URL.revokeObjectURL(url), 0)
}

export function SanJuanMap() {
  const { profile } = useAuth()
  const client = supabase
  const canManageTerritories = profile?.role === 'admin'

  const mapContainerRef = useRef<HTMLDivElement | null>(null)
  const mapFrameRef = useRef<HTMLDivElement | null>(null)
  const mapRef = useRef<L.Map | null>(null)
  const existingTerritoryLayerRef = useRef<L.LayerGroup | null>(null)
  const editableGroupRef = useRef<L.FeatureGroup | null>(null)
  const vertexLayerRef = useRef<L.LayerGroup | null>(null)
  const snapGuideLayerRef = useRef<L.LayerGroup | null>(null)
  const overlapLayerRef = useRef<L.LayerGroup | null>(null)
  const drawControlRef = useRef<L.Control.Draw | null>(null)
  const currentLayerRef = useRef<L.Layer | null>(null)
  const drawHandlerRef = useRef<(L.Draw.Polygon | L.Draw.Rectangle) | null>(null)
  const canManageRef = useRef(canManageTerritories)

  const [territories, setTerritories] = useState<TerritoryRecord[]>([])
  const [selectedTerritoryId, setSelectedTerritoryId] = useState<string | null>(null)
  const [editingTerritoryId, setEditingTerritoryId] = useState<string | null>(null)
  const [territoryName, setTerritoryName] = useState('')
  const [territoryDescription, setTerritoryDescription] = useState('')
  const [selectedColor, setSelectedColor] = useState(TERRITORY_COLORS[0])
  const [currentGeometry, setCurrentGeometry] = useState<TerritoryPolygon | null>(null)
  const [draftVertices, setDraftVertices] = useState<[number, number][]>([])
  const [snapPreviewPoint, setSnapPreviewPoint] = useState<[number, number] | null>(null)
  const [isExportingPdf, setIsExportingPdf] = useState(false)
  const [overlapPreviewGeometry, setOverlapPreviewGeometry] = useState<
    GeoJSON.Feature<GeoJSON.Polygon | GeoJSON.MultiPolygon> | null
  >(null)
  const [searchTerm, setSearchTerm] = useState('')
  const [isDrawing, setIsDrawing] = useState(false)
  const [isLoading, setIsLoading] = useState(true)
  const [isSaving, setIsSaving] = useState(false)
  const [message, setMessage] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  const selectedVertexCount = getPolygonVertexCount(currentGeometry)
  const territoryCount = territories.length

  const selectedTerritory = useMemo(
    () => territories.find((item) => item.id === selectedTerritoryId) ?? null,
    [selectedTerritoryId, territories],
  )

  const territoriesWithIndex = useMemo<TerritoryListItem[]>(
    () =>
      territories.map((territory, index) => ({
        ...territory,
        code: buildTerritoryCode(index),
        companyName: DEFAULT_COMPANY_NAME,
        isActive: true,
        color: getTerritoryColor(index, territory.polygon_geojson.color),
      })),
    [territories],
  )

  const filteredTerritories = useMemo(() => {
    const normalizedSearch = searchTerm.trim().toLowerCase()

    if (!normalizedSearch) {
      return territoriesWithIndex
    }

    return territoriesWithIndex.filter((territory) => {
      const haystack = [
        territory.name,
        territory.description ?? '',
        territory.code,
        territory.companyName,
      ]
        .join(' ')
        .toLowerCase()

      return haystack.includes(normalizedSearch)
    })
  }, [searchTerm, territoriesWithIndex])

  const snapCandidates = useMemo(
    () => collectSnapCandidates(territories, editingTerritoryId),
    [editingTerritoryId, territories],
  )

  const disableActiveDrawHandler = useCallback(() => {
    const handler = drawHandlerRef.current
    if (!handler) {
      return
    }

    handler.disable()
    drawHandlerRef.current = null
  }, [])

  const applyEditableLayerStyle = useCallback(
    (layer: L.Layer | null, color = selectedColor) => {
      if (!layer || !(layer instanceof L.Path)) {
        return
      }

      layer.setStyle({
        color,
        weight: 4,
        opacity: 1,
        fillColor: color,
        fillOpacity: 0.22,
      })
    },
    [selectedColor],
  )

  const syncGeometryFromEditableLayer = useCallback(
    (color = selectedColor) => {
      const editableGroup = editableGroupRef.current
      if (!editableGroup) {
        return
      }

      const layers = editableGroup.getLayers()
      if (!layers.length) {
        currentLayerRef.current = null
        setCurrentGeometry(null)
        return
      }

      const layer = layers[0] as L.Layer & {
        toGeoJSON: () => GeoJSON.Feature<GeoJSON.Polygon>
      }

      currentLayerRef.current = layer
      applyEditableLayerStyle(layer, color)

      const feature = layer.toGeoJSON()
      setCurrentGeometry({
        type: 'Polygon',
        coordinates: feature.geometry.coordinates as [number, number][][],
        color,
      })
    },
    [applyEditableLayerStyle, selectedColor],
  )

  const fitMapToBounds = useCallback(
    (bounds: L.LatLngBounds | null, maxZoom = 14) => {
      const map = mapRef.current
      if (!map || !bounds || !bounds.isValid()) {
        return
      }

      map.fitBounds(bounds, {
        padding: [28, 28],
        maxZoom,
      })
    },
    [],
  )

  const renderTerritoriesOnMap = useCallback(
    (fitMode: 'all' | 'selected' | 'editing' | 'none' = 'none') => {
      const map = mapRef.current
      const existingTerritoryLayer = existingTerritoryLayerRef.current
      const editableGroup = editableGroupRef.current

      if (!map || !existingTerritoryLayer || !editableGroup) {
        return
      }

      existingTerritoryLayer.clearLayers()
      editableGroup.clearLayers()
      currentLayerRef.current = null

      let selectedBounds: L.LatLngBounds | null = null
      let editableBounds: L.LatLngBounds | null = null

      territoriesWithIndex.forEach((territory) => {
        const isEditing = territory.id === editingTerritoryId
        const isSelected = territory.id === selectedTerritoryId
        const geometry = isEditing && currentGeometry ? currentGeometry : territory.polygon_geojson

        if (isEditing) {
          const editableLayer = geometryToLayer(geometry)

          editableLayer.eachLayer((layer) => {
            currentLayerRef.current = layer
            editableGroup.addLayer(layer)
            applyEditableLayerStyle(layer)
          })

          editableBounds = editableLayer.getBounds()
          return
        }

        const existingLayer = geometryToLayer(geometry, {
          style: {
            color: territory.color,
            weight: isSelected ? 5 : 3,
            opacity: 1,
            fillColor: territory.color,
            fillOpacity: isSelected ? 0.26 : 0.14,
            dashArray: isSelected ? undefined : '8 6',
          },
        })

        existingLayer.eachLayer((layer) => {
          layer.on('click', () => {
            setSelectedTerritoryId(territory.id)
            setEditingTerritoryId(null)
            setCurrentGeometry(null)
            setIsDrawing(false)
            disableActiveDrawHandler()
          })

          if ('bindTooltip' in layer) {
            ;(layer as L.Path).bindTooltip(territory.name, {
              sticky: true,
              className: 'territory-tooltip',
            })
          }
        })

        existingLayer.addTo(existingTerritoryLayer)

        if (isSelected) {
          selectedBounds = existingLayer.getBounds()
        }
      })

      if (!editingTerritoryId && currentGeometry) {
        const draftLayer = geometryToLayer(currentGeometry, {
          interactive: false,
          style: {
            color: currentGeometry.color ?? selectedColor,
            weight: 4,
            opacity: 1,
            fillColor: currentGeometry.color ?? selectedColor,
            fillOpacity: 0.22,
          },
        })
        draftLayer.eachLayer((layer) => {
          currentLayerRef.current = layer
          editableGroup.addLayer(layer)
          applyEditableLayerStyle(layer)
        })
        editableBounds = draftLayer.getBounds()
      }

      if (fitMode === 'selected' && selectedBounds) {
        fitMapToBounds(selectedBounds)
        return
      }

      if (fitMode === 'editing' && editableBounds) {
        fitMapToBounds(editableBounds)
        return
      }

      if (fitMode === 'all') {
        const bounds = new L.LatLngBounds([])

        existingTerritoryLayer.eachLayer((layer) => {
          if ('getBounds' in layer) {
            bounds.extend((layer as L.FeatureGroup).getBounds())
          }
        })

        editableGroup.eachLayer((layer) => {
          if ('getBounds' in layer) {
            bounds.extend((layer as L.Polygon).getBounds())
          }
        })

        if (bounds.isValid()) {
          fitMapToBounds(bounds)
        } else {
          map.setView(SAN_JUAN_CENTER, 11)
        }
      }
    },
    [
      applyEditableLayerStyle,
      currentGeometry,
      disableActiveDrawHandler,
      editingTerritoryId,
      fitMapToBounds,
      selectedColor,
      selectedTerritoryId,
      territoriesWithIndex,
    ],
  )

  const refreshMapOverlay = useCallback(() => {
    renderTerritoriesOnMap('all')
    setMessage('Mapa actualizado con los territorios visibles.')
    setError(null)
  }, [renderTerritoriesOnMap])

  const renderVertexMarkers = useCallback(
    (vertices: [number, number][]) => {
      const vertexLayer = vertexLayerRef.current
      if (!vertexLayer) {
        return
      }

      vertexLayer.clearLayers()

      vertices.forEach(([lng, lat], index) => {
        const marker = L.circleMarker([lat, lng], {
          radius: 8,
          color: '#fffaf5',
          weight: 3,
          fillColor: selectedColor,
          fillOpacity: 1,
        })

        marker.bindTooltip(String(index + 1), {
          permanent: true,
          direction: 'center',
          className: 'territory-vertex-label',
          opacity: 1,
        })

        marker.addTo(vertexLayer)
      })
    },
    [selectedColor],
  )

  const renderSnapGuide = useCallback(
    (point: [number, number] | null) => {
      const snapGuideLayer = snapGuideLayerRef.current
      if (!snapGuideLayer) {
        return
      }

      snapGuideLayer.clearLayers()

      if (!point) {
        return
      }

      const [lng, lat] = point

      L.circleMarker([lat, lng], {
        radius: 18,
        color: selectedColor,
        weight: 2,
        opacity: 0.55,
        fillColor: selectedColor,
        fillOpacity: 0.08,
      }).addTo(snapGuideLayer)

      L.circleMarker([lat, lng], {
        radius: 8,
        color: '#fffaf5',
        weight: 3,
        fillColor: selectedColor,
        fillOpacity: 1,
      })
        .bindTooltip('Encastre', {
          permanent: true,
          direction: 'top',
          offset: [0, -10],
          className: 'territory-snap-guide-label',
          opacity: 1,
        })
        .addTo(snapGuideLayer)
    },
    [selectedColor],
  )

  const renderOverlapPreview = useCallback(
    (
      overlapGeometry: GeoJSON.Feature<GeoJSON.Polygon | GeoJSON.MultiPolygon> | null,
    ) => {
      const overlapLayer = overlapLayerRef.current
      if (!overlapLayer) {
        return
      }

      overlapLayer.clearLayers()

      if (!overlapGeometry) {
        return
      }

      L.geoJSON(overlapGeometry, {
        style: {
          color: '#dc2626',
          weight: 3,
          fillColor: '#ef4444',
          fillOpacity: 0.3,
          dashArray: '6 4',
        },
      }).addTo(overlapLayer)
    },
    [],
  )

  const snapLngLat = useCallback(
    (latLng: L.LatLng) => {
      const map = mapRef.current
      if (!map || snapCandidates.length === 0) {
        return { latLng, snapped: false }
      }

      const targetPoint = map.latLngToContainerPoint(latLng)
      let closestCandidate: [number, number] | null = null
      let closestDistance = Number.POSITIVE_INFINITY

      snapCandidates.forEach(([lng, lat]) => {
        const candidatePoint = map.latLngToContainerPoint([lat, lng])
        const distance = targetPoint.distanceTo(candidatePoint)

        if (distance < closestDistance) {
          closestDistance = distance
          closestCandidate = [lng, lat]
        }
      })

      if (!closestCandidate || closestDistance > SNAP_DISTANCE_PX) {
        return { latLng, snapped: false }
      }

      return {
        latLng: L.latLng(closestCandidate[1], closestCandidate[0]),
        snapped: true,
      }
    },
    [snapCandidates],
  )

  const snapPolygonLayerVertices = useCallback(
    (layer: L.Layer) => {
      if (!(layer instanceof L.Polygon)) {
        return false
      }

      const rawLatLngs = layer.getLatLngs()
      const ring = (Array.isArray(rawLatLngs[0])
        ? rawLatLngs[0]
        : rawLatLngs) as L.LatLng[]

      let didSnap = false
      const snappedRing = ring.map((vertex) => {
        const result = snapLngLat(vertex)
        if (result.snapped) {
          didSnap = true
        }
        return result.latLng
      })

      layer.setLatLngs([snappedRing])
      return didSnap
    },
    [snapLngLat],
  )

  const focusGeometry = useCallback(
    (geometry: TerritoryPolygon | null) => {
      if (!geometry) {
        return
      }

      fitMapToBounds(getGeometryBounds(geometry))
    },
    [fitMapToBounds],
  )

  useEffect(() => {
    canManageRef.current = canManageTerritories
  }, [canManageTerritories])

  const ensureDrawControl = useCallback(() => {
    const map = mapRef.current
    const editableGroup = editableGroupRef.current

    if (!map || !editableGroup || drawControlRef.current || !canManageRef.current) {
      return
    }

    const drawControl = new L.Control.Draw({
      draw: {
        polygon: false,
        rectangle: false,
        polyline: false,
        marker: false,
        circle: false,
        circlemarker: false,
      },
      edit: {
        featureGroup: editableGroup,
        remove: true,
      },
    })

    drawControlRef.current = drawControl
    map.addControl(drawControl)

    map.on(L.Draw.Event.DRAWSTART, () => {
      setIsDrawing(true)
      setDraftVertices([])
      setMessage(null)
      setError(null)
    })

    map.on(L.Draw.Event.DRAWSTOP, () => {
      drawHandlerRef.current = null
      setSnapPreviewPoint(null)
      setIsDrawing(false)
    })

    map.on(L.Draw.Event.DRAWVERTEX, (event: L.LeafletEvent) => {
      const drawVertexEvent = event as L.DrawEvents.DrawVertex
      const markerLayers: L.Marker[] = []

      drawVertexEvent.layers.eachLayer((layer: L.Layer) => {
        if ('getLatLng' in layer) {
          markerLayers.push(layer as L.Marker)
        }
      })

      const latestMarker = markerLayers[markerLayers.length - 1]
      let didSnap = false

      if (latestMarker) {
        const result = snapLngLat(latestMarker.getLatLng())
        if (result.snapped) {
          latestMarker.setLatLng(result.latLng)
          didSnap = true
        }
      }

      const vertices: [number, number][] = []

      markerLayers.forEach((markerLayer) => {
        const latLng = markerLayer.getLatLng()
        vertices.push([latLng.lng, latLng.lat])
      })

      setDraftVertices(vertices)
      setOverlapPreviewGeometry(
        vertices.length >= 3
          ? getOverlapPreviewGeometry(
              {
                type: 'Polygon',
                coordinates: [[...vertices, vertices[0]]],
                color: selectedColor,
              },
              territories,
              editingTerritoryId,
            )
          : null,
      )

      if (didSnap) {
        setMessage('Vertice encastrado sobre un punto cercano de un territorio existente.')
      }
    })

    map.on(L.Draw.Event.CREATED, (event: L.LeafletEvent) => {
      const createdEvent = event as L.DrawEvents.Created
      const snappedOnCreate = snapPolygonLayerVertices(createdEvent.layer)
      editableGroup.clearLayers()
      currentLayerRef.current = createdEvent.layer
      editableGroup.addLayer(createdEvent.layer)
      applyEditableLayerStyle(createdEvent.layer)
      syncGeometryFromEditableLayer()
      setSnapPreviewPoint(null)
      setOverlapPreviewGeometry(null)
      setIsDrawing(false)
      setMessage(
        snappedOnCreate
          ? 'Poligono listo. Algunos vertices se ajustaron a limites cercanos.'
          : 'Poligono listo. Ya puedes guardarlo o editar sus vertices.',
      )
      setError(null)
    })

    map.on(L.Draw.Event.EDITED, () => {
      const currentEditableGroup = editableGroupRef.current
      let snappedOnEdit = false

      currentEditableGroup?.eachLayer((layer) => {
        if (snapPolygonLayerVertices(layer)) {
          snappedOnEdit = true
        }
      })

      syncGeometryFromEditableLayer()
      setMessage(
        snappedOnEdit
          ? 'Poligono actualizado y ajustado a vertices cercanos.'
          : 'Poligono actualizado en el mapa.',
      )
    })

    map.on(L.Draw.Event.DELETED, () => {
      currentLayerRef.current = null
      setCurrentGeometry(null)
      setDraftVertices([])
      setSnapPreviewPoint(null)
      setOverlapPreviewGeometry(null)
      setIsDrawing(false)
      setMessage('Se elimino el contorno editable actual.')
    })
  }, [
    applyEditableLayerStyle,
    editingTerritoryId,
    selectedColor,
    snapLngLat,
    snapPolygonLayerVertices,
    syncGeometryFromEditableLayer,
    territories,
  ])

  useEffect(() => {
    if (!client) {
      setIsLoading(false)
      return
    }

    let isMounted = true

    const loadTerritories = async () => {
      setIsLoading(true)
      const { data, error: loadError } = await client
        .from('territorios')
        .select('id, name, description, polygon_geojson, created_at')
        .order('created_at', { ascending: false })

      if (!isMounted) {
        return
      }

      if (loadError) {
        setError(loadError.message)
        setTerritories([])
      } else {
        setError(null)
        setTerritories((data as TerritoryRecord[]) ?? [])
      }

      setIsLoading(false)
    }

    void loadTerritories()

    return () => {
      isMounted = false
    }
  }, [client])

  useEffect(() => {
    if (!mapContainerRef.current || mapRef.current) {
      return
    }

    const map = L.map(mapContainerRef.current, {
      zoomControl: true,
    }).setView(SAN_JUAN_CENTER, 11)

    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      attribution: '&copy; OpenStreetMap contributors',
      maxZoom: 19,
    }).addTo(map)

    const existingTerritoryLayer = L.layerGroup().addTo(map)
    const editableGroup = new L.FeatureGroup().addTo(map)
    const vertexLayer = L.layerGroup().addTo(map)
    const snapGuideLayer = L.layerGroup().addTo(map)
    const overlapLayer = L.layerGroup().addTo(map)

    existingTerritoryLayerRef.current = existingTerritoryLayer
    editableGroupRef.current = editableGroup
    vertexLayerRef.current = vertexLayer
    snapGuideLayerRef.current = snapGuideLayer
    overlapLayerRef.current = overlapLayer

    ensureDrawControl()

    const resizeObserver = new ResizeObserver(() => {
      map.invalidateSize()
    })

    resizeObserver.observe(mapContainerRef.current)

    const handleFullscreenChange = () => {
      window.setTimeout(() => {
        map.invalidateSize()
      }, 180)
    }

    document.addEventListener('fullscreenchange', handleFullscreenChange)
    mapRef.current = map
    window.setTimeout(() => map.invalidateSize(), 80)

    return () => {
      resizeObserver.disconnect()
      document.removeEventListener('fullscreenchange', handleFullscreenChange)
      disableActiveDrawHandler()
      map.remove()
      mapRef.current = null
      existingTerritoryLayerRef.current = null
      editableGroupRef.current = null
      vertexLayerRef.current = null
      snapGuideLayerRef.current = null
      overlapLayerRef.current = null
      drawControlRef.current = null
      currentLayerRef.current = null
    }
  }, [disableActiveDrawHandler, ensureDrawControl])

  useEffect(() => {
    ensureDrawControl()
  }, [ensureDrawControl, canManageTerritories])

  useEffect(() => {
    renderTerritoriesOnMap('none')
  }, [renderTerritoriesOnMap])

  useEffect(() => {
    renderVertexMarkers(draftVertices)
  }, [draftVertices, renderVertexMarkers])

  useEffect(() => {
    renderSnapGuide(snapPreviewPoint)
  }, [renderSnapGuide, snapPreviewPoint])

  useEffect(() => {
    renderOverlapPreview(overlapPreviewGeometry)
  }, [overlapPreviewGeometry, renderOverlapPreview])

  useEffect(() => {
    const map = mapRef.current
    if (!map) {
      return
    }

    const handleMouseMove = (event: L.LeafletMouseEvent) => {
      if (!isDrawing) {
        setSnapPreviewPoint(null)
        return
      }

      const result = snapLngLat(event.latlng)
      setSnapPreviewPoint(
        result.snapped ? [result.latLng.lng, result.latLng.lat] : null,
      )
    }

    map.on('mousemove', handleMouseMove)

    return () => {
      map.off('mousemove', handleMouseMove)
    }
  }, [isDrawing, snapLngLat])

  useEffect(() => {
    const map = mapRef.current
    if (!map) {
      return
    }

    const handleManualPolygonClick = (event: L.LeafletMouseEvent) => {
      if (!isDrawing || drawHandlerRef.current) {
        return
      }

      const snappedResult = snapLngLat(event.latlng)
      const nextVertex: [number, number] = [
        snappedResult.latLng.lng,
        snappedResult.latLng.lat,
      ]

      setDraftVertices((current) => {
        if (current.length >= 3) {
          const firstVertex = current[0]
          const currentPoint = map.latLngToContainerPoint(
            L.latLng(nextVertex[1], nextVertex[0]),
          )
          const firstPoint = map.latLngToContainerPoint(
            L.latLng(firstVertex[1], firstVertex[0]),
          )

          if (currentPoint.distanceTo(firstPoint) <= SNAP_DISTANCE_PX) {
            const completedGeometry = buildGeometryFromVertices(current, selectedColor)
            setCurrentGeometry(completedGeometry)
            setOverlapPreviewGeometry(
              completedGeometry
                ? getOverlapPreviewGeometry(
                    completedGeometry,
                    territories,
                    editingTerritoryId,
                  )
                : null,
            )
            setIsDrawing(false)
            setSnapPreviewPoint(null)
            setMessage('Poligono listo. Ya puedes guardarlo o editar sus vertices.')
            setError(null)
            return current
          }
        }

        const updatedVertices = [...current, nextVertex]
        const geometry = buildGeometryFromVertices(updatedVertices, selectedColor)

        setCurrentGeometry(geometry)
        setOverlapPreviewGeometry(
          geometry
            ? getOverlapPreviewGeometry(geometry, territories, editingTerritoryId)
            : null,
        )

        if (snappedResult.snapped) {
          setMessage('Vertice encastrado sobre un punto cercano de un territorio existente.')
        }

        return updatedVertices
      })
    }

    map.on('click', handleManualPolygonClick)

    return () => {
      map.off('click', handleManualPolygonClick)
    }
  }, [editingTerritoryId, isDrawing, selectedColor, snapLngLat, territories])

  useEffect(() => {
    if (!currentGeometry) {
      applyEditableLayerStyle(currentLayerRef.current)
      if (draftVertices.length === 0) {
        renderVertexMarkers([])
      }
      setOverlapPreviewGeometry(null)
      return
    }

    applyEditableLayerStyle(currentLayerRef.current)
    if (currentGeometry.color !== selectedColor) {
      setCurrentGeometry({
        ...currentGeometry,
        color: selectedColor,
      })
    }

    const ring = currentGeometry.coordinates[0] ?? []
    const vertices =
      ring.length > 1 &&
      ring[0][0] === ring[ring.length - 1][0] &&
      ring[0][1] === ring[ring.length - 1][1]
        ? ring.slice(0, -1)
        : ring

    setDraftVertices(vertices)
    setOverlapPreviewGeometry(
      getOverlapPreviewGeometry(currentGeometry, territories, editingTerritoryId),
    )
  }, [
    applyEditableLayerStyle,
    currentGeometry,
    draftVertices.length,
    editingTerritoryId,
    renderVertexMarkers,
    selectedColor,
    territories,
  ])

  useEffect(() => {
    drawControlRef.current?.setDrawingOptions({
      polygon: {
        shapeOptions: {
          color: selectedColor,
          weight: 4,
          fillColor: selectedColor,
          fillOpacity: 0.22,
        },
      },
      rectangle: {
        shapeOptions: {
          color: selectedColor,
          weight: 4,
          fillColor: selectedColor,
          fillOpacity: 0.22,
        },
      },
    })
  }, [selectedColor])

  useEffect(() => {
    if (territories.length > 0 && !selectedTerritoryId && !editingTerritoryId && !currentGeometry) {
      window.setTimeout(() => renderTerritoriesOnMap('all'), 0)
    }
  }, [
    currentGeometry,
    editingTerritoryId,
    renderTerritoriesOnMap,
    selectedTerritoryId,
    territories.length,
  ])

  const resetEditor = useCallback(() => {
    disableActiveDrawHandler()
    setEditingTerritoryId(null)
    setSelectedTerritoryId(null)
    setTerritoryName('')
    setTerritoryDescription('')
    setSelectedColor(TERRITORY_COLORS[0])
    setCurrentGeometry(null)
    setDraftVertices([])
    setSnapPreviewPoint(null)
    setOverlapPreviewGeometry(null)
    setIsDrawing(false)
    setMessage(null)
    setError(null)
    window.setTimeout(() => renderTerritoriesOnMap('all'), 0)
  }, [disableActiveDrawHandler, renderTerritoriesOnMap])

  const handlePrepareNewTerritory = () => {
    resetEditor()
  }

  const handleStartDrawing = () => {
    if (!canManageTerritories) {
      setError('Solo un usuario administrador puede crear o editar territorios.')
      return
    }

    if (!territoryName.trim() && !editingTerritoryId) {
      setError('Primero define el numero del territorio y luego comienza el dibujo.')
      return
    }

    const map = mapRef.current
    if (!map) {
      return
    }

    disableActiveDrawHandler()
    setDraftVertices([])
    setCurrentGeometry(null)
    setIsDrawing(true)
    setSnapPreviewPoint(null)
    setMessage('Marca los puntos sobre el mapa para delimitar el territorio.')
    setError(null)
  }

  const handleUndoLastPoint = () => {
    const activeHandler = drawHandlerRef.current as
      | (L.Draw.Polygon & { deleteLastVertex?: () => void })
      | null

    if (activeHandler?.deleteLastVertex) {
      activeHandler.deleteLastVertex()
      return
    }

    setDraftVertices((current) => {
      const updatedVertices = current.slice(0, -1)
      const geometry = buildGeometryFromVertices(updatedVertices, selectedColor)

      setCurrentGeometry(geometry)
      setOverlapPreviewGeometry(
        geometry
          ? getOverlapPreviewGeometry(geometry, territories, editingTerritoryId)
          : null,
      )

      if (updatedVertices.length === 0) {
        setSnapPreviewPoint(null)
      }

      return updatedVertices
    })
  }

  const handleFocusTerritory = (territory: TerritoryListItem) => {
    disableActiveDrawHandler()
    setSelectedTerritoryId(territory.id)
    setEditingTerritoryId(null)
    setCurrentGeometry(null)
    setTerritoryName(territory.name)
    setTerritoryDescription(territory.description ?? '')
    setSelectedColor(territory.color)
    setIsDrawing(false)
    setMessage(null)
    setError(null)
    focusGeometry(territory.polygon_geojson)
  }

  const handleEditMetadata = (territory: TerritoryRecord) => {
    disableActiveDrawHandler()

    const color = territory.polygon_geojson.color ?? TERRITORY_COLORS[0]
    const geometry = {
      ...territory.polygon_geojson,
      color,
    }

    setEditingTerritoryId(territory.id)
    setSelectedTerritoryId(territory.id)
    setTerritoryName(territory.name)
    setTerritoryDescription(territory.description ?? '')
    setSelectedColor(color)
    setCurrentGeometry(geometry)
    setIsDrawing(false)
    setMessage('Territorio cargado en modo edicion.')
    setError(null)
    window.setTimeout(() => focusGeometry(geometry), 0)
  }

  const handleDeleteTerritory = async (territory: TerritoryRecord) => {
    if (!client) {
      setError('Conecta Supabase para poder eliminar territorios.')
      return
    }

    const confirmed = window.confirm(
      `Se eliminara el territorio "${territory.name}".`,
    )

    if (!confirmed) {
      return
    }

    const { error: deleteError } = await client
      .from('territorios')
      .delete()
      .eq('id', territory.id)

    if (deleteError) {
      setError(deleteError.message)
      return
    }

    setTerritories((current) => current.filter((item) => item.id !== territory.id))

    if (selectedTerritoryId === territory.id || editingTerritoryId === territory.id) {
      resetEditor()
    }

    setMessage('Territorio eliminado correctamente.')
  }

  const handleExportTerritoriesJson = () => {
    const payload = {
      exported_at: new Date().toISOString(),
      count: territoriesWithIndex.length,
      records: territoriesWithIndex.map((territory) => ({
        id: territory.id,
        name: territory.name,
        description: territory.description,
        color: territory.color,
        created_at: territory.created_at,
        polygon_geojson: territory.polygon_geojson,
      })),
    }

    downloadBackupFile(
      `territorios-backup-${new Date().toISOString().slice(0, 10)}.json`,
      JSON.stringify(payload, null, 2),
      'application/json;charset=utf-8',
    )
    setMessage(`Respaldo JSON descargado con ${territoriesWithIndex.length} territorios.`)
    setError(null)
  }

  const handleExportTerritoriesCsv = () => {
    const csvLines = [
      'id,name,description,color,created_at,vertex_count',
      ...territoriesWithIndex.map((territory) => {
        const esc = (value: string | null | undefined) =>
          `"${String(value ?? '').replace(/"/g, '""')}"`

        return [
          esc(territory.id),
          esc(territory.name),
          esc(territory.description),
          esc(territory.color),
          esc(territory.created_at),
          getPolygonVertexCount(territory.polygon_geojson),
        ].join(',')
      }),
    ]

    downloadBackupFile(
      `territorios-backup-${new Date().toISOString().slice(0, 10)}.csv`,
      csvLines.join('\n'),
      'text/csv;charset=utf-8',
    )
    setMessage(`Respaldo CSV descargado con ${territoriesWithIndex.length} territorios.`)
    setError(null)
  }

  const handleExportTerritoriesPdf = async () => {
    if (territoriesWithIndex.length === 0) {
      setError('No hay territorios cargados para generar el plano PDF.')
      return
    }

    setIsExportingPdf(true)
    setError(null)
    setMessage(null)

    try {
      const { default: jsPDF } = await import('jspdf')
      const doc = new jsPDF({
        orientation: 'landscape',
        unit: 'mm',
        format: 'a4',
      })

      const pageWidth = doc.internal.pageSize.getWidth()
      const pageHeight = doc.internal.pageSize.getHeight()
      const generatedAt = new Intl.DateTimeFormat('es-AR', {
        day: '2-digit',
        month: '2-digit',
        year: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
      }).format(new Date())
      const mapFrame = {
        x: 12,
        y: 28,
        width: pageWidth - 24,
        height: pageHeight - 42,
      }
      const projectPoint = getPdfProjector(territoriesWithIndex, mapFrame)

      doc.setProperties({
        title: 'Plano de territorios - San Juan',
        subject: 'Mapa general de territorios',
        creator: 'Territorios San Juan',
      })

      doc.setFillColor(255, 255, 255)
      doc.rect(0, 0, pageWidth, pageHeight, 'F')
      doc.setFont('helvetica', 'bold')
      doc.setFontSize(20)
      doc.setTextColor(17, 24, 39)
      doc.text('Plano general de territorios', 12, 14)
      doc.setFont('helvetica', 'normal')
      doc.setFontSize(9)
      doc.setTextColor(91, 73, 63)
      doc.text(
        `San Juan - ${territoriesWithIndex.length} territorios - ${generatedAt}`,
        12,
        21,
      )

      doc.setFont('helvetica', 'bold')
      doc.setFontSize(18)
      doc.text('N', pageWidth - 24, 13)
      doc.setDrawColor(17, 24, 39)
      doc.setLineWidth(0.4)
      doc.line(pageWidth - 21, 16, pageWidth - 21, 27)
      doc.line(pageWidth - 25, 21.5, pageWidth - 17, 21.5)
      doc.triangle(pageWidth - 21, 15.5, pageWidth - 23, 20, pageWidth - 19, 20, 'F')

      doc.setDrawColor(217, 119, 6)
      doc.setLineWidth(0.7)
      doc.roundedRect(mapFrame.x, mapFrame.y, mapFrame.width, mapFrame.height, 2, 2, 'S')

      if (projectPoint) {
        territoriesWithIndex.forEach((territory) => {
          const color = hexToRgb(territory.color)
          const points = getPolygonVertices(territory.polygon_geojson).map(projectPoint)

          if (points.length < 3) {
            return
          }

          const [startPoint, ...restPoints] = points
          const lineVectors = restPoints.map((point, index) => {
            const previousPoint = index === 0 ? startPoint : restPoints[index - 1]
            return [point.x - previousPoint.x, point.y - previousPoint.y]
          })

          doc.setFillColor(color.r, color.g, color.b)
          doc.setDrawColor(color.r, color.g, color.b)
          doc.setLineWidth(1)
          doc.lines(lineVectors, startPoint.x, startPoint.y, [1, 1], 'FD', true)

          doc.setDrawColor(93, 64, 55)
          doc.setLineWidth(0.16)
          points.forEach((point, index) => {
            const nextPoint = points[(index + 1) % points.length]
            doc.line(point.x, point.y, nextPoint.x, nextPoint.y)
          })

          const center = getPolygonCenter(points)
          doc.setFillColor(255, 255, 255)
          doc.setDrawColor(color.r, color.g, color.b)
          doc.setLineWidth(0.35)
          doc.circle(center.x, center.y, 3.8, 'FD')
          doc.setFont('helvetica', 'bold')
          doc.setFontSize(7)
          doc.setTextColor(2, 132, 199)
          doc.text(getPdfTerritoryLabel(territory), center.x, center.y + 0.8, {
            align: 'center',
          })
        })
      }

      doc.setFont('helvetica', 'normal')
      doc.setFontSize(7)
      doc.setTextColor(91, 73, 63)
      doc.text(
        'Plano generado desde territorios guardados. Los numeros identifican cada zona.',
        12,
        pageHeight - 7,
      )

      const legendRows = territoriesWithIndex.map((territory) => ({
        name: getPdfTerritoryLabel(territory),
        description: territory.description || 'Sin referencia',
        color: territory.color,
        vertices: getPolygonVertexCount(territory.polygon_geojson),
      }))
      const rowsPerPage = 24

      for (let pageStart = 0; pageStart < legendRows.length; pageStart += rowsPerPage) {
        doc.addPage('a4', 'portrait')
        const legendPageWidth = doc.internal.pageSize.getWidth()
        const legendPageHeight = doc.internal.pageSize.getHeight()
        const pageRows = legendRows.slice(pageStart, pageStart + rowsPerPage)
        let cursorY = 24

        doc.setFillColor(255, 255, 255)
        doc.rect(0, 0, legendPageWidth, legendPageHeight, 'F')
        doc.setFont('helvetica', 'bold')
        doc.setFontSize(17)
        doc.setTextColor(17, 24, 39)
        doc.text('Indice de territorios', 14, 14)
        doc.setFont('helvetica', 'normal')
        doc.setFontSize(9)
        doc.setTextColor(91, 73, 63)
        doc.text(
          `Registros ${pageStart + 1} a ${pageStart + pageRows.length}`,
          14,
          20,
        )

        doc.setFont('helvetica', 'bold')
        doc.setFontSize(8)
        doc.setTextColor(91, 73, 63)
        doc.text('Color', 14, cursorY)
        doc.text('Territorio', 32, cursorY)
        doc.text('Referencia', 72, cursorY)
        doc.text('Vertices', 181, cursorY, { align: 'right' })
        cursorY += 4
        doc.setDrawColor(229, 221, 213)
        doc.line(14, cursorY, legendPageWidth - 14, cursorY)
        cursorY += 7

        pageRows.forEach((row) => {
          const color = hexToRgb(row.color)
          const description = doc.splitTextToSize(row.description, 95)

          doc.setFillColor(color.r, color.g, color.b)
          doc.circle(18, cursorY - 1.7, 2.7, 'F')
          doc.setFont('helvetica', 'bold')
          doc.setFontSize(9)
          doc.setTextColor(17, 24, 39)
          doc.text(row.name, 32, cursorY)
          doc.setFont('helvetica', 'normal')
          doc.setTextColor(91, 73, 63)
          doc.text(description.slice(0, 2), 72, cursorY)
          doc.setFont('helvetica', 'bold')
          doc.text(String(row.vertices), 181, cursorY, { align: 'right' })

          cursorY += Math.max(8, description.slice(0, 2).length * 4.5)
          doc.setDrawColor(245, 239, 232)
          doc.line(14, cursorY - 3, legendPageWidth - 14, cursorY - 3)
        })
      }

      doc.save(`plano-territorios-${new Date().toISOString().slice(0, 10)}.pdf`)
      setMessage(`Plano PDF generado con ${territoriesWithIndex.length} territorios.`)
    } catch (pdfError) {
      setError(
        pdfError instanceof Error
          ? pdfError.message
          : 'No se pudo generar el plano PDF.',
      )
    } finally {
      setIsExportingPdf(false)
    }
  }

  const toggleFullscreen = async () => {
    const frame = mapFrameRef.current
    const map = mapRef.current
    if (!frame || !map) {
      return
    }

    if (!document.fullscreenEnabled) {
      setError('Tu navegador no permite pantalla completa para este mapa.')
      return
    }

    if (document.fullscreenElement === frame) {
      await document.exitFullscreen()
    } else {
      await frame.requestFullscreen()
    }

    window.setTimeout(() => {
      map.invalidateSize()
    }, 200)
  }

  const handleSaveTerritory = async () => {
    if (!client) {
      setError('Conecta Supabase para guardar territorios.')
      return
    }

    if (!canManageTerritories) {
      setError('Solo un usuario administrador puede guardar territorios.')
      return
    }

    if (!currentGeometry) {
      setError('Debes dibujar un poligono antes de guardar el territorio.')
      return
    }

    if (selectedVertexCount < 3) {
      setError('Debes marcar al menos 3 puntos para formar un territorio.')
      return
    }

    if (!territoryName.trim()) {
      setError('Asigna el numero del territorio antes de guardarlo.')
      return
    }

    const payloadBaseGeometry = {
      ...currentGeometry,
      color: selectedColor,
    } as TerritoryPolygon

    const adjustedResult = getAutoAdjustedGeometry(
      payloadBaseGeometry,
      territories,
      editingTerritoryId,
    )

    if (!adjustedResult.geometry) {
      const overlappingNames = adjustedResult.overlappingTerritories
        .map((territory) => territory.name)
        .join(', ')

      setError(
        `El territorio se superpone por completo con: ${overlappingNames}. Mueve el poligono para dejar area disponible.`,
      )
      return
    }

    setIsSaving(true)
    setError(null)
    setMessage(null)

    const payloadGeometry = adjustedResult.geometry

    if (adjustedResult.adjusted) {
      setCurrentGeometry(payloadGeometry)
      setDraftVertices(getPolygonVertices(payloadGeometry))
      setOverlapPreviewGeometry(null)
    }

    const { data, error: saveError } = editingTerritoryId
      ? await client
          .from('territorios')
          .update({
            name: territoryName.trim(),
            description: territoryDescription.trim() || null,
            polygon_geojson: payloadGeometry,
          })
          .eq('id', editingTerritoryId)
          .select('id, name, description, polygon_geojson, created_at')
          .single()
      : await client
          .from('territorios')
          .insert({
            name: territoryName.trim(),
            description: territoryDescription.trim() || null,
            polygon_geojson: payloadGeometry,
          })
          .select('id, name, description, polygon_geojson, created_at')
          .single()

    if (saveError) {
      setError(saveError.message)
      setIsSaving(false)
      return
    }

    const savedRecord = data as TerritoryRecord

    setTerritories((current) => [
      savedRecord,
      ...current.filter((item) => item.id !== savedRecord.id),
    ])
    setSelectedTerritoryId(savedRecord.id)
    setEditingTerritoryId(null)
    setCurrentGeometry(null)
    setTerritoryName(savedRecord.name)
    setTerritoryDescription(savedRecord.description ?? '')
    setSelectedColor(savedRecord.polygon_geojson.color ?? TERRITORY_COLORS[0])
    setIsDrawing(false)
    setMessage(
      adjustedResult.adjusted
        ? 'Territorio ajustado automaticamente y guardado correctamente.'
        : editingTerritoryId
          ? 'Territorio actualizado correctamente.'
          : 'Territorio guardado correctamente.',
    )
    setIsSaving(false)

    window.setTimeout(() => {
      renderTerritoriesOnMap('selected')
    }, 0)
  }

  return (
    <div className="territory-console">
      <section className="territory-hero">
        <div className="territory-hero-copy">
          <p className="eyebrow">Estudio territorial</p>
          <h3>Gestiona zonas de San Juan con una edicion tipo Odoo</h3>
          <p className="toolbar-copy">
            {canManageTerritories
              ? 'Crea el numero del territorio, usa la barra lateral de dibujo y deja visibles los territorios guardados para evitar superposiciones.'
              : 'Puedes consultar territorios existentes. La creacion y edicion quedan reservadas para administradores.'}
          </p>
        </div>

        <div className="territory-hero-metrics">
          <article className="territory-metric-card">
            <span>Total guardados</span>
            <strong>{territoryCount}</strong>
            <small>Biblioteca actual</small>
          </article>
          <article className="territory-metric-card">
            <span>Vertices</span>
            <strong>{selectedVertexCount}</strong>
            <small>{currentGeometry ? 'Contorno activo' : 'Sin borrador'}</small>
          </article>
          <article className="territory-metric-card">
            <span>Modo</span>
            <strong>
              {editingTerritoryId
                ? 'Edicion'
                : isDrawing
                  ? 'Dibujo'
                  : selectedTerritory
                    ? 'Revision'
                    : 'Espera'}
            </strong>
            <small>{canManageTerritories ? 'Con control total' : 'Solo lectura'}</small>
          </article>
        </div>
      </section>

      <section className="panel territory-registry-panel">
        <div className="territory-registry-toolbar">
          <div>
            <p className="eyebrow">Territorios</p>
            <h3>Biblioteca operativa</h3>
          </div>

          <div className="territory-registry-actions">
            <label className="territory-search-field">
              <span className="sr-only">Buscar territorios</span>
              <input
                type="search"
                value={searchTerm}
                onChange={(event) => setSearchTerm(event.target.value)}
                placeholder="Buscar por nombre, codigo o compania"
              />
            </label>

            <button
              type="button"
              className="primary-button"
              onClick={handlePrepareNewTerritory}
              disabled={!canManageTerritories}
            >
              Nuevo territorio
            </button>
            <button
              type="button"
              className="secondary-button"
              onClick={() => void handleExportTerritoriesPdf()}
              disabled={territoriesWithIndex.length === 0 || isExportingPdf}
            >
              {isExportingPdf ? 'Generando PDF...' : 'Descargar plano PDF'}
            </button>
          </div>
        </div>

        {isLoading ? (
          <div className="status-card">Cargando territorios...</div>
        ) : filteredTerritories.length === 0 ? (
          <div className="status-card">
            {isSupabaseConfigured
              ? 'No se encontraron territorios con ese filtro.'
              : 'Cuando conectes Supabase, aqui aparecera el registro de territorios.'}
          </div>
        ) : (
          <div className="territory-table-shell">
            <div className="territory-table territory-table-head">
              <span>Nombre</span>
              <span>Codigo</span>
              <span>Color</span>
              <span>Compania</span>
              <span>Estado</span>
            </div>

            <div className="territory-table-body">
              {filteredTerritories.map((territory) => (
                <button
                  key={territory.id}
                  type="button"
                  className={
                    selectedTerritoryId === territory.id
                      ? 'territory-table territory-table-row active'
                      : 'territory-table territory-table-row'
                  }
                  onClick={() => handleFocusTerritory(territory)}
                >
                  <strong>{territory.name}</strong>
                  <span>{territory.code}</span>
                  <span className="territory-color-cell">
                    <span
                      className="territory-color-dot"
                      style={{ backgroundColor: territory.color }}
                      aria-hidden="true"
                    />
                    <span>{territory.color}</span>
                  </span>
                  <span>{territory.companyName}</span>
                  <span>
                    <span className="status-pill success">
                      {territory.isActive ? 'Activo' : 'Pausado'}
                    </span>
                  </span>
                </button>
              ))}
            </div>
          </div>
        )}
      </section>

      <div className="map-workspace">
        <div className="territory-studio">
          <div className="map-panel territory-map-panel">
            <div className="map-toolbar territory-toolbar">
              <div className="territory-toolbar-copy">
                <p className="eyebrow">Mapa base</p>
                <h3>San Juan sobre OpenStreetMap</h3>
                <div className="territory-phase-strip">
                  <span className={territoryName.trim() || editingTerritoryId ? 'active' : ''}>
                    1. Numero
                  </span>
                  <span className={isDrawing || currentGeometry ? 'active' : ''}>2. Poligono</span>
                  <span className={selectedTerritory ? 'active' : ''}>3. Revision</span>
                </div>
              </div>
            </div>

            <div className="territory-prep-bar">
              <label className="territory-inline-field territory-inline-field-number">
                <span>Numero del territorio</span>
                <input
                  value={territoryName}
                  onChange={(event) => setTerritoryName(event.target.value)}
                  placeholder="Ej. 25"
                  disabled={!canManageTerritories}
                />
              </label>

              <label className="territory-inline-field territory-inline-field-notes">
                <span>Referencia breve (opcional)</span>
                <input
                  value={territoryDescription}
                  onChange={(event) => setTerritoryDescription(event.target.value)}
                  placeholder="Ej. Barrio Centro o dejar vacio"
                  disabled={!canManageTerritories}
                />
              </label>

              <div className="toolbar-actions territory-toolbar-actions">
                <button
                  type="button"
                  className={isDrawing ? 'secondary-button' : 'ghost-button'}
                  onClick={handleStartDrawing}
                  disabled={!canManageTerritories}
                >
                  Comenzar dibujo
                </button>
                <button
                  type="button"
                  onClick={handleUndoLastPoint}
                  disabled={!canManageTerritories || !isDrawing}
                >
                  Deshacer punto
                </button>
                <button type="button" onClick={refreshMapOverlay}>
                  Refrescar territorios
                </button>
                <button type="button" onClick={() => void toggleFullscreen()}>
                  Pantalla completa
                </button>
                <button
                  type="button"
                  onClick={resetEditor}
                  disabled={!canManageTerritories}
                >
                  Cancelar
                </button>
              </div>
            </div>

            <div className="territory-map-stage">
              <div ref={mapFrameRef} className="territory-map-frame">
                <div className="territory-map-sidecar" aria-label="Colores de territorio">
                  {TERRITORY_COLORS.map((color) => (
                    <button
                      key={color}
                      type="button"
                      className={
                        selectedColor === color
                          ? 'territory-color-swatch active'
                          : 'territory-color-swatch'
                      }
                      style={{ backgroundColor: color }}
                      onClick={() => setSelectedColor(color)}
                      disabled={!canManageTerritories}
                      title={`Usar color ${color}`}
                    />
                  ))}
                </div>

                <div
                  ref={mapContainerRef}
                  className="map-canvas territory-leaflet-canvas"
                  aria-label="Mapa de San Juan"
                />
              </div>

              <div className="territory-map-footer">
                <div className="territory-map-help">
                  <strong>Dibuja el territorio actual y deja visibles los ya creados.</strong>
                  <span>
                    Usa `Comenzar dibujo` para cargar todos los puntos que
                    necesites y vuelve a tocar el primer punto para cerrar el
                    poligono. La barra lateral del mapa queda para editar o
                    eliminar territorios guardados.
                  </span>
                </div>
                <div className="territory-inline-status">
                  <span>Color activo</span>
                  <strong>
                    <span
                      className="territory-color-dot"
                      style={{ backgroundColor: selectedColor }}
                      aria-hidden="true"
                    />
                    {selectedColor}
                  </strong>
                </div>
              </div>
            </div>
          </div>
        </div>

        <div className="territories-sidebar territory-editor-sidebar">
          <section className="panel territory-form-panel">
            <div className="territory-panel-head">
              <div>
                <p className="eyebrow">
                  {editingTerritoryId ? 'Edicion' : 'Ficha de territorio'}
                </p>
                <h3>{editingTerritoryId ? 'Editar territorio' : 'Preparar territorio'}</h3>
              </div>
              <div className="territory-vertex-badge">
                <strong>{selectedVertexCount}</strong>
                <span>vertices</span>
              </div>
            </div>

            <div className="territory-steps-grid">
              <article
                className={
                  territoryName.trim() || editingTerritoryId
                    ? 'territory-step active'
                    : 'territory-step'
                }
              >
                <span>01</span>
                <strong>Define el numero</strong>
                <small>Con eso ya puedes comenzar a dibujar.</small>
              </article>
              <article className={currentGeometry ? 'territory-step active' : 'territory-step'}>
                <span>02</span>
                <strong>Dibuja la zona</strong>
                <small>Marca varios puntos y cierra tocando otra vez el primero.</small>
              </article>
            </div>

            <div className="territory-summary-box">
              <p className="eyebrow">Resumen</p>
              <div className="territory-summary-row">
                <span>Estado del borrador</span>
                <strong>
                  {editingTerritoryId
                    ? 'Edicion en curso'
                    : currentGeometry
                      ? 'Listo para guardar'
                      : territoryName.trim()
                        ? 'Listo para dibujar'
                        : 'Pendiente'}
                </strong>
              </div>
              <div className="territory-summary-row">
                <span>Territorio seleccionado</span>
                <strong>{selectedTerritory?.name ?? 'Ninguno'}</strong>
              </div>
              <div className="territory-summary-row">
                <span>Acceso</span>
                <strong>{canManageTerritories ? 'Administrador' : 'Solo lectura'}</strong>
              </div>
            </div>

            {error ? <div className="form-feedback error">{error}</div> : null}
            {message ? <div className="form-feedback success">{message}</div> : null}

            <div className="territory-button-stack">
              <button
                type="button"
                className="primary-button full-width"
                onClick={() => void handleSaveTerritory()}
                disabled={!canManageTerritories || isSaving || !currentGeometry}
              >
                {isSaving
                  ? 'Guardando...'
                  : editingTerritoryId
                    ? 'Actualizar territorio'
                    : 'Guardar territorio'}
              </button>
            </div>
          </section>

          <section className="panel territory-selected-panel">
            <p className="eyebrow">Territorio enfocado</p>
            <h3>
              {selectedTerritory ? selectedTerritory.name : 'Aun no seleccionaste uno'}
            </h3>

            {selectedTerritory ? (
              <>
                <p className="territory-selected-copy">
                  {selectedTerritory.description || 'Sin descripcion registrada todavia.'}
                </p>
                <div className="territory-selected-meta">
                  <div>
                    <span>Creado</span>
                    <strong>{formatTerritoryDate(selectedTerritory.created_at)}</strong>
                  </div>
                  <div>
                    <span>Formato</span>
                    <strong>Poligono GeoJSON</strong>
                  </div>
                  <div>
                    <span>Color</span>
                    <strong className="territory-selected-color">
                      <span
                        className="territory-color-dot"
                        style={{
                          backgroundColor:
                            selectedTerritory.polygon_geojson.color ?? TERRITORY_COLORS[0],
                        }}
                        aria-hidden="true"
                      />
                      {selectedTerritory.polygon_geojson.color ?? TERRITORY_COLORS[0]}
                    </strong>
                  </div>
                </div>

                {canManageTerritories ? (
                  <div className="card-actions top-gap">
                    <button
                      type="button"
                      className="secondary-button"
                      onClick={() => handleEditMetadata(selectedTerritory)}
                    >
                      Editar datos
                    </button>
                    <button
                      type="button"
                      className="danger-button"
                      onClick={() => void handleDeleteTerritory(selectedTerritory)}
                    >
                      Eliminar territorio
                    </button>
                  </div>
                ) : null}
              </>
            ) : (
              <div className="status-card">
                Haz clic sobre un territorio del listado o directamente en el mapa
                para revisar su ficha.
              </div>
            )}
          </section>

          <section className="panel territory-library-panel">
            <div className="section-heading">
              <div>
                <p className="eyebrow">Ayuda rapida</p>
                <h3>Como delimitar un territorio</h3>
              </div>
              <div className="territory-count-pill">
                <strong>{filteredTerritories.length}</strong>
                <span>visibles</span>
              </div>
            </div>

            <div className="territory-summary-box">
              <div className="territory-summary-row">
                <span>Paso 1</span>
                <strong>Escribe el numero del territorio</strong>
              </div>
              <div className="territory-summary-row">
                <span>Paso 2</span>
                <strong>Presiona "Comenzar dibujo" y marca los vertices en el mapa</strong>
              </div>
              <div className="territory-summary-row">
                <span>Paso 3</span>
                <strong>Guarda el poligono para dejarlo visible</strong>
              </div>
              <div className="territory-summary-row">
                <span>Colores</span>
                <strong>Sirven para diferenciar territorios entre si</strong>
              </div>
            </div>

            <div className="card-actions top-gap">
              <button
                type="button"
                className="secondary-button"
                onClick={handleExportTerritoriesJson}
                disabled={territoriesWithIndex.length === 0}
              >
                Exportar JSON
              </button>
              <button
                type="button"
                className="secondary-button"
                onClick={handleExportTerritoriesCsv}
                disabled={territoriesWithIndex.length === 0}
              >
                Exportar CSV
              </button>
              <button
                type="button"
                className="secondary-button"
                onClick={() => void handleExportTerritoriesPdf()}
                disabled={territoriesWithIndex.length === 0 || isExportingPdf}
              >
                {isExportingPdf ? 'Generando...' : 'Plano PDF'}
              </button>
            </div>
          </section>
        </div>
      </div>
    </div>
  )
}
