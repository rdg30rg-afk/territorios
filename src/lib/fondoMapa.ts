/**
 * De donde salen las calles que se ven abajo de los territorios.
 *
 * Las teselas de openstreetmap.org son gratuitas porque estan donadas, y su
 * politica corta a quien pide muchas seguidas. El editor muestra los sesenta y
 * pico de territorios a la vez y llega a ese limite sin esfuerzo: cuando pasa,
 * el fondo queda gris y parece que se rompio el editor. Con clave de MapTiler
 * el fondo no corta, y ademas viene en doble resolucion.
 *
 * Sin clave se vuelve a OpenStreetMap. Un fondo que a veces corta sigue siendo
 * mejor que un mapa sin calles: quien dibuja manzanas necesita ver la ciudad.
 *
 * El estilo elegido es el mas apagado que hay. Encima van los poligonos de los
 * territorios, cada uno de un color fuerte; un fondo con avenidas naranjas y
 * carteles de comercios pelea con ellos y no se entiende ninguno de los dos.
 */

const clave = import.meta.env.VITE_MAPTILER_KEY as string | undefined

// Leaflet reemplaza {r} por "@2x" en pantallas retina, y sirve esa imagen del
// doble de tamano en el mismo espacio. Es lo que hace que se lean los nombres
// de calle en la pantalla del telefono.
export const FONDO_MAPA = clave
  ? {
      url: `https://api.maptiler.com/maps/dataviz-light/256/{z}/{x}/{y}{r}.png?key=${clave}`,
      // Nombrar a quien hace el mapa es condicion de uso, tanto de MapTiler
      // como de OpenStreetMap, que es de donde sale el dato.
      credito:
        '<a href="https://www.maptiler.com/copyright/">MapTiler</a> · <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
      // Ya viene gris: apagarlo de nuevo lo dejaria ilegible.
      filtro: '',
    }
  : {
      url: 'https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png',
      credito: '<a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
      // El raster de OSM es muy cargado y compite con las manzanas.
      filtro: 'saturate(.55) brightness(1.06) contrast(.95)',
    }

export const HAY_CLAVE_DE_MAPAS = Boolean(clave)

/** Teselas para MapLibre, que no entiende {s} ni {r} de Leaflet. */
export function teselasMapLibre() {
  return clave
    ? {
        url: `https://api.maptiler.com/maps/dataviz-light/256/{z}/{x}/{y}.png?key=${clave}`,
        credito:
          '&copy; <a href="https://www.maptiler.com/copyright/">MapTiler</a> · <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
      }
    : {
        url: 'https://tile.openstreetmap.org/{z}/{x}/{y}.png',
        credito:
          '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
      }
}

const OSM = {
  url: 'https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png',
  credito: '<a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
  filtro: 'saturate(.55) brightness(1.06) contrast(.95)',
}

/**
 * Pone el fondo y lo cambia solo si se cae.
 *
 * La cuota de MapTiler se puede agotar a mitad de mes sin que nadie se entere:
 * el servidor devuelve una imagen que dice "Invalid key" y el editor queda con
 * los territorios flotando en gris. Antes que eso, OpenStreetMap, que a veces
 * corta pero vuelve.
 *
 * Recibe L en vez de importarlo porque el editor usa el Leaflet global de
 * unpkg. Dos instancias distintas de la misma libreria no se hablan.
 */
export function ponerFondo(L: typeof import('leaflet'), mapa: L.Map) {
  const capa = L.tileLayer(FONDO_MAPA.url, {
    maxZoom: 19,
    attribution: FONDO_MAPA.credito,
  }).addTo(mapa)
  const contenedor = capa.getContainer()
  if (contenedor) contenedor.style.filter = FONDO_MAPA.filtro

  if (!clave) return capa

  // Una tesela suelta falla por cualquier cosa. Varias seguidas es la cuota.
  let fallas = 0
  capa.on('tileerror', () => {
    fallas += 1
    if (fallas < 6) return
    capa.off('tileerror')
    capa.setUrl(OSM.url)
    const c = capa.getContainer()
    if (c) c.style.filter = OSM.filtro
    mapa.attributionControl.removeAttribution(FONDO_MAPA.credito)
    mapa.attributionControl.addAttribution(OSM.credito)
    console.warn('El fondo de MapTiler no responde. Se vuelve a OpenStreetMap.')
  })
  return capa
}
