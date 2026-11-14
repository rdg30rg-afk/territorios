/**
 * Cómo está una manzana según lo informado en sus cuadras (H9).
 *
 * «No accesible» y «Para revisitar» son cuadras resueltas: alguien ya fue y
 * dejó dicho qué pasó. No cuentan como «te falta» (si no, un territorio con un
 * barrio cerrado nunca llega a «Terminaste»), pero tampoco como recorridas:
 * la manzana se pinta aparte para que se vea.
 */
export type TipoDeManzana = 'completa' | 'aparte' | 'media' | 'falta'

export type ResumenDeManzana = {
  total: number
  recorridas: number
  noAccesibles: number
  revisitar: number
  sinDato: number
  tipo: TipoDeManzana
  /** Para `aparte`: qué dejó la manzana fuera de «recorrida». «Para revisitar» gana, porque pide volver. */
  aparte: 'revisitar' | 'no_accesible' | null
}

export function resumirManzana(
  ladoIds: readonly string[],
  estados: Readonly<Record<string, string>>,
): ResumenDeManzana {
  let recorridas = 0, noAccesibles = 0, revisitar = 0
  for (const id of ladoIds) {
    const e = estados[id]
    if (e === 'recorrido') recorridas++
    else if (e === 'no_accesible') noAccesibles++
    else if (e === 'revisitar') revisitar++
  }
  const total = ladoIds.length
  const sinDato = total - recorridas - noAccesibles - revisitar
  let tipo: TipoDeManzana
  if (total > 0 && recorridas === total) tipo = 'completa'
  else if (total > 0 && sinDato === 0) tipo = 'aparte'
  else if (recorridas + noAccesibles + revisitar > 0) tipo = 'media'
  else tipo = 'falta'
  return {
    total, recorridas, noAccesibles, revisitar, sinDato, tipo,
    aparte: tipo === 'aparte' ? (revisitar > 0 ? 'revisitar' : 'no_accesible') : null,
  }
}

export function avanceDeManzanas(resumenes: readonly ResumenDeManzana[]) {
  const completas = resumenes.filter((r) => r.tipo === 'completa').length
  const aparte = resumenes.filter((r) => r.tipo === 'aparte').length
  const empezadas = resumenes.filter((r) => r.tipo === 'media').length
  // Una manzana sin cuadras cargadas sigue faltando: no es un logro.
  return { completas, aparte, empezadas, faltan: resumenes.length - completas - aparte }
}

/**
 * Las cuadras de una manzana dichas completas: «0 recorridas · 1 no accesible ·
 * 3 sin marcar». Antes decía «1 de 4 cuadras», que se leía como recorrida
 * cuando era una no accesible o para revisitar.
 */
export function textoDeCuadras(r: Pick<ResumenDeManzana, 'total' | 'recorridas' | 'noAccesibles' | 'revisitar' | 'sinDato'>): string {
  if (r.total === 0) return 'sin cuadras cargadas'
  const partes = [`${r.recorridas} ${r.recorridas === 1 ? 'recorrida' : 'recorridas'}`]
  if (r.noAccesibles > 0) partes.push(`${r.noAccesibles} no ${r.noAccesibles === 1 ? 'accesible' : 'accesibles'}`)
  if (r.revisitar > 0) partes.push(`${r.revisitar} para revisitar`)
  if (r.sinDato > 0) partes.push(`${r.sinDato} sin marcar`)
  return partes.join(' · ')
}
