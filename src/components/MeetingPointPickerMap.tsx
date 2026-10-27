import { useEffect, useRef } from 'react'
import { teselasMapLibre } from '../lib/fondoMapa'
import {
  crearAlHacerClic,
  crearSincronizadorDelSelector,
  type Coordenadas,
  type SincronizadorDelSelector,
} from '../lib/meetingPointMapSync'
import * as maplibregl from 'maplibre-gl'

const sanJuanCenter: [number, number] = [-68.5256, -31.5375]

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
  /** Zoom con el que se abre el mapa. No se vuelve a aplicar si cambia. */
  zoom?: number
}) {
  const mapContainerRef = useRef<HTMLDivElement | null>(null)
  const sincronizadorRef = useRef<SincronizadorDelSelector | null>(null)

  // `SalidasPage` pasa `onPick` como función en línea, o sea una distinta en
  // cada render. Como dependencia del efecto que crea el mapa, lo destruía y
  // lo rearmaba a cada redibujo, y el marcador nunca llegaba a verse. En un
  // ref, el mapa se crea una sola vez y el clic lee siempre la última versión.
  const estadoDelClicRef = useRef({ soloLectura: readOnly, alElegir: onPick })
  const zoomInicialRef = useRef(zoom)
  useEffect(() => {
    estadoDelClicRef.current = { soloLectura: readOnly, alElegir: onPick }
  }, [onPick, readOnly])

  // El mapa se crea una vez por montaje. Todo lo que cambia después (punto,
  // territorio, qué hacer al tocar) llega por los efectos y refs de abajo.
  useEffect(() => {
    if (!mapContainerRef.current) {
      return
    }

    const teselas = teselasMapLibre()
    const map = new maplibregl.Map({
      container: mapContainerRef.current,
      style: {
        version: 8,
        sources: {
          fondo: {
            type: 'raster',
            tiles: [teselas.url],
            tileSize: 256,
            attribution: teselas.credito,
          },
        },
        layers: [
          {
            id: 'fondo',
            type: 'raster',
            source: 'fondo',
          },
        ],
      },
      center: sanJuanCenter,
      zoom: zoomInicialRef.current,
    })

    map.addControl(new maplibregl.NavigationControl(), 'top-right')
    map.on('click', crearAlHacerClic(() => estadoDelClicRef.current))

    const sincronizador = crearSincronizadorDelSelector({
      mapa: map,
      crearMarcador: (posicion: Coordenadas) =>
        new maplibregl.Marker({ color: '#1d4ed8' }).setLngLat(posicion).addTo(map),
    })
    sincronizadorRef.current = sincronizador

    // El estilo se carga después de crear el mapa, así que el territorio no se
    // puede dibujar todavía. Se avisa en las tres señales: cualquiera de las
    // tres alcanza, y repetirlas no cuesta nada porque dibujar es idempotente.
    const alCargarElEstilo = () => sincronizador.estiloCargado()
    map.on('style.load', alCargarElEstilo)
    map.on('load', alCargarElEstilo)
    map.on('styledata', alCargarElEstilo)
    if (map.isStyleLoaded()) alCargarElEstilo()

    // MapLibre mide su contenedor una sola vez, cuando se crea. Dentro de
    // la ventana modal el contenedor todavia no tenia tamanio, asi que caia
    // en su medida por defecto: medido en pantalla, un panel de 518x343 con
    // un lienzo de 400x300. Eso es el hueco a la derecha y las calles
    // corridas respecto del recuadro.
    //
    // Un ResizeObserver cubre los tres casos de una: la ventana que se
    // abre, la del navegador que cambia de tamanio, y el panel que se
    // reacomoda solo. Avisarle una vez al abrir arreglaria unicamente el
    // primero.
    const contenedor = mapContainerRef.current
    const observador = new ResizeObserver(() => map.resize())
    observador.observe(contenedor)

    return () => {
      observador.disconnect()
      sincronizador.destruir()
      sincronizadorRef.current = null
      map.remove()
    }
  }, [])

  // Los efectos de abajo corren después del que crea el mapa, también en el
  // primer montaje, y llevan al mapa lo que traen las props. Repetir la misma
  // posición o el mismo territorio no hace nada.
  useEffect(() => {
    sincronizadorRef.current?.ponerPosicion(markerPosition)
  }, [markerPosition])

  useEffect(() => {
    sincronizadorRef.current?.ponerTerritorio(territoryGeometry ?? null)
  }, [territoryGeometry])

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
