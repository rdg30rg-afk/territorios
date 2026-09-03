/**
 * LO QUE EL EXCEL DEJO EN "OBSERVACIONES"
 *
 * El aplicador del historico (scripts/aplicar-historico-staging.py) guarda
 * en salidas.notes un JSON con la procedencia de cada fila:
 *
 *   {"conductor_alias":"Hugo Quiroga","priorizar":"Manzanas D,E,F",
 *    "narrativa":{"L:PREDICADO:":"..."},"estado_fuente":false,
 *    "estado_resolucion":"sin_confirmar"}
 *
 * Son las 1.790 salidas, el 100% de las que hay, todas con origen 'excel'.
 *
 * Eso caia tal cual dentro del cuadro "Observaciones" del formulario, que
 * es texto libre que una persona lee y edita. Dos problemas, y el segundo
 * es el grave:
 *
 * 1. Nadie tiene por que leer un JSON.
 * 2. El formulario lo cargaba en el cuadro y despues escribia de vuelta lo
 *    que hubiera quedado ahi. Tocar esa caja y guardar borraba la
 *    procedencia de esa salida -- de que conductor venia, que habia que
 *    priorizar, que decia la casilla del Excel-- sin manera de recuperarla.
 *
 * Mientras esos campos no tengan columnas propias, la interfaz los muestra
 * como frases y no deja editarlos: no puede ofrecer como texto libre un
 * dato que no es suyo.
 */
export type NotasImportadas = {
  conductorSegunElExcel: string | null
  priorizar: string | null
  narrativa: string[]
  laCasillaDecia: boolean | null
  resolucion: string | null
  crudo: string
}

export function leerNotasImportadas(notes: string | null): NotasImportadas | null {
  if (!notes) return null

  const texto = notes.trim()
  if (!texto.startsWith('{')) return null

  let dato: Record<string, unknown>
  try {
    dato = JSON.parse(texto) as Record<string, unknown>
  } catch {
    // Texto que empieza con llave pero no es JSON: lo escribio una persona.
    return null
  }

  // Se exige al menos una clave del aplicador. Si alguien escribio un JSON
  // a mano en las observaciones, es suyo y se deja como texto.
  const propias = ['conductor_alias', 'priorizar', 'narrativa', 'estado_fuente', 'estado_resolucion']
  if (!propias.some((clave) => clave in dato)) return null

  const comoTexto = (valor: unknown) => {
    const s = typeof valor === 'string' ? valor.trim() : ''
    // El Excel usa "-" para "nada". Repetirlo en pantalla no informa.
    return s && s !== '-' ? s : null
  }

  const narrativa = dato.narrativa
  const lineas: string[] = []
  if (narrativa && typeof narrativa === 'object') {
    for (const [etiqueta, valor] of Object.entries(narrativa as Record<string, unknown>)) {
      const v = comoTexto(valor)
      if (v) lineas.push(`${etiqueta.replace(/[:.]+$/, '')}: ${v}`)
    }
  }

  return {
    conductorSegunElExcel: comoTexto(dato.conductor_alias),
    priorizar: comoTexto(dato.priorizar),
    narrativa: lineas,
    laCasillaDecia: typeof dato.estado_fuente === 'boolean' ? dato.estado_fuente : null,
    resolucion: comoTexto(dato.estado_resolucion),
    crudo: texto,
  }
}
