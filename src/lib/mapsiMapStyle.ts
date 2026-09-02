/**
 * Recolorea un estilo de MapTiler a la paleta Mapsi, en runtime.
 *
 * Por que asi y no copiando el JSON al repo:
 *  - El estilo de MapTiler tiene 160 capas. Duplicarlo significa mantener dos
 *    copias y volver a copiarlo cada vez que se toque en el editor.
 *  - La clave de MapTiler aparece dentro del JSON (sources, glyphs y sprite).
 *    Si se versiona el archivo, la clave queda en el repositorio.
 *  - Asi el estilo original sigue siendo la fuente de verdad: se edita en
 *    MapTiler y aca solo se reemplazan los colores.
 *
 * Colores muestreados de docs/ui-madre-mapsi/assets/03-module-03.webp.
 */

export const MAPSI_MAP_COLORS = {
  tierra: '#EFF5E6',
  verde: '#CBECA3',
  agua: '#95C4FF',
  edificio: '#DCEAFD',
  edificioBorde: '#C3D9F5',
  calle: '#FFFFFF',
  calleBorde: '#DDE6F0',
  texto: '#3D3C3F',
  textoSuave: '#888A8B',
  halo: '#FFFFFF',
} as const

/**
 * Cada entrada asocia un fragmento del id de capa con su color Mapsi.
 * El orden importa: gana la primera coincidencia, asi que lo mas especifico
 * va primero (por ejemplo "outline" antes que el nombre de la via).
 */
const REGLAS: Array<{ prueba: RegExp; relleno?: string; linea?: string }> = [
  // Contornos de calle antes que las calles, si no los toma la regla general.
  { prueba: /(outline|casing)/i, linea: MAPSI_MAP_COLORS.calleBorde },

  { prueba: /(water|river|stream|dam|swimming|lake|ocean)/i, relleno: MAPSI_MAP_COLORS.agua, linea: MAPSI_MAP_COLORS.agua },
  { prueba: /(wood|forest|vegetation|farmland|grass|park|pitch|zoo|golf|cemetery)/i, relleno: MAPSI_MAP_COLORS.verde, linea: MAPSI_MAP_COLORS.verde },
  { prueba: /building/i, relleno: MAPSI_MAP_COLORS.edificio, linea: MAPSI_MAP_COLORS.edificioBorde },
  { prueba: /(highway|road|street|motorway|trunk|primary|secondary|tertiary|ramp|bridge|tunnel|pedestrian|pathway|cycleway|steps|pier|aeroway)/i, linea: MAPSI_MAP_COLORS.calle, relleno: MAPSI_MAP_COLORS.calle },
  { prueba: /(railway|aerialway)/i, linea: MAPSI_MAP_COLORS.calleBorde },
  { prueba: /(border|boundary)/i, linea: '#CECFD3' },
  // Resto de usos de suelo: un verde muy tenue, para no competir.
  { prueba: /(landuse|residential|commercial|industrial|school|hospital|military|parking|construction|quarry|sand|airport)/i, relleno: '#E4EFD6' },
]

type CapaEstilo = {
  id: string
  type: string
  paint?: Record<string, unknown>
  layout?: Record<string, unknown>
}

type EstiloMapa = {
  layers?: CapaEstilo[]
  center?: unknown
  zoom?: unknown
  bearing?: unknown
  pitch?: unknown
  [clave: string]: unknown
}

/**
 * Devuelve una copia del estilo con los colores reemplazados.
 * No muta el objeto recibido.
 */
/**
 * Etiquetas que se conservan cuando se pide un mapa tranquilo.
 * El resto son puntos de interes (comercios, arboles, semaforos, numeros de
 * puerta) que compiten con los poligonos de territorio dibujados encima.
 */
const ETIQUETAS_ESENCIALES =
  /(road labels|place labels|city labels|town labels|village labels|state labels|country labels|capital|island|lake labels|river labels|ocean labels|sea labels)/i

export type OpcionesPaleta = {
  /**
   * Quita las capas de texto e iconos no esenciales. El mapa es el lienzo
   * donde se dibujan los territorios, no un mapa de navegacion comercial.
   */
  soloEtiquetasEsenciales?: boolean
}

export function aplicarPaletaMapsi<T extends EstiloMapa>(
  estilo: T,
  opciones: OpcionesPaleta = {},
): T {
  const copia = structuredClone(estilo)

  if (opciones.soloEtiquetasEsenciales && copia.layers) {
    copia.layers = copia.layers.filter(
      (capa) => capa.type !== 'symbol' || ETIQUETAS_ESENCIALES.test(capa.id),
    )
  }

  // MapTiler guarda dentro del estilo la camara con la que quedo el editor.
  // Al pasar el estilo como objeto, MapLibre la aplica y pisa el center/zoom
  // que le pide la app, con lo cual el mapa no encuadra donde corresponde.
  // La camara la decide la app, no el estilo.
  delete copia.center
  delete copia.zoom
  delete copia.bearing
  delete copia.pitch

  for (const capa of copia.layers ?? []) {
    const paint = { ...(capa.paint ?? {}) }

    if (capa.type === 'background') {
      paint['background-color'] = MAPSI_MAP_COLORS.tierra
      capa.paint = paint
      continue
    }

    if (capa.type === 'symbol') {
      // El texto se unifica, pero se respeta el tamano y la ubicacion que ya
      // resolvio MapTiler: solo cambia el color.
      if ('text-color' in paint) paint['text-color'] = MAPSI_MAP_COLORS.texto
      if ('text-halo-color' in paint) paint['text-halo-color'] = MAPSI_MAP_COLORS.halo
      if ('icon-color' in paint) paint['icon-color'] = MAPSI_MAP_COLORS.textoSuave
      capa.paint = paint
      continue
    }

    const regla = REGLAS.find((r) => r.prueba.test(capa.id))
    if (!regla) continue

    if (capa.type === 'fill' && regla.relleno) {
      paint['fill-color'] = regla.relleno
      if ('fill-outline-color' in paint) {
        paint['fill-outline-color'] = regla.linea ?? regla.relleno
      }
    }

    if (capa.type === 'line' && regla.linea) {
      paint['line-color'] = regla.linea
    }

    if (capa.type === 'fill-extrusion' && regla.relleno) {
      paint['fill-extrusion-color'] = regla.relleno
    }

    capa.paint = paint
  }

  return copia
}

/**
 * Descarga el estilo de MapTiler y lo devuelve ya recoloreado.
 * La URL se arma con la clave de entorno, nunca escrita en el codigo.
 */
export async function cargarEstiloMapsi(
  urlEstilo: string,
  opciones: OpcionesPaleta = {},
) {
  const respuesta = await fetch(urlEstilo)

  if (!respuesta.ok) {
    throw new Error(
      `No se pudo cargar el estilo del mapa (HTTP ${respuesta.status}).`,
    )
  }

  return aplicarPaletaMapsi(await respuesta.json(), opciones)
}
