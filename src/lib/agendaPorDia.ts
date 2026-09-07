// La agenda se lee hacia adelante. La consulta trae las 300 mas recientes
// ordenadas de nueva a vieja, y asi la pantalla abria en la salida mas
// lejana en el futuro y bajaba hacia el pasado: para saber que hay manana
// habia que buscar en el medio de la lista. Aca se parte en dos -lo que
// viene y lo que paso- y cada mitad se ordena como se lee.

export type SalidaConFecha = { scheduled_for: string }

export function claveDelDia(fecha: Date): string {
  return [
    fecha.getFullYear(),
    String(fecha.getMonth() + 1).padStart(2, '0'),
    String(fecha.getDate()).padStart(2, '0'),
  ].join('-')
}

function instante(salida: SalidaConFecha): number {
  return new Date(salida.scheduled_for).getTime()
}

/** Lo de hoy en adelante ascendente; lo anterior, descendente. Una fecha
 *  ilegible no se descarta ni se inventa: cae al final de lo anterior, que
 *  es donde se revisa lo que quedo raro. */
export function partirAgenda<T extends SalidaConFecha>(
  salidas: T[],
  ahora: Date = new Date(),
): { proximas: T[]; anteriores: T[] } {
  const inicioDeHoy = new Date(ahora.getFullYear(), ahora.getMonth(), ahora.getDate()).getTime()
  const proximas: T[] = []
  const anteriores: T[] = []
  const sinFecha: T[] = []

  for (const salida of salidas) {
    const momento = instante(salida)
    if (!Number.isFinite(momento)) sinFecha.push(salida)
    else if (momento >= inicioDeHoy) proximas.push(salida)
    else anteriores.push(salida)
  }

  proximas.sort((a, b) => instante(a) - instante(b))
  anteriores.sort((a, b) => instante(b) - instante(a))

  return { proximas, anteriores: [...anteriores, ...sinFecha] }
}

/** Agrupa una lista YA ordenada en dias consecutivos. No reordena: el orden
 *  lo decide quien llama, porque las proximas van al revés de las viejas. */
export function agruparPorDia<T extends SalidaConFecha>(
  salidas: T[],
): Array<{ clave: string; salidas: T[] }> {
  const dias: Array<{ clave: string; salidas: T[] }> = []

  for (const salida of salidas) {
    const fecha = new Date(salida.scheduled_for)
    const clave = Number.isFinite(fecha.getTime()) ? claveDelDia(fecha) : 'sin-fecha'
    const ultimo = dias[dias.length - 1]
    if (ultimo && ultimo.clave === clave) ultimo.salidas.push(salida)
    else dias.push({ clave, salidas: [salida] })
  }

  return dias
}

const nombreDelDia = new Intl.DateTimeFormat('es-AR', {
  weekday: 'long',
  day: 'numeric',
  month: 'long',
})

export function etiquetaDelDia(clave: string, ahora: Date = new Date()): string {
  if (clave === 'sin-fecha') return 'Sin fecha'

  const [anio, mes, dia] = clave.split('-').map(Number)
  const fecha = new Date(anio, mes - 1, dia)
  const largo = nombreDelDia.format(fecha)
  const conMayuscula = largo.charAt(0).toUpperCase() + largo.slice(1)

  const hoy = new Date(ahora.getFullYear(), ahora.getMonth(), ahora.getDate())
  const dias = Math.round((fecha.getTime() - hoy.getTime()) / 86400000)
  // "Hoy" y "Mañana" son las dos preguntas que trae quien abre esta
  // pantalla, y van con la fecha al lado para que nadie tenga que confiar
  // en que el reloj del telefono este bien.
  if (dias === 0) return `Hoy · ${conMayuscula}`
  if (dias === 1) return `Mañana · ${conMayuscula}`
  if (dias === -1) return `Ayer · ${conMayuscula}`
  return conMayuscula
}
