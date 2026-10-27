import type { GeoJSONSource, Map as MapaMapLibre } from 'maplibre-gl'

/**
 * La lógica del selector de punto de encuentro que no depende de React.
 *
 * Vive afuera del componente por una razón práctica: así se puede probar sin
 * navegador, con un mapa de mentira que anota lo que le piden.
 *
 * Lo que arregla (verificado leyendo el código, ver
 * docs/ANALISIS-MAPAS-2026-10-27.md, riesgo 5):
 *
 *  - El marcador y el territorio salían si `map.isStyleLoaded()` daba falso, y
 *    nada los repetía cuando el estilo terminaba de cargar. Peor: esa función
 *    no sirve de guarda, porque vuelve a dar falso cada vez que una fuente se
 *    está actualizando (una fuente GeoJSON recién agregada, por ejemplo). Acá
 *    se espera la señal del estilo (`style.load`, `load` o `styledata`) y
 *    después se dibuja de manera idempotente.
 *  - El marcador es un elemento HTML que no depende del estilo, así que se
 *    dibuja siempre, apenas llega la posición.
 */

export type Coordenadas = [number, number]

export type MapaDelSelector = Pick<
  MapaMapLibre,
  | 'getSource'
  | 'getLayer'
  | 'addSource'
  | 'addLayer'
  | 'removeLayer'
  | 'removeSource'
  | 'easeTo'
  | 'fitBounds'
>

/** Lo único que se le pide al marcador: moverse y sacarse. */
export type MarcadorDelSelector = {
  setLngLat(posicion: Coordenadas): unknown
  remove(): unknown
}

export const ID_FUENTE_TERRITORIO = 'selected-territory'
const CAPA_RELLENO = `${ID_FUENTE_TERRITORIO}-fill`
const CAPA_LINEA = `${ID_FUENTE_TERRITORIO}-line`

export const ZOOM_AL_ELEGIR = 13
export const OPCIONES_ENCUADRE = { padding: 34, duration: 700, maxZoom: 15 } as const

export function limitesDelPoligono(
  coordenadas: number[][][],
): [[number, number], [number, number]] | null {
  const anillo = coordenadas[0] ?? []
  if (anillo.length === 0) {
    return null
  }

  let minLng = Number.POSITIVE_INFINITY
  let minLat = Number.POSITIVE_INFINITY
  let maxLng = Number.NEGATIVE_INFINITY
  let maxLat = Number.NEGATIVE_INFINITY

  anillo.forEach(([lng, lat]) => {
    minLng = Math.min(minLng, lng)
    minLat = Math.min(minLat, lat)
    maxLng = Math.max(maxLng, lng)
    maxLat = Math.max(maxLat, lat)
  })

  return [[minLng, minLat], [maxLng, maxLat]]
}

/**
 * Compara por valor. `SalidasPage` arma el arreglo de coordenadas de la vista
 * previa en cada render, y con la comparación por referencia el mapa volvía a
 * volar al mismo punto cada vez.
 */
export function mismaPosicion(a: Coordenadas | null, b: Coordenadas | null) {
  if (a === b) return true
  if (!a || !b) return false
  return a[0] === b[0] && a[1] === b[1]
}

type EstadoDelClic = {
  soloLectura: boolean
  alElegir?: (coordenadas: Coordenadas) => void
}

/**
 * El manejador del clic lee el estado en el momento del clic, no el del
 * momento en que se creó el mapa. Así `onPick` puede cambiar en cada render
 * (en `SalidasPage` es una función en línea) sin tener que rearmar el mapa.
 */
export function crearAlHacerClic(estado: () => EstadoDelClic) {
  return (evento: { lngLat: { lng: number; lat: number } }) => {
    const { soloLectura, alElegir } = estado()
    if (soloLectura || !alElegir) return
    alElegir([evento.lngLat.lng, evento.lngLat.lat])
  }
}

