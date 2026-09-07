/**
 * Cómo se nombra conductor y territorio en el panel.
 *
 * Las salidas importadas del Excel casi nunca tienen driver_id ni
 * territory_id: el nombre vive en conductor_texto y el número en
 * territorio_codigo. Si solo se mira la FK, la lista dice "Sin conductor"
 * aunque el Excel traía a Ariel Riveros.
 */

export type SalidaParaEtiqueta = {
  driver_id?: string | null
  territory_id?: string | null
  conductor_texto?: string | null
  territorio_codigo?: string | null
  driverName?: string | null
  territoryName?: string | null
}

export function textoConductor(salida: SalidaParaEtiqueta): string {
  const vinculado = (salida.driverName ?? '').trim()
  if (salida.driver_id && vinculado && vinculado !== 'Sin conductor') {
    return vinculado
  }
  const texto = (salida.conductor_texto ?? '').trim()
  if (texto) return texto
  if (vinculado && vinculado !== 'Sin conductor') return vinculado
  return 'Sin conductor'
}

export function textoTerritorio(salida: SalidaParaEtiqueta): string {
  const vinculado = (salida.territoryName ?? '').trim()
  if (salida.territory_id && vinculado && vinculado !== 'Sin territorio') {
    return vinculado
  }
  const codigo = (salida.territorio_codigo ?? '').trim()
  if (codigo) {
    const entero = codigo.match(/^(\d+)/)
    return entero ? entero[1] : codigo
  }
  if (vinculado && vinculado !== 'Sin territorio') return vinculado
  return 'Sin territorio'
}

export function saleSinConductor(salida: SalidaParaEtiqueta): boolean {
  return textoConductor(salida) === 'Sin conductor'
}

export function textoPuntoSalida(entrada: {
  codigo?: string | null
  nombre?: string | null
}): string {
  const codigo = (entrada.codigo ?? '').trim()
  const nombre = (entrada.nombre ?? '').trim()
  if (codigo && nombre) return `${codigo} · ${nombre}`
  return nombre || codigo || 'Sin punto'
}

export function rotuloTerritorio(nombre: string | null | undefined): string {
  const limpio = (nombre ?? '').trim()
  if (!limpio) return 'Territorio sin nombre'
  if (/^\d+([.]\d+)?$/.test(limpio)) return `Territorio ${limpio}`
  return limpio
}
