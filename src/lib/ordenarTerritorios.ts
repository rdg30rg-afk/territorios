/**
 * ORDEN DE LOS TERRITORIOS
 *
 * La base los devuelve por `created_at` y nadie los busca por fecha de
 * creación: la lista del mapa y el selector de cobertura mostraban
 * "66, 37, 58, 2, 3, 27, 54, 50, 49…". Para encontrar el 34 había que
 * recorrer los 70 en un orden que no significa nada.
 *
 * Los nombres son casi siempre un número, pero no siempre: hay territorios
 * de prueba con un UUID por nombre, y podría haber un "12 bis". Por eso el
 * número manda cuando existe y el texto desempata; lo que no empieza con un
 * número va al final, junto y en orden alfabético, en vez de mezclarse entre
 * el 9 y el 10.
 */
export function compararTerritorios(
  primero: { name: string },
  segundo: { name: string },
): number {
  const a = numeroInicial(primero.name)
  const b = numeroInicial(segundo.name)

  if (a === null && b === null) return primero.name.localeCompare(segundo.name, 'es')
  if (a === null) return 1
  if (b === null) return -1
  if (a !== b) return a - b

  // Mismo número: "12" antes que "12 bis".
  return primero.name.localeCompare(segundo.name, 'es', { numeric: true })
}

export function ordenarTerritorios<T extends { name: string }>(territorios: readonly T[]): T[] {
  return [...territorios].sort(compararTerritorios)
}

function numeroInicial(nombre: string): number | null {
  const encontrado = /^\s*(\d+)/.exec(nombre)
  if (!encontrado) return null
  const valor = Number(encontrado[1])
  return Number.isFinite(valor) ? valor : null
}
