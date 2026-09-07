/**
 * Cómo se busca un punto de encuentro en el programa.
 *
 * En el Excel se escribe 61,1 y aparece la esquina. El decimal no es otro
 * territorio: es desde dónde se sale. Esta lib normaliza lo que se teclea
 * y filtra la lista sin inventar puntos.
 */

export type PuntoEncuentro = {
  id: string
  nombre: string
  barrio: string | null
  lat: number | null
  lng: number | null
  maps_url: string | null
  territory_id: string | null
  activo: boolean
  codigo?: string | null
  orden?: number | null
  tipo?: 'territorial' | 'especial' | null
}

const SIN_TILDES: Record<string, string> = {
  á: 'a',
  é: 'e',
  í: 'i',
  ó: 'o',
  ú: 'u',
  ü: 'u',
  ñ: 'n',
}

export function normalizarCodigo(valor: string | number | null | undefined): string {
  if (valor == null) return ''
  return String(valor)
    .trim()
    .replace(/(\d)\s+(\d)/g, '$1.$2')
    .replace(/,/g, '.')
    .replace(/\s+/g, '')
}

export function sinTildes(valor: string): string {
  return valor
    .toLowerCase()
    .replace(/[áéíóúüñ]/g, (letra) => SIN_TILDES[letra] ?? letra)
}

export function territorioDelCodigo(codigo: string): string | null {
  const limpio = normalizarCodigo(codigo)
  const entero = limpio.match(/^(\d+)/)
  return entero ? entero[1] : null
}

export function esCodigoExacto(consulta: string): boolean {
  const limpio = normalizarCodigo(consulta)
  if (!limpio) return false
  return /^\d+\.\d+$/i.test(limpio) || /^[a-z]{2,}$/i.test(limpio)
}

export function textoPunto(punto: Pick<PuntoEncuentro, 'codigo' | 'nombre' | 'barrio'>): string {
  const codigo = (punto.codigo ?? '').trim()
  const nombre = (punto.nombre ?? '').trim()
  if (codigo && nombre) return `${codigo} · ${nombre}`
  return nombre || codigo || 'Punto sin nombre'
}

export function buscarPuntos(
  puntos: PuntoEncuentro[],
  consulta: string,
): PuntoEncuentro[] {
  const activos = puntos.filter((punto) => punto.activo)
  const crudo = consulta.trim()
  if (!crudo) return activos

  const codigo = normalizarCodigo(crudo)
  const texto = sinTildes(crudo)

  const exactos = activos.filter(
    (punto) => normalizarCodigo(punto.codigo) === codigo && codigo !== '',
  )
  if (exactos.length === 1 && esCodigoExacto(crudo)) {
    return exactos
  }

  return activos.filter((punto) => {
    const puntoCodigo = normalizarCodigo(punto.codigo)
    if (puntoCodigo === codigo) return true
    if (/^\d+$/.test(codigo)) {
      return territorioDelCodigo(puntoCodigo) === codigo
    }
    const haystack = sinTildes(
      [punto.nombre, punto.barrio, punto.codigo].filter(Boolean).join(' '),
    )
    return haystack.includes(texto)
  })
}
