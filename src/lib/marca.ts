// La marca de Territorios: tres manzanas llenas, las recorridas, y en la
// esquina una casa en contorno, la que falta visitar. Tinta sobre el lima de
// la app, en un cuadrado recto y plano: un color y un pictograma, como las
// marcas de las apps de JW, pero con símbolo y color propios. Nada de sus
// letras, su torre ni sus azules.
//
// Todo sale de acá: el componente de la app, public/favicon.svg y los PNG de
// la PWA (scripts/generar-iconos.mjs). Para cambiar el color o el dibujo,
// cambiarlo acá y volver a correr el script.

export const MARCA_FONDO = '#cbea5b'
export const MARCA_TINTA = '#1d201c'

type Punto = [number, number]

/**
 * El borde de afuera de la casa, sobre una retícula de 64 × 64. Ocupa el lugar
 * de la manzana de arriba a la derecha; el contorno crece hacia adentro.
 */
const CASA: Punto[] = [
  [34, 21.8],
  [42.5, 13.8],
  [51, 21.8],
  [51, 30],
  [34, 30],
]

/** Las tres manzanas recorridas. */
const MANZANAS: Punto[] = [
  [13, 13],
  [13, 34],
  [34, 34],
]
const LADO_MANZANA = 17

/**
 * Corre cada lado del polígono `d` unidades hacia afuera (o hacia adentro, con
 * `d` negativo) y une los lados con esquinas en punta.
 */
export function desplazarPoligono(puntos: Punto[], d: number): Punto[] {
  const n = puntos.length
  const area = puntos.reduce((s, [x, y], i) => {
    const [x2, y2] = puntos[(i + 1) % n]
    return s + (x * y2 - x2 * y)
  }, 0)
  const sentido = area > 0 ? 1 : -1
  const rectas = puntos.map(([x, y], i) => {
    const [x2, y2] = puntos[(i + 1) % n]
    const largo = Math.hypot(x2 - x, y2 - y)
    const nx = (sentido * (y2 - y)) / largo
    const ny = (sentido * -(x2 - x)) / largo
    return { x: x + nx * d, y: y + ny * d, dx: x2 - x, dy: y2 - y }
  })
  return rectas.map((r, i) => {
    const a = rectas[(i - 1 + n) % n]
    // Corte de la recta anterior con esta.
    const det = a.dx * r.dy - a.dy * r.dx
    const t = ((r.x - a.x) * r.dy - (r.y - a.y) * r.dx) / det
    return [redondear(a.x + a.dx * t), redondear(a.y + a.dy * t)]
  })
}

const redondear = (v: number) => Math.round(v * 100) / 100

export type FormaDeLaMarca =
  | { tipo: 'poligono'; puntos: Punto[]; color: string }
  | { tipo: 'cuadrado'; x: number; y: number; lado: number; color: string }

/**
 * La marca como formas llenas, en orden de pintado: las manzanas, la casa
 * tinta y su interior lima. El contorno no es un borde de SVG porque no todos
 * los programas lo dibujan igual (ImageMagick no lo dibujaba). `trazo` es el
 * grosor del contorno: a 16 px necesita más para no perderse.
 */
export function formasDeLaMarca({ trazo = 3.2 } = {}): FormaDeLaMarca[] {
  return [
    ...MANZANAS.map(([x, y]) => ({ tipo: 'cuadrado' as const, x, y, lado: LADO_MANZANA, color: MARCA_TINTA })),
    { tipo: 'poligono', puntos: CASA, color: MARCA_TINTA },
    { tipo: 'poligono', puntos: desplazarPoligono(CASA, -trazo), color: MARCA_FONDO },
  ]
}

export const puntosSvg = (puntos: Punto[]) => puntos.map(([x, y]) => `${x},${y}`).join(' ')

/**
 * El símbolo como SVG suelto. `escala` achica el dibujo hacia el centro: el
 * ícono "maskable" de Android lo necesita dentro del círculo seguro.
 */
export function simboloSvg({ trazo = 3.2, escala = 1 } = {}): string {
  const formas = formasDeLaMarca({ trazo })
    .map((f) =>
      f.tipo === 'poligono'
        ? `<polygon points="${puntosSvg(f.puntos)}" fill="${f.color}"/>`
        : `<rect x="${f.x}" y="${f.y}" width="${f.lado}" height="${f.lado}" fill="${f.color}"/>`,
    )
    .join('')
  const grupo = escala === 1 ? formas : `<g transform="translate(32 32) scale(${escala}) translate(-32 -32)">${formas}</g>`
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><rect width="64" height="64" fill="${MARCA_FONDO}"/>${grupo}</svg>\n`
}