export function crearSincronizadorDelSelector({
  mapa,
  crearMarcador,
}: {
  mapa: MapaDelSelector
  crearMarcador: (posicion: Coordenadas) => MarcadorDelSelector
}) {
  let marcador: MarcadorDelSelector | null = null
  let posicion: Coordenadas | null = null
  let geometria: GeoJSON.Polygon | null = null
  // Qué geometría tiene la fuente del mapa ahora mismo, para no repetir
  // `setData` (y el trabajo del worker) cuando el estilo emite eventos.
  let geometriaDibujada: GeoJSON.Polygon | null = null
  let estiloListo = false
  let destruido = false

  function quitarTerritorio() {
    if (mapa.getLayer(CAPA_RELLENO)) mapa.removeLayer(CAPA_RELLENO)
    if (mapa.getLayer(CAPA_LINEA)) mapa.removeLayer(CAPA_LINEA)
    if (mapa.getSource(ID_FUENTE_TERRITORIO)) mapa.removeSource(ID_FUENTE_TERRITORIO)
  }

  // Idempotente: se puede llamar en cada evento del estilo. Mira lo que hay en
  // el mapa y no lo que recuerda, así que también repone el territorio si el
  // estilo se recargó y se llevó la fuente.
  function dibujarTerritorio() {
    if (destruido || !estiloListo) return

    if (!geometria) {
      quitarTerritorio()
      geometriaDibujada = null
      return
    }

    const figura: GeoJSON.Feature<GeoJSON.Polygon> = {
      type: 'Feature',
      properties: {},
      geometry: geometria,
    }
    const fuente = mapa.getSource(ID_FUENTE_TERRITORIO) as GeoJSONSource | undefined

    if (!fuente) {
      mapa.addSource(ID_FUENTE_TERRITORIO, { type: 'geojson', data: figura })
    } else if (geometriaDibujada !== geometria) {
      fuente.setData(figura)
    }

    if (!mapa.getLayer(CAPA_RELLENO)) {
      mapa.addLayer({
        id: CAPA_RELLENO,
        type: 'fill',
        source: ID_FUENTE_TERRITORIO,
        paint: { 'fill-color': '#16a34a', 'fill-opacity': 0.14 },
      })
    }
    if (!mapa.getLayer(CAPA_LINEA)) {
      mapa.addLayer({
        id: CAPA_LINEA,
        type: 'line',
        source: ID_FUENTE_TERRITORIO,
        paint: { 'line-color': '#15803d', 'line-width': 3 },
      })
    }

    geometriaDibujada = geometria
  }

  // Sin punto elegido, el mapa se acomoda al territorio. Con punto, manda el
  // punto. El encuadre es de la cámara, no del estilo: no hay que esperarlo.
  function encuadrarTerritorio() {
    if (destruido || !geometria || posicion) return
    const limites = limitesDelPoligono(geometria.coordinates)
    if (limites) mapa.fitBounds(limites, OPCIONES_ENCUADRE)
  }

  return {
    ponerPosicion(nueva: Coordenadas | null) {
      if (destruido || mismaPosicion(nueva, posicion)) return
      posicion = nueva

      if (!nueva) {
        marcador?.remove()
        marcador = null
        encuadrarTerritorio()
        return
      }

      if (marcador) {
        marcador.setLngLat(nueva)
      } else {
        marcador = crearMarcador(nueva)
      }
      mapa.easeTo({ center: nueva, zoom: ZOOM_AL_ELEGIR, duration: 700 })
    },

    ponerTerritorio(nueva: GeoJSON.Polygon | null) {
      if (destruido || nueva === geometria) return
      geometria = nueva
      dibujarTerritorio()
      encuadrarTerritorio()
    },

    /** Se llama en `style.load`, `load` y `styledata`. */
    estiloCargado() {
      estiloListo = true
      dibujarTerritorio()
    },

    destruir() {
      marcador?.remove()
      marcador = null
      posicion = null
      geometria = null
      geometriaDibujada = null
      destruido = true
    },
  }
}

export type SincronizadorDelSelector = ReturnType<typeof crearSincronizadorDelSelector>
