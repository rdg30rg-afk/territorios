/**
 * Elegir la manzana o la cuadra que se quiso tocar (zona de toque tolerante).
 *
 * Todo se calcula en píxeles de pantalla: la tolerancia es del dedo (o del
 * mouse), no de la ciudad. Si el toque cae dentro de una manzana, es esa; si
 * cae en la calle, entre dos, gana la que tiene el borde más cerca.
 */
export type Punto = { x: number; y: number }

/** Hasta dónde llega un toque que no cayó justo encima, en píxeles. */
export const TOLERANCIA_MANZANA_PX = 26
export const TOLERANCIA_CUADRA_PX = 34

export function distanciaASegmento(p: Punto, a: Punto, b: Punto): number {
  const dx = b.x - a.x, dy = b.y - a.y
  const largo2 = dx * dx + dy * dy
  const t = largo2 === 0 ? 0 : Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / largo2))
  return Math.hypot(p.x - (a.x + t * dx), p.y - (a.y + t * dy))
}

export function distanciaALinea(p: Punto, linea: readonly Punto[]): number {
  if (linea.length === 1) return Math.hypot(p.x - linea[0].x, p.y - linea[0].y)
  let mejor = Infinity
  for (let i = 0; i < linea.length - 1; i++) mejor = Math.min(mejor, distanciaASegmento(p, linea[i], linea[i + 1]))
  return mejor
}

export function puntoEnPoligono(p: Punto, anillo: readonly Punto[]): boolean {
  let dentro = false
  for (let i = 0, j = anillo.length - 1; i < anillo.length; j = i++) {
    const a = anillo[i], b = anillo[j]
    if ((a.y > p.y) !== (b.y > p.y) && p.x < ((b.x - a.x) * (p.y - a.y)) / (b.y - a.y) + a.x) dentro = !dentro
  }
  return dentro
}

export function elegirManzana<T>(
  p: Punto,
  candidatas: ReadonlyArray<{ item: T; anillo: readonly Punto[] }>,
  tolerancia = TOLERANCIA_MANZANA_PX,
): T | null {
  let mejor: T | null = null, mejorDistancia = Infinity
  for (const c of candidatas) {
    if (c.anillo.length < 3) continue
    // Estar adentro es distancia cero; si se solapan, gana la de borde más cercano.
    const borde = distanciaALinea(p, [...c.anillo, c.anillo[0]])
    const distancia = puntoEnPoligono(p, c.anillo) ? -1 + borde / 1e6 : borde
    if (distancia < mejorDistancia) { mejorDistancia = distancia; mejor = c.item }
  }
  return mejorDistancia <= tolerancia ? mejor : null
}

export function elegirCuadra<T>(
  p: Punto,
  candidatas: ReadonlyArray<{ item: T; linea: readonly Punto[] }>,
  tolerancia = TOLERANCIA_CUADRA_PX,
): T | null {
  let mejor: T | null = null, mejorDistancia = Infinity
  for (const c of candidatas) {
    if (!c.linea.length) continue
    const distancia = distanciaALinea(p, c.linea)
    if (distancia < mejorDistancia) { mejorDistancia = distancia; mejor = c.item }
  }
  return mejorDistancia <= tolerancia ? mejor : null
}
