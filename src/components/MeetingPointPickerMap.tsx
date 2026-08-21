import { useEffect, useRef } from 'react'
import * as maplibregl from 'maplibre-gl'

const sanJuanCenter: [number, number] = [-68.5256, -31.5375]
const territorySourceId = 'selected-territory'

function getBoundsFromPolygonCoordinates(
  coordinates: number[][][],
): [[number, number], [number, number]] | null {
  const ring = coordinates[0] ?? []
  if (ring.length === 0) {
    return null
  }

  let minLng = Number.POSITIVE_INFINITY
  let minLat = Number.POSITIVE_INFINITY
  let maxLng = Number.NEGATIVE_INFINITY
  let maxLat = Number.NEGATIVE_INFINITY

  ring.forEach(([lng, lat]) => {
    minLng = Math.min(minLng, lng)
    minLat = Math.min(minLat, lat)
    maxLng = Math.max(maxLng, lng)
    maxLat = Math.max(maxLat, lat)
  })

  return [[minLng, minLat], [maxLng, maxLat]]
}

export function MeetingPointPickerMap({
  markerPosition,
  onPick,
  readOnly = false,
  territoryGeometry,
  zoom = 11,
}: {
  markerPosition: [number, number] | null
  onPick?: (coords: [number, number]) => void
  readOnly?: boolean
  territoryGeometry?: GeoJSON.Polygon | null
  zoom?: number
}) {
  const mapContainerRef = useRef<HTMLDivElement | null>(null)
  const mapRef = useRef<maplibregl.Map | null>(null)
  const markerRef = useRef<maplibregl.Marker | null>(null)

  useEffect(() => {
    if (!mapContainerRef.current || mapRef.current) {
      return
    }

    const map = new maplibregl.Map({
      container: mapContainerRef.current,
      style: {
        version: 8,
        sources: {
          osm: {
            type: 'raster',
            tiles: ['https://tile.openstreetmap.org/{z}/{x}/{y}.png'],
            tileSize: 256,
            attribution:
              '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
          },
        },
        layers: [
          {
            id: 'osm',
            type: 'raster',
            source: 'osm',
          },
        ],
      },
      center: sanJuanCenter,
      zoom,
    })

    map.addControl(new maplibregl.NavigationControl(), 'top-right')

    if (!readOnly && onPick) {
      map.on('click', (event) => {
        onPick([event.lngLat.lng, event.lngLat.lat])
      })
    }

    mapRef.current = map

    return () => {
      markerRef.current?.remove()
      map.remove()
      mapRef.current = null
      markerRef.current = null
    }
  }, [onPick, readOnly, zoom])

  useEffect(() => {
    const map = mapRef.current
    if (!map?.isStyleLoaded()) {
      return
    }

    if (!markerPosition) {
      markerRef.current?.remove()
      markerRef.current = null
      return
    }

    if (!markerRef.current) {
      markerRef.current = new maplibregl.Marker({ color: '#1d4ed8' })
        .setLngLat(markerPosition)
        .addTo(map)
    } else {
      markerRef.current.setLngLat(markerPosition)
    }

    map.easeTo({
      center: markerPosition,
      zoom: 13,
      duration: 700,
    })
  }, [markerPosition])

  useEffect(() => {
    const map = mapRef.current
    if (!map?.isStyleLoaded()) {
      return
    }

    const existingSource = map.getSource(territorySourceId) as maplibregl.GeoJSONSource | undefined

    if (!territoryGeometry) {
      if (map.getLayer(`${territorySourceId}-fill`)) {
        map.removeLayer(`${territorySourceId}-fill`)
      }
      if (map.getLayer(`${territorySourceId}-line`)) {
        map.removeLayer(`${territorySourceId}-line`)
      }
      if (map.getSource(territorySourceId)) {
        map.removeSource(territorySourceId)
      }
      return
    }

    const feature: GeoJSON.Feature<GeoJSON.Polygon> = {
      type: 'Feature',
      properties: {},
      geometry: territoryGeometry,
    }

    if (existingSource) {
      existingSource.setData(feature)
    } else {
      map.addSource(territorySourceId, {
        type: 'geojson',
        data: feature,
      })

      map.addLayer({
        id: `${territorySourceId}-fill`,
        type: 'fill',
        source: territorySourceId,
        paint: {
          'fill-color': '#16a34a',
          'fill-opacity': 0.14,
        },
      })

      map.addLayer({
        id: `${territorySourceId}-line`,
        type: 'line',
        source: territorySourceId,
        paint: {
          'line-color': '#15803d',
          'line-width': 3,
        },
      })
    }

    const bounds = getBoundsFromPolygonCoordinates(territoryGeometry.coordinates)
    if (bounds && !markerPosition) {
      map.fitBounds(bounds, {
        padding: 34,
        duration: 700,
        maxZoom: 15,
      })
    }
  }, [markerPosition, territoryGeometry])

  return (
    <div
      ref={mapContainerRef}
      className="meeting-map-canvas"
      aria-label={
        readOnly ? 'Vista previa del punto de encuentro' : 'Selector de punto de encuentro'
      }
    />
  )
}
