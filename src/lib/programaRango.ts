/**
 * Período del planificador de salidas.
 *
 * Quien arma el programa no piensa en «las próximas 14 filas». Piensa en
 * esta semana, la que viene, el mes, o la semana del superintendente de
 * circuito. Las fechas Desde/Hasta son la fuente de verdad; los atajos
 * solo las rellenan.
 *
 * Tope: un mes calendario (31 días). Más que eso se parte en otro armado,
 * porque la grilla deja de ser un programa y se vuelve un Excel.
 */

export type PresetPrograma =
  | 'esta-semana'
  | 'proxima-semana'
  | 'dos-semanas'
  | 'este-mes'
  | 'proximo-mes'
  | 'semana-del-super'
  | 'personalizado'

export type RangoPrograma = {
  desde: Date
  hasta: Date
}

export type SemanaPrograma = {
  clave: string
  rotulo: string
  desdeClave: string
  hastaClave: string
}

export type BorradorPrograma = {
  enabled: boolean
  slotKey: string
  meetingPointName: string
  meetingPointId: string
  driverId: string
  territoryId: string
  meetingCoords: [number, number] | null
  mapOpen: boolean
}

export const DIAS_MAXIMO_PROGRAMA = 31

export const PRESETS_PROGRAMA: { id: Exclude<PresetPrograma, 'personalizado'>; etiqueta: string }[] =
  [
    { id: 'esta-semana', etiqueta: 'Esta semana' },
    { id: 'proxima-semana', etiqueta: 'Próxima semana' },
    { id: 'dos-semanas', etiqueta: 'Dos semanas' },
    { id: 'este-mes', etiqueta: 'Este mes' },
    { id: 'proximo-mes', etiqueta: 'Próximo mes' },
    { id: 'semana-del-super', etiqueta: 'Semana del super' },
  ]

function enFrase(date: Date, opciones: Intl.DateTimeFormatOptions) {
  return new Intl.DateTimeFormat('es-AR', opciones).format(date).replace(/,/g, '')
}

export function inicioDelDia(date: Date): Date {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate())
}

export function aClaveFecha(date: Date): string {
  return [
    date.getFullYear(),
    String(date.getMonth() + 1).padStart(2, '0'),
    String(date.getDate()).padStart(2, '0'),
  ].join('-')
}

export function deClaveFecha(clave: string): Date {
  const [anio, mes, dia] = clave.split('-').map(Number)
  return new Date(anio, mes - 1, dia)
}

export function claveFechaLocal(value: Date | string): string {
  return aClaveFecha(typeof value === 'string' ? new Date(value) : value)
}

export function sumarDias(date: Date, dias: number): Date {
  const siguiente = inicioDelDia(date)
  siguiente.setDate(siguiente.getDate() + dias)
  return siguiente
}

export function contarDiasInclusive(desde: Date, hasta: Date): number {
  const a = inicioDelDia(desde).getTime()
  const b = inicioDelDia(hasta).getTime()
  return Math.floor((b - a) / 86_400_000) + 1
}

export function lunesDeLaSemana(date: Date): Date {
  const dia = inicioDelDia(date)
  const weekday = dia.getDay()
  const delta = weekday === 0 ? -6 : 1 - weekday
  return sumarDias(dia, delta)
}

export function domingoDeLaSemana(date: Date): Date {
  return sumarDias(lunesDeLaSemana(date), 6)
}

export function proximoLunes(date: Date): Date {
  const dia = inicioDelDia(date)
  if (dia.getDay() === 1) {
    return sumarDias(dia, 7)
  }
  const weekday = dia.getDay()
  const hastaLunes = (8 - weekday) % 7
  return sumarDias(dia, hastaLunes)
}

export function ultimoDiaDelMes(date: Date): Date {
  return new Date(date.getFullYear(), date.getMonth() + 1, 0)
}

export function primerDiaDelMesSiguiente(date: Date): Date {
  return new Date(date.getFullYear(), date.getMonth() + 1, 1)
}

export function validarRango(desde: Date, hasta: Date): string | null {
  const inicio = inicioDelDia(desde)
  const fin = inicioDelDia(hasta)

  if (Number.isNaN(inicio.getTime()) || Number.isNaN(fin.getTime())) {
    return 'Elegí un desde y un hasta.'
  }

  if (fin.getTime() < inicio.getTime()) {
    return 'La fecha de hasta no puede ser anterior a la de desde.'
  }

  const dias = contarDiasInclusive(inicio, fin)
  if (dias > DIAS_MAXIMO_PROGRAMA) {
    return `Como máximo un mes (${DIAS_MAXIMO_PROGRAMA} días). Armá el resto en otro programa.`
  }

  return null
}

export function rangoPorPreset(
  preset: PresetPrograma,
  hoy: Date,
  diaVisitaSuper?: Date | null,
): RangoPrograma | { error: string } {
  const ahora = inicioDelDia(hoy)

  if (preset === 'esta-semana') {
    return { desde: ahora, hasta: domingoDeLaSemana(ahora) }
  }

  if (preset === 'proxima-semana') {
    const lunes = proximoLunes(ahora)
    return { desde: lunes, hasta: domingoDeLaSemana(lunes) }
  }

  if (preset === 'dos-semanas') {
    return { desde: ahora, hasta: sumarDias(ahora, 13) }
  }

  if (preset === 'este-mes') {
    return { desde: ahora, hasta: ultimoDiaDelMes(ahora) }
  }

  if (preset === 'proximo-mes') {
    const primero = primerDiaDelMesSiguiente(ahora)
    return { desde: primero, hasta: ultimoDiaDelMes(primero) }
  }

  if (preset === 'semana-del-super') {
    if (!diaVisitaSuper || Number.isNaN(inicioDelDia(diaVisitaSuper).getTime())) {
      return { error: 'Elegí un día de la visita del superintendente.' }
    }
    const visita = inicioDelDia(diaVisitaSuper)
    return { desde: lunesDeLaSemana(visita), hasta: domingoDeLaSemana(visita) }
  }

  return { error: 'Elegí las fechas Desde y Hasta.' }
}

