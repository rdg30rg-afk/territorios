/**
 * La rotación de territorios: cuándo se trabajó cada uno por última vez.
 *
 * Es lo que hace que el programa no sea una lista alfabética: el que hace más
 * que no se trabaja va primero. Se calcula de las salidas que ya pasaron y no
 * de una tabla aparte, porque la salida es el hecho y cualquier resumen se
 * desactualiza en cuanto alguien corrige una fecha.
 *
 * Puro: entra una lista de salidas, sale un mapa por territorio.
 */

export type SalidaParaRotacion = {
  territory_id: string | null
  scheduled_for: string
  tipo?: string | null
  meeting_point_name?: string | null
}

export type RotacionDeTerritorio = {
  /** Días desde la última salida. null = nunca se trabajó. */
  diasSinTrabajar: number | null
  /** El turno de esa última salida: sirve para alternar la próxima vez. */
  ultimoTurno: 'manana' | 'tarde' | null
  ultimaFecha: string | null
}

/** Los tipos que no son una salida territorial y no cuentan para la rotación. */
const SIN_TERRITORIO = new Set(['telefonica', 'grupos', 'asamblea', 'especial'])

/** "Salidas de Grupos" es una fila del programa, no un territorio trabajado. */
const ES_SALIDA_DE_GRUPOS = /salidas? de grupos?/i

export function rotacionPorTerritorio(
  salidas: SalidaParaRotacion[],
  ahora: Date = new Date(),
): Map<string, RotacionDeTerritorio> {
  const corte = new Date(ahora.getFullYear(), ahora.getMonth(), ahora.getDate())
  /* Se mira hasta el final del día de hoy y no hasta esta hora: una salida de
     las 09:30, mirada a las 12, ya pasó, y una de las 17:00 de hoy es la que
     se está trabajando. Las dos son "hoy", no "nunca". */
  const finDeHoy = new Date(corte.getTime() + 86_400_000)
  const ultima = new Map<string, Date>()

  for (const salida of salidas) {
    const territorio = salida.territory_id
    if (!territorio) continue
    if (salida.tipo && SIN_TERRITORIO.has(salida.tipo)) continue
    if (ES_SALIDA_DE_GRUPOS.test(salida.meeting_point_name ?? '')) continue

    const fecha = new Date(salida.scheduled_for)
    if (!Number.isFinite(fecha.getTime())) continue
    /* Solo hasta hoy: una salida programada para mañana no dice nada sobre
       cuándo se trabajó la última vez. */
    if (fecha.getTime() >= finDeHoy.getTime()) continue

    const previa = ultima.get(territorio)
    if (!previa || fecha.getTime() > previa.getTime()) ultima.set(territorio, fecha)
  }

  const rotacion = new Map<string, RotacionDeTerritorio>()
  for (const [territorio, fecha] of ultima) {
    const dia = new Date(fecha.getFullYear(), fecha.getMonth(), fecha.getDate())
    rotacion.set(territorio, {
      diasSinTrabajar: Math.round((corte.getTime() - dia.getTime()) / 86_400_000),
      /* El corte es el mediodía: una salida de las 09:30 es de la mañana y una
         de las 19:30 es de la tarde, sin depender del huso del servidor. */
      ultimoTurno: fecha.getHours() < 13 ? 'manana' : 'tarde',
      ultimaFecha: fecha.toISOString(),
    })
  }
  return rotacion
}

/** "Hace 96 días", "Ayer", "Nunca se programó". Como se dice, no como se guarda. */
export function comoSeDijoLaUltimaVez(rotacion: RotacionDeTerritorio | undefined): string {
  if (!rotacion || rotacion.diasSinTrabajar === null) return 'Nunca se programó'
  if (rotacion.diasSinTrabajar === 0) return 'Se hizo hoy'
  if (rotacion.diasSinTrabajar === 1) return 'Ayer'
  return `Hace ${rotacion.diasSinTrabajar} días`
}
