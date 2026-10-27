/**
 * Las teselas para armar una imagen del mapa (el plano que se exporta a JPG y
 * a PDF), no para mostrarlo en pantalla.
 *
 * El mapa en pantalla sigue la regla de `fondoMapa.ts`: con clave de MapTiler
 * usa MapTiler, y si MapTiler falla seis teselas seguidas, vuelve a
 * OpenStreetMap. La exportación pedía las teselas directo a OpenStreetMap y
 * se saltaba todo eso: con la cuota de OSM agotada el plano salía en blanco
 * aunque MapTiler anduviera, y el plano no se parecía al mapa que se veía.
 *
 * Este módulo no lee variables de entorno ni toca el DOM: recibe la clave y la
 * función que baja una imagen. `fondoMapa.ts` le pone la clave real, y los
 * tests le ponen una de mentira.
 */

export type FuenteDeTesela = 'maptiler' | 'osm'

/** El mismo umbral que usa `ponerFondo`: una tesela suelta falla por cualquier cosa, seis seguidas es la cuota. */
export const FALLAS_PARA_VOLVER_A_OSM = 6

export const CREDITO_OSM = '© OpenStreetMap contributors'
export const CREDITO_MAPTILER_Y_OSM = '© MapTiler © OpenStreetMap contributors'

export function urlTeselaMapTiler(estilo: string, clave: string, z: number, x: number, y: number) {
  return `https://api.maptiler.com/maps/${estilo}/256/${z}/${x}/${y}.png?key=${clave}`
}

export function urlTeselaOsm(z: number, x: number, y: number) {
  return `https://tile.openstreetmap.org/${z}/${x}/${y}.png`
}

export function crearCargadorDeTeselas<T>({
  clave,
  estilo,
  cargar,
  avisar,
  fallasParaVolver = FALLAS_PARA_VOLVER_A_OSM,
}: {
  /** Sin clave se usa OpenStreetMap directo. */
  clave: string | undefined
  estilo: string
  /** Baja una imagen y rechaza si no puede. */
  cargar: (url: string) => Promise<T>
  avisar?: (mensaje: string) => void
  fallasParaVolver?: number
}) {
  // Seguidas, no acumuladas: una exportación baja cientos de teselas y alguna
  // suelta puede fallar sin que sea la cuota. Un acierto empieza la cuenta de nuevo.
  let fallasSeguidas = 0
  let dejoMapTiler = false
  let usoMapTiler = false

  async function cargarTesela(
    z: number,
    x: number,
    y: number,
  ): Promise<{ imagen: T; fuente: FuenteDeTesela }> {
    if (clave && !dejoMapTiler) {
      try {
        const imagen = await cargar(urlTeselaMapTiler(estilo, clave, z, x, y))
        fallasSeguidas = 0
        usoMapTiler = true
        return { imagen, fuente: 'maptiler' }
      } catch {
        fallasSeguidas += 1
        if (fallasSeguidas >= fallasParaVolver) {
          dejoMapTiler = true
          avisar?.('El fondo de MapTiler no responde. Se vuelve a OpenStreetMap.')
        }
        // Esta tesela se pide a OpenStreetMap, para que no quede un hueco.
      }
    }

    return { imagen: await cargar(urlTeselaOsm(z, x, y)), fuente: 'osm' }
  }

  return {
    cargar: cargarTesela,
    /** Quién hizo el mapa que quedó en la imagen: nombrarlo es condición de uso. */
    credito: () => (usoMapTiler ? CREDITO_MAPTILER_Y_OSM : CREDITO_OSM),
  }
}