export function presetInicial(hoy: Date): Exclude<PresetPrograma, 'personalizado'> {
  const resto = rangoPorPreset('esta-semana', hoy)
  if ('error' in resto) {
    return 'proxima-semana'
  }
  return contarDiasInclusive(resto.desde, resto.hasta) >= 2
    ? 'esta-semana'
    : 'proxima-semana'
}

export function crearEstadoPrograma(hoy = new Date()): {
  preset: PresetPrograma
  desde: string
  hasta: string
} {
  const preset = presetInicial(hoy)
  const rango = rangoPorPreset(preset, hoy)
  if ('error' in rango) {
    const clave = aClaveFecha(inicioDelDia(hoy))
    return { preset: 'personalizado', desde: clave, hasta: clave }
  }
  return {
    preset,
    desde: aClaveFecha(rango.desde),
    hasta: aClaveFecha(rango.hasta),
  }
}

export function fraseDelRango(desde: Date, hasta: Date): string {
  const inicio = inicioDelDia(desde)
  const fin = inicioDelDia(hasta)

  if (inicio.getTime() === fin.getTime()) {
    return enFrase(inicio, { weekday: 'long', day: 'numeric', month: 'long' })
  }

  const mismoMes =
    inicio.getMonth() === fin.getMonth() && inicio.getFullYear() === fin.getFullYear()

  if (mismoMes) {
    return `del ${enFrase(inicio, { weekday: 'long', day: 'numeric' })} al ${enFrase(fin, { weekday: 'long', day: 'numeric', month: 'long' })}`
  }

  return `del ${enFrase(inicio, { weekday: 'long', day: 'numeric', month: 'long' })} al ${enFrase(fin, { weekday: 'long', day: 'numeric', month: 'long' })}`
}

export function semanasDelRango(desde: Date, hasta: Date): SemanaPrograma[] {
  const inicio = inicioDelDia(desde)
  const fin = inicioDelDia(hasta)
  const semanas: SemanaPrograma[] = []
  let cursor = lunesDeLaSemana(inicio)

  while (cursor.getTime() <= fin.getTime()) {
    const lunes = cursor
    const domingo = domingoDeLaSemana(lunes)
    const desdeSemana = lunes.getTime() < inicio.getTime() ? inicio : lunes
    const hastaSemana = domingo.getTime() > fin.getTime() ? fin : domingo

    if (hastaSemana.getTime() >= inicio.getTime()) {
      const frase = fraseDelRango(desdeSemana, hastaSemana)
      semanas.push({
        clave: aClaveFecha(lunes),
        rotulo: frase.startsWith('del ') ? `Semana ${frase}` : `Semana del ${frase}`,
        desdeClave: aClaveFecha(desdeSemana),
        hastaClave: aClaveFecha(hastaSemana),
      })
    }

    cursor = sumarDias(lunes, 7)
  }

  return semanas
}

export function hayDiasPasados(desde: Date, hoy: Date): boolean {
  return inicioDelDia(desde).getTime() < inicioDelDia(hoy).getTime()
}

function fechaConWeekdayEnRango(
  desdeClave: string,
  hastaClave: string,
  weekday: number,
): string | null {
  const cursor = deClaveFecha(desdeClave)
  const fin = deClaveFecha(hastaClave)

  while (cursor.getTime() <= fin.getTime()) {
    if (cursor.getDay() === weekday) {
      return aClaveFecha(cursor)
    }
    cursor.setDate(cursor.getDate() + 1)
  }

  return null
}

export function repetirPrimeraSemana(params: {
  desdeClave: string
  hastaClave: string
  rowKeysExistentes: Iterable<string>
  drafts: Record<string, BorradorPrograma>
}): Record<string, BorradorPrograma> {
  const semanas = semanasDelRango(
    deClaveFecha(params.desdeClave),
    deClaveFecha(params.hastaClave),
  )
  const existentes = new Set(params.rowKeysExistentes)
  const siguiente: Record<string, BorradorPrograma> = { ...params.drafts }
  const primera = semanas[0]

  if (!primera || semanas.length < 2) {
    return siguiente
  }

  for (const [rowKey, draft] of Object.entries(params.drafts)) {
    if (!draft.enabled) continue

    const fechaOrigen = rowKey.slice(0, 10)
    if (fechaOrigen < primera.desdeClave || fechaOrigen > primera.hastaClave) {
      continue
    }

    const weekday = deClaveFecha(fechaOrigen).getDay()
    const sufijo = rowKey.slice(10)

    for (const semana of semanas.slice(1)) {
      const destino = fechaConWeekdayEnRango(
        semana.desdeClave,
        semana.hastaClave,
        weekday,
      )
      if (!destino) continue

      const nuevaClave = `${destino}${sufijo}`
      if (!existentes.has(nuevaClave)) continue

      siguiente[nuevaClave] = {
        ...draft,
        slotKey: draft.slotKey.replace(fechaOrigen, destino),
        mapOpen: false,
      }
    }
  }

  return siguiente
}
